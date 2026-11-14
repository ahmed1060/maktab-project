import { describe, it, expect } from "vitest"
import { assignPunches, debounce, measureDay, priceMonth, paidMinutesOf, type EnginePunch, type PricingInput, type MeasuredDay } from "./engine"
import { STANDARD_OFFICE, MEASURE_ONLY, type PolicyBody } from "./policy"
import type { ExpectedDay } from "./calendar"

/**
 * The derivation engine (ATTENDANCE_PLAN.md §11): grouping punches by shift,
 * counting scans close together as one, reading a day first and last (§6.9,
 * round 10, PR 273), a departure to confirm (PR 274), an incomplete day
 * settled (PR 275), and pricing the month in order (§6.3–6.5).
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
    it("counts scans within the policy's window of the one kept before as one: 5 minutes to start (§6.9)", () => {
        const scans = [p("2026-10-04T09:00:00"), p("2026-10-04T09:00:40"), p("2026-10-04T09:04:59"), p("2026-10-04T09:05:00"), p("2026-10-04T09:08:00"), p("2026-10-04T09:10:30")]
        // Each is measured from the one kept before it, never from one left out.
        expect(debounce(scans, 5).map(x => x.at)).toEqual(["2026-10-04T09:00:00", "2026-10-04T09:05:00", "2026-10-04T09:10:30"])
        expect(debounce(scans, 1).map(x => x.at)).toEqual(["2026-10-04T09:00:00", "2026-10-04T09:04:59", "2026-10-04T09:08:00", "2026-10-04T09:10:30"])
        expect(debounce(scans).map(x => x.at)).toEqual(debounce(scans, 5).map(x => x.at))
    })

    it("reads a day first and last: the scans between are left out, so a break isn't measured (round 10, decision 1)", () => {
        const day = measure(work(), [p("2026-10-04T09:20:00"), p("2026-10-04T13:00:00"), p("2026-10-04T14:00:00"), p("2026-10-04T17:45:00")])
        expect(day).toMatchObject({ status: "PRESENT", punchCount: 4, firstIn: "2026-10-04T09:20:00", lastOut: "2026-10-04T17:45:00", workedMinutes: 505, lateMinutes: 20, earlyLeaveMinutes: 0, overtimeMinutes: 45 })
        const early = measure(work(), [p("2026-10-04T08:50:00"), p("2026-10-04T16:30:00")])
        expect(early).toMatchObject({ lateMinutes: 0, earlyLeaveMinutes: 30, overtimeMinutes: 0, workedMinutes: 460 })
    })

    it("counts as overtime the time past the shift's end up to the last scan", () => {
        const day = measure(work(), [p("2026-10-04T09:00:00"), p("2026-10-04T18:00:00"), p("2026-10-04T19:00:00"), p("2026-10-04T20:00:00")])
        expect(day).toMatchObject({ status: "PRESENT", overtimeMinutes: 180, workedMinutes: 660 })
    })

    it("no longer leaves a day incomplete for an extra scan: three scans are a day from the first to the last (decision 7)", () => {
        const day = measure(work(), [p("2026-10-04T08:55:00"), p("2026-10-04T09:02:00"), p("2026-10-04T17:05:00")])
        expect(day).toMatchObject({ status: "PRESENT", punchCount: 3, firstIn: "2026-10-04T08:55:00", lastOut: "2026-10-04T17:05:00", lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 5 })
        // A forgotten last scan reads as leaving early, so the day waits to be confirmed (PR 274).
        expect(measure(work(), [p("2026-10-04T08:55:00"), p("2026-10-04T12:00:00"), p("2026-10-04T12:40:00")]))
            .toMatchObject({ status: "TO_CONFIRM", lastOut: "2026-10-04T12:40:00", earlyLeaveMinutes: 260 })
    })

    it("scanning twice on arriving changes nothing (decision 8)", () => {
        const twice = measure(work(), [p("2026-10-04T08:55:00"), p("2026-10-04T08:57:00"), p("2026-10-04T17:05:00")])
        expect(twice).toMatchObject({ status: "PRESENT", punchCount: 2, firstIn: "2026-10-04T08:55:00", lastOut: "2026-10-04T17:05:00", workedMinutes: 490 })
    })

    it("never guesses a missing punch: one scan left after the window is incomplete, with only the lateness known", () => {
        expect(measure(work(), [p("2026-10-04T09:40:00")]))
            .toMatchObject({ status: "INCOMPLETE", punchCount: 1, firstIn: "2026-10-04T09:40:00", lastOut: null, lateMinutes: 40, earlyLeaveMinutes: 0, overtimeMinutes: 0, workedMinutes: 0 })
        // Two scans on arriving and none on leaving are one scan, never a day from 08:55 to 08:57.
        expect(measure(work(), [p("2026-10-04T08:55:00"), p("2026-10-04T08:57:00")]))
            .toMatchObject({ status: "INCOMPLETE", punchCount: 1, lastOut: null, earlyLeaveMinutes: 0 })
    })

    it("takes the window from the policy, anything from 1 to 60 minutes", () => {
        const scans = [p("2026-10-04T08:55:00"), p("2026-10-04T09:04:00")]
        expect(measure(work(), scans, { windowMinutes: 10 })).toMatchObject({ status: "INCOMPLETE", punchCount: 1 })
        // Two scans, read as a day from 08:55 to 09:04: one that waits to be confirmed (PR 274).
        expect(measure(work(), scans, { windowMinutes: 5 })).toMatchObject({ status: "TO_CONFIRM", punchCount: 2, lastOut: "2026-10-04T09:04:00" })
        expect(measure(work(), scans)).toMatchObject({ status: "TO_CONFIRM", punchCount: 2 })
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
        // First and last there too: a scan in between doesn't cut the time.
        expect(measure(REST, [p("2026-10-04T10:00:00"), p("2026-10-04T11:00:00"), p("2026-10-04T13:30:00")])).toMatchObject({ status: "WORKED_REST_DAY", workedMinutes: 210, overtimeMinutes: 210 })
        expect(measure(REST, [p("2026-10-04T10:00:00"), p("2026-10-04T10:03:00")])).toMatchObject({ status: "INCOMPLETE", overtimeMinutes: 0 })
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

describe("a departure to confirm (§6.9, round 10, decisions 13 and 23, PR 274)", () => {
    const left = (out: string) => [p("2026-10-04T09:00:00"), p(`2026-10-04T${out}:00`)]

    it("waits instead of charging early leave of more than the threshold, 2 hours to start, all else measured", () => {
        expect(measure(work(), [p("2026-10-04T09:30:00"), p("2026-10-04T12:00:00"), p("2026-10-04T12:40:00")])).toMatchObject({
            status: "TO_CONFIRM", punchCount: 3, firstIn: "2026-10-04T09:30:00", lastOut: "2026-10-04T12:40:00",
            workedMinutes: 190, lateMinutes: 30, earlyLeaveMinutes: 260, overtimeMinutes: 0,
        })
        // The threshold or less is early leave, charged by the policy as always.
        expect(measure(work(), left("15:00"))).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 120 })
        expect(measure(work(), left("14:59"))).toMatchObject({ status: "TO_CONFIRM", earlyLeaveMinutes: 121 })
    })

    it("takes the threshold from the policy, anything from 1 to 720 minutes", () => {
        expect(measure(work(), left("13:00"), { departureThresholdMinutes: 300 })).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 240 })
        expect(measure(work(), left("16:30"), { departureThresholdMinutes: 1 })).toMatchObject({ status: "TO_CONFIRM", earlyLeaveMinutes: 30 })
        expect(measure(work(), left("16:59"), { departureThresholdMinutes: 1 })).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 1 })
    })

    it("counts approved permission hours first: early leave they cover never makes the day wait (decision 23)", () => {
        const leaveEarly = (startMinutes: number) => ({ permissions: [{ type: "EARLY_LEAVE" as const, startMinutes, endMinutes: 1020 }] })
        // Three hours early on three approved hours.
        expect(measure(work(), left("14:00"), leaveEarly(840))).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0, excusedMinutes: 180 })
        // Half an hour approved of three: two and a half left, more than two.
        expect(measure(work(), left("14:00"), leaveEarly(990))).toMatchObject({ status: "TO_CONFIRM", earlyLeaveMinutes: 150, excusedMinutes: 30 })
        // An hour approved of three: two left, which is charged.
        expect(measure(work(), left("14:00"), leaveEarly(960))).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 120, excusedMinutes: 60 })
    })

    it("is settled by accepting the early leave, which is then charged, or by excusing it, which isn't", () => {
        expect(measure(work(), left("12:00"), { departureConfirmed: true })).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 300, excusedMinutes: 0 })
        expect(measure(work(), left("12:00"), { excused: { earlyLeave: true } })).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0, excusedMinutes: 300 })
        // Or by the departure scan, added: a day like any other.
        expect(measure(work(), [...left("12:00"), p("2026-10-04T17:00:00")])).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0, workedMinutes: 480 })
    })

    it("never waits on a rest day or holiday, which has no shift to leave early from, and leaves one scan incomplete", () => {
        expect(measure(REST, [p("2026-10-04T10:00:00"), p("2026-10-04T11:00:00")])).toMatchObject({ status: "WORKED_REST_DAY", overtimeMinutes: 60 })
        expect(measure(work(), [p("2026-10-04T09:00:00")])).toMatchObject({ status: "INCOMPLETE" })
    })

    it("charges nothing while it waits, its lateness included, and counts no occurrence of either", () => {
        const waiting = measure(work(), [p("2026-10-04T10:00:00"), p("2026-10-04T12:00:00")])
        const late = measure(work(), [p("2026-10-05T10:00:00"), p("2026-10-05T17:00:00")], { date: "2026-10-05" })
        const [priced, next] = priceMonth([
            { day: waiting, policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420 },
            { day: late, policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420 },
        ])
        expect(priced).toMatchObject({ status: "TO_CONFIRM", unpriced: "TO_CONFIRM", deductionDays: 0, deductionMinor: 0, lateness: { days: 0, occurrence: 0 } })
        // The next late arrival is the month's first.
        expect(next.lateness.occurrence).toBe(1)
    })
})

describe("an incomplete day settled (§6.9, round 10, decision 22, PR 275)", () => {
    const one = (at: string) => [p(`2026-10-04T${at}:00`)]
    const priced = (day: MeasuredDay) => priceMonth([{ day, policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420 }])[0]

    it("is waiting on its missing scan until somebody settles it", () => {
        expect(measure(work(), one("09:40"))).toMatchObject({ status: "INCOMPLETE", punchCount: 1, lateMinutes: 40 })
        expect(priced(measure(work(), one("09:40")))).toMatchObject({ unpriced: "INCOMPLETE", deductionMinor: 0 })
    })

    it("marked absent, is an absence the policy charges, its one scan kept and its lateness not counted", () => {
        const day = measure(work(), one("09:40"), { incomplete: "ABSENT" })
        expect(day).toMatchObject({ status: "ABSENT", settled: "ABSENT", punchCount: 1, firstIn: "2026-10-04T09:40:00", lateMinutes: 0, excusedAbsence: false })
        // 300.00 a day, an absence a whole day.
        expect(priced(day)).toMatchObject({ absenceDays: 1, deductionMinor: 30000, unpriced: null, lateness: { occurrence: 0 } })
    })

    it("accepted as it is, is present and charged nothing, its lateness included", () => {
        const day = measure(work(), one("09:40"), { incomplete: "AS_IT_IS" })
        expect(day).toMatchObject({ status: "PRESENT", settled: "AS_IT_IS", punchCount: 1, lateMinutes: 0, earlyLeaveMinutes: 0, excusedMinutes: 40, workedMinutes: 0, overtimeMinutes: 0 })
        expect(priced(day)).toMatchObject({ deductionMinor: 0, unpriced: null, lateness: { occurrence: 0 } })
    })

    it("on a rest day or holiday, can only be accepted, as worked with no overtime", () => {
        expect(measure(REST, one("10:00"), { incomplete: "AS_IT_IS" })).toMatchObject({ status: "WORKED_REST_DAY", settled: "AS_IT_IS", workedMinutes: 0, overtimeMinutes: 0 })
        expect(measure(HOLIDAY, one("10:00"), { incomplete: "AS_IT_IS" })).toMatchObject({ status: "WORKED_HOLIDAY", unpaidHoliday: false, overtimeMinutes: 0 })
        // Nobody was expected, so nobody is absent.
        expect(measure(REST, one("10:00"), { incomplete: "ABSENT" })).toMatchObject({ status: "INCOMPLETE" })
    })

    it("counts only while the day has its one scan: an absence with none, or a day with both, is measured as it is", () => {
        expect(measure(work(), [], { incomplete: "AS_IT_IS" })).toMatchObject({ status: "ABSENT", excusedAbsence: false })
        expect(measure(work(), [...one("09:00"), p("2026-10-04T17:00:00")], { incomplete: "ABSENT" })).toMatchObject({ status: "PRESENT", workedMinutes: 480 })
        expect(measure(work(), [...one("09:00"), p("2026-10-04T17:00:00")], { incomplete: "ABSENT" }).settled).toBeUndefined()
    })
})

describe("excused on the exceptions screen (§13.1)", () => {
    it("excuses the whole lateness or early leave, and records it as excused", () => {
        const day = measure(work(), [p("2026-10-04T10:30:00"), p("2026-10-04T15:00:00")], { excused: { lateness: true, earlyLeave: true } })
        expect(day).toMatchObject({ status: "PRESENT", lateMinutes: 0, earlyLeaveMinutes: 0, excusedMinutes: 90 + 120 })
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

    it("splits a day's deduction by its cause, each part rounded alone, the whole their sum (§12.2)", () => {
        // A third of a day's pay three ways, at 100.00 a day (3,100.00 over 31 days).
        const rule = { enabled: true, graceMinutes: 0, mode: "BANDS" as const, bands: [{ fromMinutes: 1, toMinutes: null, dayFraction: 1 / 3 }], freePerMonth: 0, escalation: null, monthlyCapDays: null }
        const policy: PolicyBody = { ...STANDARD_OFFICE, lateness: rule, earlyLeave: rule }
        const [d] = priceMonth([input(day("2026-10-04", { lateMinutes: 10, earlyLeaveMinutes: 10 }), { policy, monthlyMinor: 310_000 })])
        expect(d.deductionParts).toEqual({ lateness: 3333, earlyLeave: 3333, absence: 0 })
        expect(d.deductionMinor).toBe(6666)
        const [a] = priceMonth([input(day("2026-10-05", { status: "ABSENT" }), { monthlyMinor: 310_000 })])
        expect(a.deductionParts).toEqual({ lateness: 0, earlyLeave: 0, absence: 10000 })
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
        expect(priceMonth([input(day("2026-10-04", { status: "TO_CONFIRM", lateMinutes: 90, earlyLeaveMinutes: 200 }))])[0]).toMatchObject({ unpriced: "TO_CONFIRM", deductionMinor: 0 })
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
