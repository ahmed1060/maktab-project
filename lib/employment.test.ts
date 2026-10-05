import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    employmentSpans,
    suspensionSpans,
    timelineForMonth,
    employedWholeMonth,
    deductedDays,
    undecidedDays,
    payableWindows,
    previewSettlement,
    eventForStatusChange,
    endOfContractInstant,
    impliedStatusAt,
    reconcileStatus,
    type EmploymentEventRow,
} from "./employment"
import { toMinor, formatMinor, splitMonth, valueSegment } from "./payroll"
import { offsetMsIn } from "./time"
import { stripComments } from "./strip-comments"

const CAIRO = "Africa/Cairo"

/** A wall-clock time in Cairo, as the UTC instant it actually is. */
const local = (year: number, month: number, day: number, hour = 0, minute = 0): Date => {
    const guess = Date.UTC(year, month - 1, day, hour, minute)
    return new Date(guess - offsetMsIn(new Date(guess), CAIRO))
}

const event = (
    type: EmploymentEventRow["type"],
    effectiveFrom: Date,
    extra: Partial<EmploymentEventRow> = {},
): EmploymentEventRow => ({ type, effectiveFrom, ...extra })

/** Everyone in the migration starts here: no hire date exists, so the epoch. */
const HIRED_AT_EPOCH = event("HIRED", new Date(0))

describe("employment is a set of stretches, not a status", () => {
    it("runs open-ended from the hire", () => {
        const spans = employmentSpans([HIRED_AT_EPOCH])
        expect(spans).toHaveLength(1)
        expect(spans[0].to).toBeNull()
    })

    it("closes at the contract end", () => {
        const ended = local(2026, 9, 11)
        const spans = employmentSpans([HIRED_AT_EPOCH, event("CONTRACT_ENDED", ended)])
        expect(spans).toHaveLength(1)
        expect(spans[0].to?.getTime()).toBe(ended.getTime())
    })

    it("reads a reinstatement on the day of the end as continuous employment", () => {
        // The common case: an end recorded, then reversed before it bites. Two
        // spans meeting at an instant is the same thing as one span, and saying
        // it the second way means nothing downstream has to handle a
        // zero-length gap.
        const ended = local(2026, 9, 11)
        const spans = employmentSpans([
            HIRED_AT_EPOCH,
            event("CONTRACT_ENDED", ended, { createdAt: new Date("2026-09-01") }),
            event("REINSTATED", ended, { createdAt: new Date("2026-09-05") }),
        ])
        expect(spans).toHaveLength(1)
        expect(spans[0].to).toBeNull()
    })

    it("leaves a real gap when the reinstatement is later", () => {
        const spans = employmentSpans([
            HIRED_AT_EPOCH,
            event("CONTRACT_ENDED", local(2026, 9, 11)),
            event("REINSTATED", local(2026, 9, 21)),
        ])
        expect(spans).toHaveLength(2)
        expect(spans[1].from.getTime()).toBe(local(2026, 9, 21).getTime())
    })

    it("ignores an event that repeats the state it is already in", () => {
        // Two HIRED rows are a data-entry artefact, not a second employment. A
        // hard failure here would be a refusal to compute a payslip caused by a
        // duplicate click.
        const spans = employmentSpans([
            HIRED_AT_EPOCH,
            event("HIRED", local(2026, 3, 1)),
        ])
        expect(spans).toHaveLength(1)
        expect(spans[0].from.getTime()).toBe(0)
    })
})

