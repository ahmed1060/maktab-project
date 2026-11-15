import { describe, it, expect } from "vitest"
import { assignPunches, debounce, measureDay, priceMonth, paidMinutesOf, type EnginePunch, type PricingInput, type MeasuredDay } from "./engine"
import { STANDARD_OFFICE, MEASURE_ONLY, type MissionAllowance, type PolicyBody } from "./policy"
import type { ExpectedDay } from "./calendar"

/**
 * The derivation engine (ATTENDANCE_PLAN.md §11): grouping punches by shift,
 * counting scans close together as one, reading a day first and last (§6.9,
 * round 10, PR 273), a departure to confirm (PR 274), an incomplete day
 * settled (PR 275), a mission's day (§6.10, PR 281), pricing the month
 * in order (§6.3–6.5), and each date's mission allowance (§6.10, PR 287).
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

describe("a mission's day (§6.10, round 10, decisions 9, 15 and 23, PR 281)", () => {
    const at = (time: string) => p(`2026-10-04T${time}:00`)
    const priced = (day: MeasuredDay) => priceMonth([{ day, policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420 }])[0]
    const NOTHING = { lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, workedMinutes: 0, excusedMinutes: 0 }

    it("by days, makes a working day a mission day, with no scans needed and nothing charged", () => {
        expect(measure(work(), [], { mission: "DAYS" })).toMatchObject({ status: "MISSION", mission: "DAYS", punchCount: 0, excusedAbsence: false, ...NOTHING })
        expect(priced(measure(work(), [], { mission: "DAYS" }))).toMatchObject({ absenceDays: 0, deductionDays: 0, deductionMinor: 0, unpriced: null })
    })

    it("by days, keeps and shows the scans that arrive, which change nothing", () => {
        // Late in, early out, and one scan alone: never late, early, incomplete or waiting.
        expect(measure(work(), [at("10:30"), at("12:00")], { mission: "DAYS" })).toMatchObject({
            status: "MISSION", punchCount: 2, firstIn: "2026-10-04T10:30:00", lastOut: "2026-10-04T12:00:00", ...NOTHING,
        })
        expect(measure(work(), [at("09:40")], { mission: "DAYS" })).toMatchObject({ status: "MISSION", punchCount: 1, ...NOTHING })
        // Past the shift's end adds no overtime (decision 5).
        expect(measure(work(), [at("09:00"), at("20:00")], { mission: "DAYS" })).toMatchObject({ status: "MISSION", overtimeMinutes: 0 })
        // Nor is a lateness occurrence counted towards the month's.
        const [, next] = priceMonth([
            { day: measure(work(), [at("10:30"), at("17:00")], { mission: "DAYS" }), policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420 },
            { day: measure(work(), [p("2026-10-05T10:30:00"), p("2026-10-05T17:00:00")], { date: "2026-10-05" }), policy: STANDARD_OFFICE, monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420 },
        ])
        expect(next.lateness.occurrence).toBe(1)
    })

    it("by days, leaves rest days and holidays as they are, scans or not, adding no overtime (decision 9)", () => {
        expect(measure(REST, [], { mission: "DAYS" })).toMatchObject({ status: "REST", mission: "DAYS" })
        expect(measure(REST, [at("10:00"), at("15:00")], { mission: "DAYS" })).toMatchObject({ status: "REST", mission: "DAYS", punchCount: 2, ...NOTHING })
        expect(measure(REST, [at("10:00")], { mission: "DAYS" })).toMatchObject({ status: "REST", punchCount: 1 })
        expect(measure(HOLIDAY, [at("10:00"), at("15:00")], { mission: "DAYS" })).toMatchObject({ status: "HOLIDAY", mission: "DAYS", overtimeMinutes: 0 })
        // An unpaid holiday stays unpaid, as for everyone else.
        const unpaid: ExpectedDay = { ...HOLIDAY, holiday: { ...(HOLIDAY as Extract<ExpectedDay, { kind: "HOLIDAY" }>).holiday, isPaid: false } }
        expect(measure(unpaid, [at("10:00"), at("15:00")], { mission: "DAYS" })).toMatchObject({ status: "HOLIDAY", unpaidHoliday: true })
    })

    it("until the end of the day, reads one scan as the arrival, its lateness charged, the day present", () => {
        expect(measure(work(), [at("09:40")], { mission: "TO_END" })).toMatchObject({
            status: "PRESENT", mission: "TO_END", punchCount: 1, firstIn: "2026-10-04T09:40:00", lastOut: null,
            lateMinutes: 40, earlyLeaveMinutes: 0, workedMinutes: 0, overtimeMinutes: 0,
        })
        // Approved late-arrival hours excuse it as on any day.
        expect(measure(work(), [at("09:40")], { mission: "TO_END", permissions: [{ type: "LATE_ARRIVAL", startMinutes: 540, endMinutes: 600 }] }))
            .toMatchObject({ status: "PRESENT", lateMinutes: 0, excusedMinutes: 40 })
        expect(priced(measure(work(), [at("09:40")], { mission: "TO_END" }))).toMatchObject({ unpriced: null, lateness: { minutes: 40 } })
    })

    it("until the end of the day, reads two scans first and last without the early leave, so it never waits (decision 23)", () => {
        expect(measure(work(), [at("09:00"), at("11:00")], { mission: "TO_END" })).toMatchObject({
            status: "PRESENT", lastOut: "2026-10-04T11:00:00", workedMinutes: 120, earlyLeaveMinutes: 0, lateMinutes: 0,
        })
        expect(measure(work(), [at("09:30"), at("12:00")], { mission: "TO_END", departureThresholdMinutes: 1 })).toMatchObject({ status: "PRESENT", lateMinutes: 30, earlyLeaveMinutes: 0 })
        // Overtime from its own scans past the shift's end counts as on any day.
        expect(measure(work(), [at("09:00"), at("18:30")], { mission: "TO_END" })).toMatchObject({ status: "PRESENT", overtimeMinutes: 90 })
    })

    it("from the start of the day, reads one scan as the departure: no lateness, its early leave charged", () => {
        expect(measure(work(), [at("16:00")], { mission: "FROM_START" })).toMatchObject({
            status: "PRESENT", mission: "FROM_START", punchCount: 1, firstIn: null, lastOut: "2026-10-04T16:00:00",
            lateMinutes: 0, earlyLeaveMinutes: 60, workedMinutes: 0, overtimeMinutes: 0,
        })
        expect(priced(measure(work(), [at("16:00")], { mission: "FROM_START" }))).toMatchObject({ unpriced: null, earlyLeave: { minutes: 60 } })
        // Past the shift's end, overtime.
        expect(measure(work(), [at("18:00")], { mission: "FROM_START" })).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0, overtimeMinutes: 60 })
    })

    it("from the start of the day, waits like any day when that early leave is more than the threshold (decision 23)", () => {
        expect(measure(work(), [at("12:00")], { mission: "FROM_START" })).toMatchObject({ status: "TO_CONFIRM", lastOut: "2026-10-04T12:00:00", earlyLeaveMinutes: 300 })
        expect(priced(measure(work(), [at("12:00")], { mission: "FROM_START" }))).toMatchObject({ unpriced: "TO_CONFIRM", deductionMinor: 0 })
        // Approved permission hours count first, and accepting the early leave settles it.
        expect(measure(work(), [at("12:00")], { mission: "FROM_START", permissions: [{ type: "EARLY_LEAVE", startMinutes: 720, endMinutes: 1020 }] }))
            .toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 0, excusedMinutes: 300 })
        expect(measure(work(), [at("12:00")], { mission: "FROM_START", departureConfirmed: true })).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 300 })
    })

    it("from the start of the day, reads two scans first and last without the lateness", () => {
        expect(measure(work(), [at("10:30"), at("16:00")], { mission: "FROM_START" })).toMatchObject({
            status: "PRESENT", firstIn: "2026-10-04T10:30:00", lateMinutes: 0, earlyLeaveMinutes: 60, workedMinutes: 330,
        })
    })

    it("by hours, leaves a working day with no scan at all absent", () => {
        expect(measure(work(), [], { mission: "TO_END" })).toMatchObject({ status: "ABSENT", mission: "TO_END" })
        expect(measure(work(), [], { mission: "FROM_START" })).toMatchObject({ status: "ABSENT", mission: "FROM_START" })
    })

    it("by hours, needs only one scan, so a day settled for its one scan is measured as the mission reads it", () => {
        const absent = measure(work(), [at("09:40")], { mission: "TO_END", incomplete: "ABSENT" })
        expect(absent).toMatchObject({ status: "PRESENT", lateMinutes: 40 })
        expect(absent.settled).toBeUndefined()
        expect(measure(work(), [at("16:00")], { mission: "FROM_START", incomplete: "AS_IT_IS" })).toMatchObject({ status: "PRESENT", earlyLeaveMinutes: 60 })
    })

    it("by hours, changes nothing on a rest day or holiday, which has no shift to be late or early for", () => {
        expect(measure(REST, [at("10:00"), at("12:00")], { mission: "TO_END" })).toMatchObject({ status: "WORKED_REST_DAY", overtimeMinutes: 120 })
        expect(measure(REST, [at("10:00"), at("12:00")], { mission: "TO_END" }).mission).toBeUndefined()
    })

    it("comes after leave and a suspension", () => {
        expect(measure(work(), [], { mission: "DAYS", onLeave: true })).toMatchObject({ status: "LEAVE" })
        expect(measure(work(), [at("16:00")], { mission: "FROM_START", suspended: true })).toMatchObject({ status: "SUSPENDED" })
        expect(measure(work(), [], { mission: "DAYS", onLeave: true }).mission).toBeUndefined()
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

describe("a mission's allowance, date by date (§6.10, decisions 6, 9 and 12, PR 287)", () => {
    const day = (date: string, m: Partial<MeasuredDay> = {}): MeasuredDay => ({
        date, status: "MISSION", punchCount: 0, firstIn: null, lastOut: null, workedMinutes: 0,
        lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0, excusedMinutes: 0, unpaidHoliday: false, excusedAbsence: false, ...m,
    })
    // One day worth 200.00, a mission by days paying one for each date and a mission by hours a half: the plan's example.
    const paying = (allowance: Partial<MissionAllowance> = {}): PolicyBody =>
        ({ ...STANDARD_OFFICE, missions: { enabled: true, allowance: { dayWorth: "AMOUNT", amountMinor: 20_000, days: 1, hours: 0.5, ...allowance } } })
    // 9,300.00 a month in a 31-day month: 300.00 a day.
    const input = (d: MeasuredDay, extra: Partial<PricingInput> = {}): PricingInput =>
        ({ day: d, policy: paying(), monthlyMinor: 930_000, daysInMonth: 31, paidMinutes: 420, mission: "DAYS", ...extra })
    const allowance = (...inputs: PricingInput[]) => priceMonth(inputs).map(x => x.missionAllowanceMinor)

    it("is nothing until the policy says what a mission pays (decision 12)", () => {
        expect(STANDARD_OFFICE.missions.allowance).toMatchObject({ days: 0, hours: 0 })
        expect(allowance(input(day("2026-10-04"), { policy: STANDARD_OFFICE }), input(day("2026-10-05"), { policy: STANDARD_OFFICE, mission: "TO_END" }))).toEqual([0, 0])
    })

    it("pays a mission by days for each of its dates, a rest day and a holiday included (decision 9)", () => {
        // Thursday to Saturday: the plan's three-day mission, 600.00 in all.
        const paid = allowance(
            input(day("2026-10-08")),
            input(day("2026-10-09", { status: "REST", mission: "DAYS" })),
            input(day("2026-10-10", { status: "HOLIDAY", mission: "DAYS" })),
        )
        expect(paid).toEqual([20_000, 20_000, 20_000])
    })

    it("pays a mission by hours what its kind pays, whichever part of the day it covers", () => {
        expect(allowance(
            input(day("2026-10-04", { status: "PRESENT", mission: "TO_END" }), { mission: "TO_END" }),
            input(day("2026-10-05", { status: "PRESENT", mission: "FROM_START" }), { mission: "FROM_START" }),
        )).toEqual([10_000, 10_000])
        expect(allowance(input(day("2026-10-04"), { policy: paying({ hours: 0 }), mission: "TO_END" }))).toEqual([0])
        expect(allowance(input(day("2026-10-04"), { policy: paying({ days: 0 }) }))).toEqual([0])
    })

    it("follows the approved mission, not the day's scans: absent, incomplete or waiting, its date is paid", () => {
        const paid = priceMonth([
            input(day("2026-10-04", { status: "ABSENT", mission: "TO_END" }), { mission: "TO_END" }),
            input(day("2026-10-05", { status: "TO_CONFIRM", mission: "FROM_START", earlyLeaveMinutes: 200 }), { mission: "FROM_START" }),
            input(day("2026-10-06", { status: "INCOMPLETE" }), { mission: "TO_END" }),
            // A mission by hours on a day off, which the day itself doesn't read (PR 281).
            input(day("2026-10-09", { status: "REST" }), { mission: "TO_END" }),
        ])
        expect(paid.map(x => [x.missionAllowanceMinor, x.unpriced])).toEqual([[10_000, null], [10_000, "TO_CONFIRM"], [10_000, "INCOMPLETE"], [10_000, null]])
        // The absence is still an absence.
        expect(paid[0]).toMatchObject({ absenceDays: 1, deductionMinor: 30_000 })
    })

    it("pays nothing on a date with no mission, whatever the day read", () => {
        expect(allowance(input(day("2026-10-04", { status: "PRESENT" }), { mission: null }), input(day("2026-10-05"), { mission: undefined }))).toEqual([0, 0])
    })

    it("takes one day as the amount typed in, the same for everyone, with a salary or none", () => {
        const policy = paying({ days: 2, hours: 0.25 })
        expect(allowance(
            input(day("2026-10-04"), { policy }),
            input(day("2026-10-05"), { policy, monthlyMinor: 310_000 }),
            input(day("2026-10-06"), { policy, monthlyMinor: null }),
            input(day("2026-10-07", { status: "PRESENT" }), { policy, mission: "TO_END", monthlyMinor: null }),
        )).toEqual([40_000, 40_000, 40_000, 5_000])
    })

    it("takes one day as the employee's own day's pay: that date's salary over its month's days, as a deduction is priced", () => {
        const policy = paying({ dayWorth: "OWN_PAY", amountMinor: 0, days: 1, hours: 0.5 })
        expect(allowance(
            // 9,300.00 over October's 31 days, then 12,000.00 from a raise mid-month, then a 30-day month.
            input(day("2026-10-04"), { policy }),
            input(day("2026-10-20"), { policy, monthlyMinor: 1_200_000 }),
            input(day("2026-11-03"), { policy, daysInMonth: 30 }),
            input(day("2026-11-04", { status: "PRESENT" }), { policy, daysInMonth: 30, mission: "FROM_START" }),
        )).toEqual([30_000, 38_710, 31_000, 15_500])
        // An amount left typed in from before counts for nothing once a day is their own pay.
        expect(allowance(input(day("2026-10-04"), { policy: paying({ dayWorth: "OWN_PAY", amountMinor: 99_900 }) }))).toEqual([30_000])
    })

    it("pays nothing that date when one day is their own pay and they have no salary", () => {
        const [d] = priceMonth([input(day("2026-10-04"), { policy: paying({ dayWorth: "OWN_PAY" }), monthlyMinor: null })])
        expect(d).toMatchObject({ missionAllowanceMinor: 0, unpriced: "NO_SALARY" })
    })

    it("rounds each date to the piastre on its own", () => {
        // 10,000.00 over 31 days is 322.5806… a day: a quarter of it 80.65, and twice it 645.16.
        const own = (days: 0.25 | 2) => paying({ dayWorth: "OWN_PAY", days })
        expect(allowance(input(day("2026-10-04"), { policy: own(0.25), monthlyMinor: 1_000_000 }), input(day("2026-10-05"), { policy: own(2), monthlyMinor: 1_000_000 }))).toEqual([8_065, 64_516])
        // A quarter of 0.01 rounds to nothing; a half rounds up.
        expect(allowance(input(day("2026-10-04"), { policy: paying({ amountMinor: 1, days: 0.25 }) }), input(day("2026-10-05"), { policy: paying({ amountMinor: 1, days: 0.5 }) }))).toEqual([0, 1])
    })

    it("pays nothing before the company has a policy", () => {
        expect(priceMonth([input(day("2026-10-04"), { policy: null })])[0]).toMatchObject({ missionAllowanceMinor: 0, unpriced: "NO_POLICY" })
    })

    it("pays by the policy in force on each date", () => {
        expect(allowance(input(day("2026-10-04")), input(day("2026-10-05"), { policy: paying({ amountMinor: 35_000 }) }), input(day("2026-10-06"), { policy: STANDARD_OFFICE }))).toEqual([20_000, 35_000, 0])
    })

    it("pays whether or not missions can still be asked for: one approved before still counts", () => {
        const off: PolicyBody = { ...paying(), missions: { ...paying().missions, enabled: false } }
        expect(allowance(input(day("2026-10-04"), { policy: off }))).toEqual([20_000])
    })

    it("leaves the day's deduction and overtime as they were", () => {
        const late = day("2026-10-06", { status: "PRESENT", mission: "TO_END", lateMinutes: 90, overtimeMinutes: 60 })
        const noApproval: PolicyBody = { ...paying(), lateness: { ...STANDARD_OFFICE.lateness, freePerMonth: 0 }, overtime: { ...STANDARD_OFFICE.overtime, requiresApproval: false } }
        const [withMission] = priceMonth([input(late, { policy: noApproval, mission: "TO_END" })])
        const [without] = priceMonth([input(late, { policy: noApproval, mission: null })])
        expect(withMission.missionAllowanceMinor).toBe(10_000)
        expect(without.missionAllowanceMinor).toBe(0)
        expect([withMission.deductionMinor, withMission.overtimeMinor]).toEqual([without.deductionMinor, without.overtimeMinor])
        expect(withMission.deductionMinor).toBeGreaterThan(0)
        expect(withMission.overtimeMinor).toBeGreaterThan(0)
    })
})
