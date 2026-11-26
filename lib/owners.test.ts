import { describe, it, expect } from "vitest"
import { ownerIn, ownerSince, planOwner, ownerRefusal, notOwnerIn, monthOf, monthsReached, monthsSpanned } from "./owners"
import { previewSettlement } from "./employment"
import { toMinor } from "./payroll"

/**
 * Owners (LATER_CHANGES_PLAN.md §7.3, step 3a, PR 426): each time someone
 * is an owner, from the start of the month they're marked to the start of
 * the month they're no longer one; whether they're one in a month, and
 * what marking them, or taking it off, does to their periods.
 */

const at = (iso: string) => new Date(iso)
// The starts of the months in Cairo, as periods are written there.
const OCT = at("2026-09-30T21:00:00Z"), NOV = at("2026-10-31T22:00:00Z"), DEC = at("2026-11-30T22:00:00Z"), JAN = at("2026-12-31T22:00:00Z")

describe("whether someone is an owner in a month", () => {
    it("is from the month their period starts, until the month it ends", () => {
        const periods = [{ id: "p1", startsAt: NOV, endsAt: JAN }]
        expect(ownerIn(periods, "2026-10")).toBe(false)
        expect(ownerIn(periods, "2026-11")).toBe(true)
        expect(ownerIn(periods, "2026-12")).toBe(true)
        expect(ownerIn(periods, "2027-01")).toBe(false)
    })

    it("is every month from its start while it's open, and in any of their periods", () => {
        expect(ownerIn([{ id: "p1", startsAt: NOV, endsAt: null }], "2027-01")).toBe(true)
        expect(ownerIn([{ id: "p1", startsAt: OCT, endsAt: NOV }, { id: "p2", startsAt: DEC, endsAt: null }], "2026-11")).toBe(false)
        expect(ownerIn([{ id: "p1", startsAt: OCT, endsAt: NOV }, { id: "p2", startsAt: DEC, endsAt: null }], "2026-10")).toBe(true)
        expect(ownerIn([], "2026-11")).toBe(false)
    })

    it("asks the database the same, for the people who aren't, at a moment every time zone's month holds", () => {
        const mid = at("2026-11-15T00:00:00Z")
        expect(notOwnerIn("2026-11")).toEqual({ NOT: { ownerPeriods: { some: { startsAt: { lte: mid }, OR: [{ endsAt: null }, { endsAt: { gt: mid } }] } } } })
    })

    it("says since which month they're one now, from their open period", () => {
        expect(ownerSince([{ id: "p1", startsAt: OCT, endsAt: NOV }, { id: "p2", startsAt: DEC, endsAt: null }])).toBe("2026-12")
        expect(ownerSince([{ id: "p1", startsAt: OCT, endsAt: NOV }])).toBeNull()
    })
})

describe("a month, whatever the company's time zone becomes", () => {
    // November's start in the time zones furthest apart, and in Dubai, two hours before Cairo's.
    const KIRITIMATI = at("2026-10-31T10:00:00Z"), DUBAI = at("2026-10-31T20:00:00Z"), BAKER = at("2026-11-01T12:00:00Z")

    it("is the month a period's start or end opens, in any of them", () => {
        for (const start of [KIRITIMATI, DUBAI, NOV, BAKER]) expect(monthOf(start)).toBe("2026-11")
        expect(monthOf(at("2026-11-30T10:00:00Z"))).toBe("2026-12")
        expect(monthOf(at("2026-12-01T12:00:00Z"))).toBe("2026-12")
    })

    it("keeps someone marked in Cairo an owner in that month after it moves to Dubai, and not in the month before", () => {
        const periods = [{ id: "p1", startsAt: NOV, endsAt: null }]
        expect(ownerIn(periods, "2026-11")).toBe(true)
        expect(ownerIn(periods, "2026-10")).toBe(false)
        expect(ownerIn([{ id: "p1", startsAt: KIRITIMATI, endsAt: at("2026-11-30T10:00:00Z") }], "2026-11")).toBe(true)
        expect(ownerIn([{ id: "p1", startsAt: BAKER, endsAt: at("2026-12-01T12:00:00Z") }], "2026-12")).toBe(false)
    })

    it("carries on, or takes off, a period written in another time zone by its month", () => {
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: NOV }], "2026-11", true)).toEqual({ ok: true, action: "reopen", id: "p1" })
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: DUBAI }], "2026-11", true)).toEqual({ ok: true, action: "reopen", id: "p1" })
        expect(planOwner([{ id: "p1", startsAt: NOV, endsAt: null }], "2026-11", false)).toEqual({ ok: true, action: "delete", id: "p1" })
        expect(planOwner([{ id: "p1", startsAt: BAKER, endsAt: null }], "2026-11", false)).toEqual({ ok: true, action: "delete", id: "p1" })
        expect(planOwner([{ id: "p1", startsAt: DUBAI, endsAt: null }], "2026-11", false)).toEqual({ ok: true, action: "delete", id: "p1" })
    })
})