describe("a suspension carries its own deduct decision", () => {
    it("takes the answer from the event that ends it", () => {
        const spans = suspensionSpans([
            HIRED_AT_EPOCH,
            event("SUSPENDED", local(2026, 9, 5)),
            event("UNSUSPENDED", local(2026, 9, 8), { deductSuspension: true }),
        ])
        expect(spans).toHaveLength(1)
        expect(spans[0].deduct).toBe(true)
    })

    it("is undecided while it is still running", () => {
        const spans = suspensionSpans([HIRED_AT_EPOCH, event("SUSPENDED", local(2026, 9, 5))])
        expect(spans[0].to).toBeNull()
        expect(spans[0].deduct).toBeNull()
    })

    it("is undecided when it ended without an answer", () => {
        // Null on an UNSUSPENDED means nobody answered, which is not the same
        // as answering "no" — the register has to be able to say so.
        const spans = suspensionSpans([
            HIRED_AT_EPOCH,
            event("SUSPENDED", local(2026, 9, 5)),
            event("UNSUSPENDED", local(2026, 9, 8)),
        ])
        expect(spans[0].deduct).toBeNull()
    })

    it("is closed by the contract ending", () => {
        // You cannot stay suspended from a job you no longer hold, and an open
        // span would otherwise run past the end of employment.
        const ended = local(2026, 9, 11)
        const spans = suspensionSpans([
            HIRED_AT_EPOCH,
            event("SUSPENDED", local(2026, 9, 5)),
            event("CONTRACT_ENDED", ended),
        ])
        expect(spans).toHaveLength(1)
        expect(spans[0].to?.getTime()).toBe(ended.getTime())
        expect(spans[0].deduct).toBeNull()
    })
})

