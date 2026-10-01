import { describe, it, expect } from "vitest"
import { assignPunches, debounce, measureDay, priceMonth, paidMinutesOf, type EnginePunch, type PricingInput, type MeasuredDay } from "./engine"
import { STANDARD_OFFICE, MEASURE_ONLY, type PolicyBody } from "./policy"
import type { ExpectedDay } from "./calendar"

/**
 * The derivation engine (ATTENDANCE_PLAN.md §11): grouping punches by shift,
 * debouncing, pairing in sequence, and pricing the month in order (§6.3–6.5).
 */

const work = (startMinutes = 540, endMinutes = 1020, breakMinutes = 60): ExpectedDay =>
    ({ kind: "WORK", hours: { startMinutes, endMinutes, breakMinutes }, versionId: "v1", overrideId: null })
const REST: ExpectedDay = { kind: "REST", versionId: "v1" }
const HOLIDAY: ExpectedDay = { kind: "HOLIDAY", holiday: { id: "h", date: "2026-10-06", name: "Armed Forces Day", isPaid: true, source: "PUBLIC" }, versionId: "v1" }
let n = 0
const p = (at: string, direction: EnginePunch["direction"] = null): EnginePunch => ({ id: `p${++n}`, at, direction })
const measure = (expected: ExpectedDay, punches: EnginePunch[], extra: Partial<Parameters<typeof measureDay>[0]> = {}) =>
    measureDay({ date: "2026-10-04", expected, punches, onLeave: false, suspended: false, ...extra })

describe("which day a punch belongs to", () => {
    it("keeps a night shift's morning check-out on the night it started", () => {
        const plans = new Map<string, ExpectedDay>([["2026-10-04", work(1320, 1800, 30)], ["2026-10-05", work(1320, 1800, 30)]])
        const days = assignPunches([p("2026-10-04T21:55:00"), p("2026-10-05T06:03:00"), p("2026-10-05T21:58:00")], plans)
        expect(days.get("2026-10-04")!.map(x => x.at)).toEqual(["2026-10-04T21:55:00", "2026-10-05T06:03:00"])
        expect(days.get("2026-10-05")!.map(x => x.at)).toEqual(["2026-10-05T21:58:00"])
    })

    it("files a punch near no shift under the date it fell on", () => {
        const days = assignPunches([p("2026-10-03T10:00:00")], new Map([["2026-10-03", REST], ["2026-10-04", work()]]))
        expect([...days.keys()]).toEqual(["2026-10-03"])
    })
})