describe("a contract ended in a month they're an owner", () => {
    const rates = [{ fromDay: 1, monthlyMinor: toMinor(9_000) }]
    const events = [{ type: "HIRED" as const, effectiveFrom: at("2020-01-01T00:00:00Z"), createdAt: at("2020-01-01T00:00:00Z") }]
    const endsAt = at("2026-11-26T22:00:00Z")

    it("settles that month at nothing earned and nothing paid, the days still counted", () => {
        const preview = previewSettlement({ events, rates, endsAt, paidMinor: toMinor(9_000), timeZone: "Africa/Cairo", owner: true })
        expect(preview).toMatchObject({ year: 2026, month: 11, daysWorked: 26, earnedMinor: 0, paidMinor: 0, netMinor: 0, direction: "SETTLED" })
    })

    it("and anyone else's as it always was", () => {
        const preview = previewSettlement({ events, rates, endsAt, paidMinor: toMinor(9_000), timeZone: "Africa/Cairo" })
        expect(preview).toMatchObject({ earnedMinor: toMinor(7_800), paidMinor: toMinor(9_000), direction: "PERSON_OWES" })
    })
})

describe("marking someone as an owner, or taking it off", () => {
    it("starts a period this month", () => {
        expect(planOwner([], "2026-11", true)).toEqual({ ok: true, action: "create" })
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: NOV }], "2026-12", true)).toEqual({ ok: true, action: "create" })
    })

    it("carries on the period taken off this month, rather than start another", () => {
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: NOV }], "2026-11", true)).toEqual({ ok: true, action: "reopen", id: "p1" })
    })

    it("ends the open period this month, the months before staying an owner's", () => {
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: null }], "2026-12", false)).toEqual({ ok: true, action: "close", id: "p1" })
    })

    it("takes off a period started this month as if it never was", () => {
        expect(planOwner([{ id: "p1", startsAt: NOV, endsAt: null }], "2026-11", false)).toEqual({ ok: true, action: "delete", id: "p1" })
    })

    it("refuses what they are already", () => {
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: null }], "2026-11", true)).toEqual({ ok: false, refusal: "ALREADY_OWNER" })
        expect(planOwner([{ id: "p1", startsAt: OCT, endsAt: NOV }], "2026-12", false)).toEqual({ ok: false, refusal: "NOT_OWNER" })
        expect(planOwner([], "2026-12", false)).toEqual({ ok: false, refusal: "NOT_OWNER" })
    })
})

describe("the months a change reaches", () => {
    it("is this month and every one after: a year ahead, and on to the last with a payroll run", () => {
        const year = monthsReached("2026-11", null)
        expect(year).toHaveLength(13)
        expect(year[0]).toBe("2026-11")
        expect(year[1]).toBe("2026-12")
        expect(year[2]).toBe("2027-01")
        expect(year[12]).toBe("2027-11")
        expect(monthsReached("2026-11", "2026-05")).toEqual(year)
        const further = monthsReached("2026-11", "2029-03")
        expect(further[0]).toBe("2026-11")
        expect(further[further.length - 1]).toBe("2029-03")
        expect(further).toHaveLength(29)
    })
})

describe("the months some days fall in", () => {
    it("is each month from the first day's to the last's, over a year's end too", () => {
        expect(monthsSpanned("2026-11-26", "2026-11-26")).toEqual(["2026-11"])
        expect(monthsSpanned("2026-11-30", "2026-12-01")).toEqual(["2026-11", "2026-12"])
        expect(monthsSpanned("2026-12-30", "2027-02-02")).toEqual(["2026-12", "2027-01", "2027-02"])
    })
})

describe("what's refused, in words", () => {
    it("says each, and nothing for what isn't one", () => {
        expect(ownerRefusal("OWNER_OPEN_WORK")).toBe("owner_open_work")
        expect(ownerRefusal("PAYROLL_MONTH_LOCKED")).toBe("owner_month_locked")
        expect(ownerRefusal("ALREADY_OWNER")).toBe("owner_already")
        expect(ownerRefusal("NOT_OWNER")).toBe("owner_not")
        expect(ownerRefusal("NO_COMPANY")).toBe("owner_no_company")
        expect(ownerRefusal("OWNER_SETTLED")).toBe("owner_settled")
        expect(ownerRefusal("SOMETHING_ELSE")).toBeNull()
        expect(ownerRefusal(undefined)).toBeNull()
    })
})