describe("a month in days", () => {
    it("is whole for somebody who was there throughout", () => {
        const timeline = timelineForMonth([HIRED_AT_EPOCH], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([{ fromDay: 1, toDay: 30 }])
        expect(employedWholeMonth(timeline)).toBe(true)
    })

    it("starts on the day somebody joined, whatever time of day", () => {
        // Rounds in the employee's favour: any part of a day employed is a day
        // employed. Somebody who starts at four in the afternoon is not on
        // three-quarters of a day's pay.
        const timeline = timelineForMonth([event("HIRED", local(2026, 9, 3, 16))], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([{ fromDay: 3, toDay: 30 }])
        expect(employedWholeMonth(timeline)).toBe(false)
    })

    it("ends on the day before the end takes effect", () => {
        // effectiveFrom is the first instant they are no longer employed, so an
        // end dated the 11th makes the 10th the last working day.
        const timeline = timelineForMonth(
            [HIRED_AT_EPOCH, event("CONTRACT_ENDED", local(2026, 9, 11))], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([{ fromDay: 1, toDay: 10 }])
    })

    it("counts a day the contract ended part-way through", () => {
        const timeline = timelineForMonth(
            [HIRED_AT_EPOCH, event("CONTRACT_ENDED", local(2026, 9, 11, 9))], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([{ fromDay: 1, toDay: 11 }])
    })

    it("is empty for a month after the contract ended", () => {
        // Not a zero-length window and not day 1 to day 0 — nothing at all, so
        // there is no window for splitMonth to be handed.
        const timeline = timelineForMonth(
            [HIRED_AT_EPOCH, event("CONTRACT_ENDED", local(2026, 9, 1))], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([])
        expect(payableWindows(timeline)).toEqual([])
    })

    it("is measured against Cairo's month, not UTC's", () => {
        // Cairo enters October three hours early in summer. An end at half past
        // midnight on 1 October is October's, and September is untouched — the
        // same boundary that makes "everything in UTC" the wrong rule.
        const ended = local(2026, 10, 1, 0, 30)
        expect(ended.toISOString()).toBe("2026-09-30T21:30:00.000Z")
        const events = [HIRED_AT_EPOCH, event("CONTRACT_ENDED", ended)]
        expect(timelineForMonth(events, 2026, 9, CAIRO).employed).toEqual([{ fromDay: 1, toDay: 30 }])
        expect(timelineForMonth(events, 2026, 10, CAIRO).employed).toEqual([{ fromDay: 1, toDay: 1 }])
    })

    it("splits a month around a gap in employment", () => {
        const timeline = timelineForMonth([
            HIRED_AT_EPOCH,
            event("CONTRACT_ENDED", local(2026, 9, 11)),
            event("REINSTATED", local(2026, 9, 21)),
        ], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([{ fromDay: 1, toDay: 10 }, { fromDay: 21, toDay: 30 }])
    })
})

describe("suspension counts whole days only", () => {
    const suspended = (from: Date, to?: Date, deduct?: boolean) => timelineForMonth([
        HIRED_AT_EPOCH,
        event("SUSPENDED", from),
        ...(to ? [event("UNSUSPENDED", to, { deductSuspension: deduct })] : []),
    ], 2026, 9, CAIRO)

    it("covers the days it fully spans", () => {
        // Midnight on the 5th to midnight on the 8th is the 5th, 6th and 7th.
        // The 8th is not suspended: the span ends as it begins.
        const timeline = suspended(local(2026, 9, 5), local(2026, 9, 8), true)
        expect(timeline.suspensions).toEqual([
            { fromDay: 5, toDay: 7, deduct: true, reason: undefined },
        ])
        expect(deductedDays(timeline)).toBe(3)
    })

    it("does not charge the day it started part-way through", () => {
        // The mirror of the employment rule, and the reason the pair cannot
        // double-count: a day can never be both unpaid for absence and unpaid
        // for suspension.
        const timeline = suspended(local(2026, 9, 5, 14), local(2026, 9, 8), true)
        expect(timeline.suspensions[0]).toMatchObject({ fromDay: 6, toDay: 7 })
    })

    it("does not charge the day it was lifted part-way through", () => {
        const timeline = suspended(local(2026, 9, 5), local(2026, 9, 8, 10), true)
        expect(timeline.suspensions[0]).toMatchObject({ fromDay: 5, toDay: 7 })
    })

    it("charges nothing for a suspension shorter than a whole day", () => {
        const timeline = suspended(local(2026, 9, 5, 9), local(2026, 9, 5, 17), true)
        expect(timeline.suspensions).toEqual([])
        expect(deductedDays(timeline)).toBe(0)
    })

    it("runs to the end of the month while it is still open", () => {
        const timeline = suspended(local(2026, 9, 28))
        expect(timeline.suspensions[0]).toMatchObject({ fromDay: 28, toDay: 30, deduct: null })
        expect(undecidedDays(timeline)).toBe(3)
        expect(deductedDays(timeline)).toBe(0)
    })

    it("carries in from a previous month", () => {
        const timeline = suspended(local(2026, 8, 20), local(2026, 9, 4), true)
        expect(timeline.suspensions[0]).toMatchObject({ fromDay: 1, toDay: 3 })
    })

    it("is clipped to the days somebody was actually employed", () => {
        // A suspension outstaying the contract is noise, and left unclipped it
        // would deduct days from a window that pays nothing anyway.
        const timeline = timelineForMonth([
            HIRED_AT_EPOCH,
            event("SUSPENDED", local(2026, 9, 5)),
            event("UNSUSPENDED", local(2026, 9, 25), { deductSuspension: true }),
            event("CONTRACT_ENDED", local(2026, 9, 11)),
        ], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([{ fromDay: 1, toDay: 10 }])
        expect(timeline.suspensions[0]).toMatchObject({ fromDay: 5, toDay: 10 })
    })
})

describe("what actually gets paid", () => {
    const withSuspension = (deduct: boolean | undefined) => timelineForMonth([
        HIRED_AT_EPOCH,
        event("SUSPENDED", local(2026, 9, 5)),
        event("UNSUSPENDED", local(2026, 9, 8), { deductSuspension: deduct }),
    ], 2026, 9, CAIRO)

    it("splits the month around a deducted suspension", () => {
        expect(payableWindows(withSuspension(true))).toEqual([
            { fromDay: 1, toDay: 4 },
            { fromDay: 8, toDay: 30 },
        ])
    })

    it("pays through a suspension that was not deducted", () => {
        expect(payableWindows(withSuspension(false))).toEqual([{ fromDay: 1, toDay: 30 }])
    })

    it("pays through a suspension nobody has ruled on", () => {
        // An unanswered question must not quietly become a deduction. It shows
        // up in undecidedDays instead, so the register can say the month is not
        // finished being decided.
        const timeline = withSuspension(undefined)
        expect(payableWindows(timeline)).toEqual([{ fromDay: 1, toDay: 30 }])
        expect(undecidedDays(timeline)).toBe(3)
    })

    it("values the windows at the month's own day rate", () => {
        // 30,000.00 over September's thirty days, less three suspended days.
        const timeline = withSuspension(true)
        const rates = [{ fromDay: 1, monthlyMinor: toMinor(30_000) }]
        const total = payableWindows(timeline)
            .flatMap(window => splitMonth(2026, 9, rates, window))
            .reduce((sum, segment) => sum + valueSegment(segment), 0)
        expect(formatMinor(total)).toBe("27000.00")
    })
})

describe("the settlement preview shows the sign against the chosen date", () => {
    const rates = [{ fromDay: 1, monthlyMinor: toMinor(30_000) }]
    const endsAt = local(2026, 9, 11)

    it("owes the person when payday has not come round", () => {
        const preview = previewSettlement({ events: [HIRED_AT_EPOCH], rates, endsAt, timeZone: CAIRO })
        expect(preview).toMatchObject({ year: 2026, month: 9, lastWorkingDay: 10, daysWorked: 10 })
        expect(formatMinor(preview.earnedMinor)).toBe("10000.00")
        expect(preview.direction).toBe("COMPANY_OWES")
    })

    it("owes the company when the month was paid in advance", () => {
        // Same date, same salary, opposite direction. This is the whole reason
        // it is previewed before anybody commits to a date rather than
        // discovered afterwards.
        const preview = previewSettlement({
            events: [HIRED_AT_EPOCH], rates, endsAt,
            paidMinor: toMinor(30_000), timeZone: CAIRO,
        })
        expect(preview.direction).toBe("PERSON_OWES")
        expect(formatMinor(preview.netMinor)).toBe("-20000.00")
    })

    it("is settled when what went out matches what was earned", () => {
        const preview = previewSettlement({
            events: [HIRED_AT_EPOCH], rates, endsAt,
            paidMinor: toMinor(10_000), timeZone: CAIRO,
        })
        expect(preview.direction).toBe("SETTLED")
        expect(preview.netMinor).toBe(0)
    })

    it("takes a deducted suspension out of the final month", () => {
        const preview = previewSettlement({
            events: [
                HIRED_AT_EPOCH,
                event("SUSPENDED", local(2026, 9, 5)),
                event("UNSUSPENDED", local(2026, 9, 8), { deductSuspension: true }),
            ],
            rates, endsAt, timeZone: CAIRO,
        })
        expect(preview.daysWorked).toBe(7)
        expect(formatMinor(preview.earnedMinor)).toBe("7000.00")
    })

    it("values each half of a mid-month raise at its own rate", () => {
        // valueDaysIn again, in its third disguise: days from a month always
        // carry that month's rate, and a settlement spanning a raise is not one
        // day rate applied to a count of days.
        const preview = previewSettlement({
            events: [HIRED_AT_EPOCH],
            rates: [
                { fromDay: 1, monthlyMinor: toMinor(30_000) },
                { fromDay: 6, monthlyMinor: toMinor(60_000) },
            ],
            endsAt, timeZone: CAIRO,
        })
        // Five days at 1,000.00 and five at 2,000.00.
        expect(formatMinor(preview.earnedMinor)).toBe("15000.00")
    })

    it("earns nothing for a date before the person was employed at all", () => {
        const preview = previewSettlement({
            events: [event("HIRED", local(2026, 10, 1))], rates,
            endsAt: local(2026, 9, 11), timeZone: CAIRO,
        })
        expect(preview.earnedMinor).toBe(0)
        expect(preview.daysWorked).toBe(0)
    })
})

describe("the timeline and the status field move together", () => {
    const service = stripComments(readFileSync("lib/services/employment.service.ts", "utf8"))

    it("writes both in one transaction", () => {
        expect(service).toContain("prisma.$transaction")
        expect(service).toContain("client.employmentEvent.create")
        expect(service).toContain("client.user.update")
    })

    it("does not move the status for a future-dated event", () => {
        // A contract ending on the 1st of next month, recorded today, must not
        // lock somebody out for the rest of this one.
        expect(service).toContain("input.effectiveFrom.getTime() <= Date.now()")
    })

    it("refuses a deduct decision on anything but an UNSUSPENDED", () => {
        expect(service).toContain('input.type !== "UNSUSPENDED"')
    })

    it("archives on a contract end rather than deleting", () => {
        // The record has to stay whole: a payslip may have to be reissued years
        // later, and a deleted user cannot produce one.
        expect(service).toContain('CONTRACT_ENDED: "ARCHIVED"')
    })
})

describe("ARCHIVED closes the door without erasing anybody", () => {
    it("blocks login on its own line, with its own message", () => {
        // Scoped to the branch rather than to the file: the file mentions
        // several status gates, and a guard that matches the wrong one is worse
        // than no guard, because it passes while the thing it names is gone.
        const auth = stripComments(readFileSync("lib/auth.ts", "utf8"))
        const start = auth.indexOf("validatedUser.status === 'ARCHIVED'")
        expect(start).toBeGreaterThan(-1)
        const branch = auth.slice(start, start + 200)
        expect(branch).toContain("throw new Error")
        // Not folded into the suspended message: telling somebody whose
        // contract ended that they were "suspended or deleted" sends them to an
        // administrator to fix something that is not broken.
        expect(branch).not.toContain("suspended or deleted")
    })

    it("is restricted by the same API gate as a suspension", () => {
        const utils = stripComments(readFileSync("lib/api-utils.ts", "utf8"))
        const start = utils.indexOf("const isSuspendedOrBanned")
        expect(start).toBeGreaterThan(-1)
        const gate = utils.slice(start, utils.indexOf("\n", start))
        expect(gate).toContain("userStatus === 'ARCHIVED'")
    })

    it("is reported to the browser under its own name", () => {
        const service = stripComments(readFileSync("lib/services/user.service.ts", "utf8"))
        expect(service).toContain("status: 'ARCHIVED'")
    })

    it("is a status the API will accept and filter on", () => {
        const schema = stripComments(readFileSync("lib/validations/user.schema.ts", "utf8"))
        expect(schema).toContain("'ARCHIVED'")
        const route = stripComments(readFileSync("app/api/users/route.ts", "utf8"))
        expect(route).toContain("'ARCHIVED'")
    })
})

describe("the screens that write a status also write the timeline", () => {
    it("reads a suspend toggle as a suspension", () => {
        expect(eventForStatusChange("ACTIVE", "SUSPENDED")).toBe("SUSPENDED")
        expect(eventForStatusChange("OFFLINE", "SUSPENDED")).toBe("SUSPENDED")
    })

    it("reads the toggle back as the end of one", () => {
        expect(eventForStatusChange("SUSPENDED", "ACTIVE")).toBe("UNSUSPENDED")
        expect(eventForStatusChange("SUSPENDED", "OFFLINE")).toBe("UNSUSPENDED")
    })

    it("reads archiving as the end of the contract, and its undoing as a reinstatement", () => {
        expect(eventForStatusChange("ACTIVE", "ARCHIVED")).toBe("CONTRACT_ENDED")
        expect(eventForStatusChange("ARCHIVED", "ACTIVE")).toBe("REINSTATED")
    })

    it("says nothing about presence", () => {
        // A timeline that recorded these would be a session log, not an
        // employment history — and every payslip would have to read past
        // thousands of rows that change nothing.
        expect(eventForStatusChange("ACTIVE", "OFFLINE")).toBeNull()
        expect(eventForStatusChange("OFFLINE", "ACTIVE")).toBeNull()
        expect(eventForStatusChange("ACTIVE", "INACTIVE")).toBeNull()
        expect(eventForStatusChange("ACTIVE", "ACTIVE")).toBeNull()
    })

    it("says nothing about deletion", () => {
        // An administrative removal is not the end of a contract, and giving it
        // the same event would make the two indistinguishable in the register.
        expect(eventForStatusChange("ACTIVE", "DELETED")).toBeNull()
    })

    it("leaves the deduct question unanswered", () => {
        // A toggle back to active says the suspension is over. It does not say
        // whether it cost anybody pay.
        const service = stripComments(readFileSync("lib/services/employment.service.ts", "utf8"))
        const start = service.indexOf("static async recordStatusChange")
        expect(start).toBeGreaterThan(-1)
        expect(service.slice(start, service.indexOf("static async history", start)))
            .toContain("deductSuspension: null")
    })

    it("is wired into both routes that write User.status", () => {
        // One route recorded and the other not is worse than neither: the gap
        // is invisible, and which route an admin used is not written down.
        const service = stripComments(readFileSync("lib/services/user.service.ts", "utf8"))
        const calls = service.split("EmploymentService.recordStatusChange").length - 1
        expect(calls).toBe(2)
        expect(service).toContain("previousStatus: regularUser.status")
        expect(service).toContain("previousStatus: existingUser.status")
    })
})

describe("a last working day becomes the instant employment ends", () => {
    it("is the start of the following day, locally", () => {
        // 30 September is worked; employment ends as 1 October begins in Cairo,
        // which is 21:00 UTC on the 30th in summer.
        expect(endOfContractInstant("2026-09-30", CAIRO).toISOString()).toBe("2026-09-30T21:00:00.000Z")
    })

    it("rolls over a month end and a year end", () => {
        expect(endOfContractInstant("2026-12-31", CAIRO).getTime())
            .toBe(local(2027, 1, 1).getTime())
        expect(endOfContractInstant("2026-02-28", CAIRO).getTime())
            .toBe(local(2026, 3, 1).getTime())
    })

    it("pays the leaving day", () => {
        // The conversion exists so that "last day: the 10th" and "ends: the
        // 11th" are the same fact. Getting it wrong is one day's pay, every
        // time, in the same direction.
        const endsAt = endOfContractInstant("2026-09-10", CAIRO)
        const timeline = timelineForMonth([HIRED_AT_EPOCH, event("CONTRACT_ENDED", endsAt)], 2026, 9, CAIRO)
        expect(timeline.employed).toEqual([{ fromDay: 1, toDay: 10 }])
    })

    it("refuses anything that is not a date", () => {
        expect(() => endOfContractInstant("30-09-2026", CAIRO)).toThrow()
        expect(() => endOfContractInstant("2026-13-01", CAIRO)).toThrow()
    })
})

describe("what the timeline says the status should be", () => {
    const at = local(2026, 9, 15, 12)

    it("is active for somebody employed and not suspended", () => {
        expect(impliedStatusAt([HIRED_AT_EPOCH], at)).toBe("ACTIVE")
    })

    it("is suspended inside a suspension", () => {
        expect(impliedStatusAt([
            HIRED_AT_EPOCH,
            event("SUSPENDED", local(2026, 9, 10)),
        ], at)).toBe("SUSPENDED")
    })

    it("is archived after the contract ended", () => {
        expect(impliedStatusAt([
            HIRED_AT_EPOCH,
            event("CONTRACT_ENDED", local(2026, 9, 11)),
        ], at)).toBe("ARCHIVED")
    })

    it("has no opinion before anybody was hired", () => {
        // Silence and "active" are different answers. A job that treated the
        // first as the second would set a status from an empty history.
        expect(impliedStatusAt([], at)).toBeNull()
        expect(impliedStatusAt([event("HIRED", local(2026, 10, 1))], at)).toBeNull()
    })

    it("does not see an event whose date has not arrived", () => {
        const events = [HIRED_AT_EPOCH, event("CONTRACT_ENDED", local(2026, 10, 1))]
        expect(impliedStatusAt(events, at)).toBe("ACTIVE")
        expect(impliedStatusAt(events, local(2026, 10, 2))).toBe("ARCHIVED")
    })
})

describe("reconciling a status the timeline owns", () => {
    it("archives and suspends when the date has arrived", () => {
        expect(reconcileStatus("ACTIVE", "ARCHIVED")).toBe("ARCHIVED")
        expect(reconcileStatus("OFFLINE", "SUSPENDED")).toBe("SUSPENDED")
    })

    it("lifts a state the timeline itself put them in", () => {
        expect(reconcileStatus("SUSPENDED", "ACTIVE")).toBe("ACTIVE")
        expect(reconcileStatus("ARCHIVED", "ACTIVE")).toBe("ACTIVE")
    })

    it("leaves presence alone", () => {
        // The failure this prevents: a nightly job writing ACTIVE over OFFLINE
        // would show every employee as online once a day, at whatever hour it
        // happens to run.
        expect(reconcileStatus("OFFLINE", "ACTIVE")).toBeNull()
        expect(reconcileStatus("INACTIVE", "ACTIVE")).toBeNull()
        expect(reconcileStatus("ACTIVE", "ACTIVE")).toBeNull()
    })

    it("does nothing when the timeline has no opinion", () => {
        expect(reconcileStatus("OFFLINE", null)).toBeNull()
    })
})

describe("a future-dated event is applied when its date arrives", () => {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }

    it("has something scheduled to apply it", () => {
        // Without this the status never moves: record() deliberately leaves it
        // alone for a future date, so somebody whose contract ended last month
        // would keep working, keep logging in, and keep being paid.
        const cron = vercel.crons.find(c => c.path === "/api/cron/employment")
        expect(cron, "no employment cron in vercel.json").toBeDefined()
    })

    it("runs at the local day boundary, not at a convenient hour", () => {
        // 22:00 UTC is just past midnight in Cairo in either half of the year.
        // An event effective "the 1st" takes effect as the 1st begins locally,
        // and a later hour would leave somebody able to sign in on a day they
        // are no longer employed on.
        expect(vercel.crons.find(c => c.path === "/api/cron/employment")?.schedule).toBe("0 22 * * *")
    })

    it("is the job that reconciles, and is heartbeated", () => {
        const route = stripComments(readFileSync("app/api/cron/employment/route.ts", "utf8"))
        expect(route).toContain("EmploymentService.applyDueEvents")
        expect(route).toContain('JobHeartbeatService.run("employment"')
        const jobs = stripComments(readFileSync("lib/services/job-heartbeat.service.ts", "utf8"))
        expect(jobs).toContain('job: "employment"')
    })

    it("reconciles rather than writing the last event's status blindly", () => {
        const service = stripComments(readFileSync("lib/services/employment.service.ts", "utf8"))
        expect(service).toContain("reconcileStatus(user.status, impliedStatusAt(events, now))")
    })
})

describe("the end-contract screen and the commit agree", () => {
    const route = stripComments(readFileSync("app/api/users/[id]/employment/route.ts", "utf8"))

    it("previews and commits through one calculation", () => {
        // The preview and the commit have to be the same calculation over the
        // same date, or an admin is shown one figure and another is recorded.
        // P5 achieved that by converting the date identically in two places;
        // P8 achieves it better, by having the commit call the preview — so
        // there is only one calculation to agree with.
        expect(route).toContain("SettlementService.preview")
        expect(route).toContain("SettlementService.settleAndEnd")

        const service = stripComments(readFileSync("lib/services/settlement.service.ts", "utf8"))
        const settle = service.slice(service.indexOf("static async settleAndEnd"))
        expect(settle, "the commit computes its own figures instead of reusing the preview")
            .toContain("this.preview(")
    })

    it("is managers only, and company-scoped", () => {
        expect(route.split("verifyResourceAccess(session, userId, 'USER')").length - 1).toBe(2)
        // Three: the preview asks its permission of the person too, since
        // employees.edit may be held for a team only.
        expect(route.split("can(session.user, ").length - 1).toBe(3)
    })

    it("will not let somebody end their own contract", () => {
        expect(route).toContain("userId === session.user.id")
    })
})