describe("measuring a day", () => {
    it("counts two scans within a minute as one", () => {
        expect(debounce([p("2026-10-04T09:00:00"), p("2026-10-04T09:00:40"), p("2026-10-04T09:01:30")]).map(x => x.at))
            .toEqual(["2026-10-04T09:00:00", "2026-10-04T09:01:30"])
    })

    it("pairs in sequence, so a lunch break out and back is not work, and measures late, early and overtime", () => {
        const day = measure(work(), [p("2026-10-04T09:20:00"), p("2026-10-04T13:00:00"), p("2026-10-04T14:00:00"), p("2026-10-04T17:45:00")])
        expect(day).toMatchObject({ status: "PRESENT", punchCount: 4, workedMinutes: 220 + 225, lateMinutes: 20, earlyLeaveMinutes: 0, overtimeMinutes: 45 })
        const early = measure(work(), [p("2026-10-04T08:50:00"), p("2026-10-04T16:30:00")])
        expect(early).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 30, overtimeMinutes: 0 })
    })

    it("counts as overtime only the time worked after the shift, not a gap before coming back (review on #13)", () => {
        const day = measure(work(), [p("2026-10-04T09:00:00"), p("2026-10-04T18:00:00"), p("2026-10-04T19:00:00"), p("2026-10-04T20:00:00")])
        expect(day).toMatchObject({ overtimeMinutes: 60 + 60, workedMinutes: 540 + 60 })
    })

    it("never guesses a missing punch: an odd count is incomplete, with only the lateness known", () => {
        const day = measure(work(), [p("2026-10-04T09:40:00")])
        expect(day).toMatchObject({ status: "INCOMPLETE", firstIn: "2026-10-04T09:40:00", lastOut: null, lateMinutes: 40, earlyLeaveMinutes: 0, overtimeMinutes: 0 })
    })

    it("calls a working day with no punches absent, unless the person was on leave or suspended", () => {
        expect(measure(work(), []).status).toBe("ABSENT")
        expect(measure(work(), [], { onLeave: true }).status).toBe("LEAVE")
        expect(measure(work(), [], { suspended: true }).status).toBe("SUSPENDED")
    })

    it("counts all work on a rest day or holiday as overtime, and leaves them alone otherwise", () => {
        expect(measure(REST, [])).toMatchObject({ status: "REST", overtimeMinutes: 0 })
        expect(measure(REST, [p("2026-10-04T10:00:00"), p("2026-10-04T13:30:00")])).toMatchObject({ status: "WORKED_REST_DAY", overtimeMinutes: 210 })
        expect(measure(HOLIDAY, [p("2026-10-04T10:00:00"), p("2026-10-04T12:00:00")])).toMatchObject({ status: "WORKED_HOLIDAY", overtimeMinutes: 120 })
    })

    it("subtracts approved permission minutes from lateness and early leave, and records them", () => {
        const day = measure(work(), [p("2026-10-04T10:00:00"), p("2026-10-04T16:00:00")], {
            permissions: [{ type: "LATE_ARRIVAL", startMinutes: 540, endMinutes: 585 }, { type: "EARLY_LEAVE", startMinutes: 900, endMinutes: 1020 }],
        })
        expect(day).toMatchObject({ lateMinutes: 15, earlyLeaveMinutes: 0, excusedMinutes: 45 + 60 })
    })

    it("excuses only where a permission's time covers the lateness or early leave (review on #14)", () => {
        const late = [p("2026-10-04T10:00:00"), p("2026-10-04T17:00:00")]
        // An hour approved for noon covers nothing of a 09:00–10:00 lateness.
        expect(measure(work(), late, { permissions: [{ type: "LATE_ARRIVAL", startMinutes: 720, endMinutes: 780 }] })).toMatchObject({ lateMinutes: 60, excusedMinutes: 0 })
        // 09:30–10:30 covers its last half hour; two that overlap count once.
        expect(measure(work(), late, { permissions: [{ type: "LATE_ARRIVAL", startMinutes: 570, endMinutes: 630 }] })).toMatchObject({ lateMinutes: 30, excusedMinutes: 30 })
        expect(measure(work(), late, { permissions: [{ type: "LATE_ARRIVAL", startMinutes: 540, endMinutes: 580 }, { type: "LATE_ARRIVAL", startMinutes: 560, endMinutes: 590 }] }))
            .toMatchObject({ lateMinutes: 10, excusedMinutes: 50 })
        // The kind matters: leaving early is not excused by a late arrival's permission.
        expect(measure(work(), [p("2026-10-04T09:00:00"), p("2026-10-04T16:00:00")], { permissions: [{ type: "LATE_ARRIVAL", startMinutes: 960, endMinutes: 1020 }] }))
            .toMatchObject({ earlyLeaveMinutes: 60, excusedMinutes: 0 })
    })
})

describe("excused on the exceptions screen (§13.1)", () => {
    it("excuses the whole lateness or early leave, and records it as excused", () => {
        const day = measure(work(), [p("2026-10-04T10:30:00"), p("2026-10-04T15:00:00")], { excused: { lateness: true, earlyLeave: true } })
        expect(day).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 0, excusedMinutes: 90 + 120 })
    })

    it("charges nothing for an excused absence, which stays an absence", () => {
        const absent = measure(work(), [], { excused: { absence: true } })
        expect(absent).toMatchObject({ status: "ABSENT", excusedAbsence: true })
        const [priced] = priceMonth([{ day: absent, policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420 }])
        expect(priced).toMatchObject({ absenceDays: 0, deductionMinor: 0 })
    })
})

describe("pricing a month", () => {
    const day = (date: string, m: Partial<MeasuredDay>): MeasuredDay => ({
        date, status: "PRESENT", punchCount: 2, firstIn: null, lastOut: null, workedMinutes: 480,
        lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, excusedMinutes: 0, unpaidHoliday: false, excusedAbsence: false, ...m,
    })
    // 9,300.00 a month in a 31-day month: 300.00 a day, 30000 minor.
    const input = (d: MeasuredDay, extra: Partial<PricingInput> = {}): PricingInput =>
        ({ day: d, policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420, ...extra })

    it("lets the first two lates of the month go free, then charges by band, at that day's rate", () => {
        const priced = priceMonth([4, 5, 6, 7].map(d => input(day(`2026-10-0${d}`, { lateMinutes: 25 }))))
        expect(priced.map(x => [x.lateness.note, x.lateness.days, x.deductionMinor])).toEqual([
            ["FREE_OCCURRENCE", 0, 0], ["FREE_OCCURRENCE", 0, 0], ["CHARGED", 0.25, 7500], ["CHARGED", 0.25, 7500],
        ])
    })

    it("does not count lateness within grace as an occurrence", () => {
        const priced = priceMonth([input(day("2026-10-04", { lateMinutes: 10 })), input(day("2026-10-05", { lateMinutes: 40 }))])
        expect(priced.map(x => [x.lateness.note, x.lateness.occurrence])).toEqual([["WITHIN_GRACE", 0], ["FREE_OCCURRENCE", 1]])
    })

    it("escalates repeats and stops at the monthly cap", () => {
        const policy: PolicyBody = { ...STANDARD_OFFICE, lateness: { ...STANDARD_OFFICE.lateness, freePerMonth: 0, escalation: { fromOccurrence: 2, multiplier: 2 }, monthlyCapDays: 2 } }
        const priced = priceMonth([4, 5, 6].map(d => input(day(`2026-10-0${d}`, { lateMinutes: 90 }), { policy })))
        expect(priced.map(x => [x.lateness.note, x.lateness.days])).toEqual([["CHARGED", 1], ["CAPPED", 1], ["CAPPED", 0]])
    })

    it("prices days in date order whatever order they arrive in", () => {
        const priced = priceMonth([input(day("2026-10-07", { lateMinutes: 25 })), input(day("2026-10-04", { lateMinutes: 25 })), input(day("2026-10-05", { lateMinutes: 25 }))])
        expect(priced.map(x => [x.date, x.lateness.note])).toEqual([["2026-10-04", "FREE_OCCURRENCE"], ["2026-10-05", "FREE_OCCURRENCE"], ["2026-10-07", "CHARGED"]])
    })

    it("charges an absence the policy's multiplier, and leave, rest days and holidays nothing", () => {
        const priced = priceMonth([
            input(day("2026-10-04", { status: "ABSENT" })), input(day("2026-10-05", { status: "LEAVE" })), input(day("2026-10-06", { status: "REST" })),
            input(day("2026-10-07", { status: "ABSENT" }), { policy: { ...STANDARD_OFFICE, absence: { multiplier: 1.5 } } }),
        ])
        expect(priced.map(x => [x.absenceDays, x.deductionMinor])).toEqual([[1, 30000], [0, 0], [0, 0], [1.5, 45000]])
    })

    it("charges a day's pay for an unpaid company holiday not worked, and nothing for a paid one (review on #13)", () => {
        const unpaid: ExpectedDay = { ...HOLIDAY, holiday: { ...HOLIDAY.holiday, isPaid: false, source: "COMPANY" } } as ExpectedDay
        expect(measure(unpaid, [])).toMatchObject({ status: "HOLIDAY", unpaidHoliday: true })
        expect(measure(HOLIDAY, [])).toMatchObject({ status: "HOLIDAY", unpaidHoliday: false })
        const [off, paid] = priceMonth([input(measure(unpaid, [])), input(measure(HOLIDAY, []))])
        expect([off.absenceDays, off.deductionMinor, paid.deductionMinor]).toEqual([1, 30000, 0])
    })

    it("prices a deduction at the salary in force that day, not the month's last", () => {
        const priced = priceMonth([input(day("2026-10-04", { status: "ABSENT" }), { monthlyMinor: 620_000 }), input(day("2026-10-20", { status: "ABSENT" }))])
        expect(priced.map(x => x.deductionMinor)).toEqual([20000, 30000])
    })

    it("holds overtime that needs approval at zero until approved, and prices it by the kind of day", () => {
        const [pending] = priceMonth([input(day("2026-10-04", { overtimeMinutes: 60 }))])
        expect(pending).toMatchObject({ overtimeStatus: "PENDING", overtimeMinor: 0 })
        const [approved] = priceMonth([input(day("2026-10-04", { overtimeMinutes: 60 }), { overtimeDecision: { status: "APPROVED", minutes: 60 } })])
        // An hour of a 420-minute paid day at 300.00 a day, times 1.35.
        expect(approved).toMatchObject({ overtimeStatus: "APPROVED", overtimeMinor: Math.round(30000 * 60 / 420 * 1.35) })
        const noApproval: PolicyBody = { ...STANDARD_OFFICE, overtime: { ...STANDARD_OFFICE.overtime, requiresApproval: false } }
        const [holiday] = priceMonth([input(day("2026-10-06", { status: "WORKED_HOLIDAY", overtimeMinutes: 120 }), { policy: noApproval })])
        expect(holiday.overtimeMinor).toBe(Math.round(30000 * 120 / 420 * 3))
        const [short] = priceMonth([input(day("2026-10-04", { overtimeMinutes: 20 }), { policy: noApproval })])
        expect(short).toMatchObject({ overtimeStatus: "NOT_COUNTED", overtimeMinor: 0 })
    })

    it("pays approved overtime only up to what was worked, and rejected overtime not at all (P0.6)", () => {
        const [part] = priceMonth([input(day("2026-10-04", { overtimeMinutes: 90 }), { overtimeDecision: { status: "APPROVED", minutes: 30 } })])
        expect(part).toMatchObject({ overtimeStatus: "APPROVED", overtimeMinor: Math.round(30000 * 30 / 420 * 1.35) })
        const [more] = priceMonth([input(day("2026-10-04", { overtimeMinutes: 60 }), { overtimeDecision: { status: "APPROVED", minutes: 240 } })])
        expect(more.overtimeMinor).toBe(Math.round(30000 * 60 / 420 * 1.35))
        const [rejected] = priceMonth([input(day("2026-10-04", { overtimeMinutes: 60 }), { overtimeDecision: { status: "REJECTED", minutes: 0 } })])
        expect(rejected).toMatchObject({ overtimeStatus: "REJECTED", overtimeMinor: 0 })
    })

    it("prices nothing on an incomplete day, before a policy, or without a salary — and says which", () => {
        expect(priceMonth([input(day("2026-10-04", { status: "INCOMPLETE", lateMinutes: 90 }))])[0]).toMatchObject({ unpriced: "INCOMPLETE", deductionMinor: 0 })
        expect(priceMonth([input(day("2026-10-04", { status: "ABSENT" }), { policy: null })])[0]).toMatchObject({ unpriced: "NO_POLICY", deductionMinor: 0 })
        expect(priceMonth([input(day("2026-10-04", { status: "ABSENT" }), { monthlyMinor: null })])[0]).toMatchObject({ unpriced: "NO_SALARY", absenceDays: 1, deductionMinor: 0 })
        expect(priceMonth([input(day("2026-10-04", { status: "ABSENT" }), { policy: MEASURE_ONLY })])[0]).toMatchObject({ deductionMinor: 0 })
    })

    it("takes an hour of overtime as a share of the day's paid minutes", () => {
        expect(paidMinutesOf(work(540, 1020, 60), null)).toBe(420)
        expect(paidMinutesOf(REST, { startMinutes: 480, endMinutes: 960, breakMinutes: 0 })).toBe(480)
        expect(paidMinutesOf(REST, null)).toBe(480)
    })
})
