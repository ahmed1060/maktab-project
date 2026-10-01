import { describe, it, expect } from "vitest"
import {
    DEFAULT_WORK_WEEK, isDateString, weekdayOf, addDays, hoursProblem, workWeekProblem, dayHoursProblem,
    versionOn, overrideOn, scheduleIdOn, spanOf, overridesOverlap, observedHolidays, expectedDay,
    formatMinutes, parseTime, shiftEnd, type Schedule, type Version, type Override,
} from "./calendar"

/**
 * The calendar's rules (ATTENDANCE_PLAN.md §6.1, §6.2, §7). 2026-03-01 is a
 * Sunday, so the first week of March 2026 runs Sunday the 1st to Saturday the 7th.
 */

const v = (over: Partial<Version> = {}): Version => ({
    id: "v1", effectiveFrom: "2026-01-01", startMinutes: 540, endMinutes: 1020, breakMinutes: 60,
    workWeek: [], days: [], ...over,
})
const o = (over: Partial<Override> = {}): Override => ({
    id: "ramadan", name: "Ramadan", startDate: "2026-02-18", endDate: "2026-03-19",
    startMinutes: 600, endMinutes: 900, breakMinutes: 0, days: [], ...over,
})
const office = (over: Partial<Schedule> = {}): Schedule => ({ id: "office", versions: [v()], overrides: [], ...over })

describe("dates", () => {
    it("accepts real calendar dates only", () => {
        expect(isDateString("2026-03-01")).toBe(true)
        expect(isDateString("2028-02-29")).toBe(true)
        for (const bad of ["2026-02-30", "2026-13-01", "2026-3-1", "", "2026-03-01T00:00:00Z", 20260301, null]) {
            expect(isDateString(bad), String(bad)).toBe(false)
        }
    })

    it("counts weekdays from Sunday, as the work week does", () => {
        expect(weekdayOf("2026-03-01")).toBe(0)
        expect(weekdayOf("2026-03-05")).toBe(4)
        expect(weekdayOf("2026-03-06")).toBe(5)
    })

    it("steps across month and year ends", () => {
        expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
        expect(addDays("2026-12-31", 1)).toBe("2027-01-01")
        expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    })
})

describe("hours", () => {
    it("accepts an ordinary day and a night shift past midnight", () => {
        expect(hoursProblem(540, 1020, 60)).toBeNull()
        expect(hoursProblem(1320, 1800, 30)).toBeNull() // 22:00 to 06:00 next day
    })

    it("refuses hours that cannot be a shift", () => {
        expect(hoursProblem(-1, 600)).toBe("START_OUT_OF_DAY")
        expect(hoursProblem(1440, 1500)).toBe("START_OUT_OF_DAY")
        expect(hoursProblem(600, 600)).toBe("END_NOT_AFTER_START")
        expect(hoursProblem(600, 540)).toBe("END_NOT_AFTER_START")
        expect(hoursProblem(0, 1441)).toBe("SHIFT_TOO_LONG")
        expect(hoursProblem(540, 600, 60)).toBe("BREAK_TOO_LONG")
        expect(hoursProblem(540, 600, -5)).toBe("BREAK_TOO_LONG")
        expect(hoursProblem(540.5, 600)).toBe("HOURS_NOT_WHOLE_MINUTES")
    })

    it("checks a work week and per-weekday hours", () => {
        expect(workWeekProblem([], { allowEmpty: true })).toBeNull()
        expect(workWeekProblem([], { allowEmpty: false })).toBe("WORK_WEEK_EMPTY")
        expect(workWeekProblem([0, 7], { allowEmpty: true })).toBe("WORK_WEEK_INVALID_DAY")
        expect(workWeekProblem([1, 1], { allowEmpty: true })).toBe("WORK_WEEK_DUPLICATE_DAY")
        expect(dayHoursProblem([{ weekday: 4, startMinutes: 540, endMinutes: 840 }])).toBeNull()
        expect(dayHoursProblem([{ weekday: 4, startMinutes: 540, endMinutes: 500 }])).toBe("END_NOT_AFTER_START")
        expect(dayHoursProblem([{ weekday: 4, startMinutes: 540, endMinutes: 600 }, { weekday: 4, startMinutes: 540, endMinutes: 600 }])).toBe("WORK_WEEK_DUPLICATE_DAY")
        // The schedule's break applies to its short days too (review on #10):
        // a 30-minute Thursday under a 60-minute break would be paid negative time.
        expect(dayHoursProblem([{ weekday: 4, startMinutes: 540, endMinutes: 570 }], 60)).toBe("BREAK_TOO_LONG")
    })

    it("reads and writes clock times, with a night shift ending the next day", () => {
        expect(parseTime("09:00")).toBe(540)
        expect(parseTime("23:59")).toBe(1439)
        expect(parseTime("24:00")).toBeNull()
        expect(parseTime("9:00")).toBeNull()
        expect(formatMinutes(540)).toBe("09:00")
        expect(formatMinutes(1800)).toBe("06:00 (+1)")
        expect(shiftEnd(1320, 360)).toBe(1800)
        expect(shiftEnd(540, 1020)).toBe(1020)
        expect(shiftEnd(540, 540)).toBe(1980) // a full 24 hours, not zero
    })
})

describe("effective dating (§6.1)", () => {
    const versions = [v({ id: "jan", effectiveFrom: "2026-01-01" }), v({ id: "apr", effectiveFrom: "2026-04-01", startMinutes: 480 })]

    it("measures each date against the version that applied on it", () => {
        expect(versionOn(versions, "2026-03-31")?.id).toBe("jan")
        expect(versionOn(versions, "2026-04-01")?.id).toBe("apr")
        expect(versionOn(versions, "2027-01-01")?.id).toBe("apr")
    })

    it("has nothing before the first version, whatever order the rows come in", () => {
        expect(versionOn(versions, "2025-12-31")).toBeNull()
        expect(versionOn([...versions].reverse(), "2026-05-01")?.id).toBe("apr")
    })

    it("follows a person's assignments, falling back to the company default", () => {
        const assignments = [{ scheduleId: "warehouse", effectiveFrom: "2026-03-10" }, { scheduleId: "office", effectiveFrom: "2026-06-01" }]
        const defaults = [{ scheduleId: "office", effectiveFrom: "2026-01-01" }]
        expect(scheduleIdOn(assignments, defaults, "2026-03-09")).toBe("office")
        expect(scheduleIdOn(assignments, defaults, "2026-03-10")).toBe("warehouse")
        expect(scheduleIdOn(assignments, defaults, "2026-06-01")).toBe("office")
        expect(scheduleIdOn([], [], "2026-03-01")).toBeNull()
    })

    it("moves unassigned people to a new default from its date, never before (review on #10)", () => {
        const defaults = [{ scheduleId: "office", effectiveFrom: "2026-01-01" }, { scheduleId: "night", effectiveFrom: "2026-11-01" }]
        expect(scheduleIdOn([], defaults, "2026-09-15")).toBe("office")
        expect(scheduleIdOn([], defaults, "2026-11-01")).toBe("night")
        expect(scheduleIdOn([], defaults, "2025-12-31")).toBeNull()
    })

    it("knows the span a dated change governs, up to the next one", () => {
        expect(spanOf(["2026-01-01", "2026-04-01", "2026-10-01"], "2026-04-01")).toEqual({ from: "2026-04-01", until: "2026-10-01" })
        expect(spanOf(["2026-01-01", "2026-04-01"], "2026-08-01")).toEqual({ from: "2026-08-01", until: null })
    })
})

describe("overrides (§7.1)", () => {
    it("covers its dates inclusive, and nothing else", () => {
        const ramadan = o()
        expect(overrideOn([ramadan], "2026-02-18")?.id).toBe("ramadan")
        expect(overrideOn([ramadan], "2026-03-19")?.id).toBe("ramadan")
        expect(overrideOn([ramadan], "2026-03-20")).toBeNull()
    })

    it("knows when two overrides share a day", () => {
        expect(overridesOverlap(o(), o({ startDate: "2026-03-19", endDate: "2026-03-25" }))).toBe(true)
        expect(overridesOverlap(o(), o({ startDate: "2026-03-20", endDate: "2026-03-25" }))).toBe(false)
    })
})

describe("holidays (§7.2)", () => {
    const central = [
        { id: "labour", date: "2026-05-01", name: "Labour Day" },
        { id: "sinai", date: "2026-04-25", name: "Sinai Liberation Day" },
    ]

    it("inherits the central calendar, less what the company opted out of", () => {
        const days = observedHolidays(central, new Set(["sinai"]), [], "2026-01-01", "2026-12-31")
        expect([...days.keys()]).toEqual(["2026-05-01"])
        expect(days.get("2026-05-01")).toMatchObject({ source: "PUBLIC", isPaid: true })
    })

    it("adds the company's own, which win a date both name", () => {
        const own = [
            { id: "anniv", date: "2026-05-01", name: "Founding day", isPaid: true },
            { id: "local", date: "2026-07-10", name: "Local holiday", isPaid: false },
        ]
        const days = observedHolidays(central, new Set(), own, "2026-01-01", "2026-12-31")
        expect(days.get("2026-05-01")).toMatchObject({ source: "COMPANY", name: "Founding day" })
        expect(days.get("2026-07-10")).toMatchObject({ isPaid: false })
        expect(days.has("2026-04-25")).toBe(true)
    })

    it("keeps to the dates asked for", () => {
        expect(observedHolidays(central, new Set(), [], "2026-05-02", "2026-12-31").size).toBe(0)
    })
})

describe("what a date is for one person", () => {
    const day = (date: string, schedule: Schedule | null = office(), holiday = null as any) =>
        expectedDay({ date, schedule, companyWorkWeek: DEFAULT_WORK_WEEK, holiday })

    it("works Sunday to Thursday by default and rests Friday and Saturday", () => {
        expect(day("2026-03-29")).toMatchObject({ kind: "WORK", hours: { startMinutes: 540, endMinutes: 1020, breakMinutes: 60 }, versionId: "v1" })
        expect(day("2026-04-03").kind).toBe("REST")
        expect(day("2026-04-04").kind).toBe("REST")
    })

    it("lets a schedule work a different week from the company's", () => {
        const warehouse = office({ versions: [v({ workWeek: [6, 0, 1, 2, 3, 4] })] })
        expect(day("2026-04-04", warehouse).kind).toBe("WORK")
        expect(day("2026-04-03", warehouse).kind).toBe("REST")
    })

    it("takes a weekday's own hours: a short Thursday", () => {
        const s = office({ versions: [v({ days: [{ weekday: 4, startMinutes: 540, endMinutes: 840 }] })] })
        expect(day("2026-04-02", s)).toMatchObject({ kind: "WORK", hours: { endMinutes: 840 } })
        expect(day("2026-04-01", s)).toMatchObject({ kind: "WORK", hours: { endMinutes: 1020 } })
    })

    it("uses the override's hours on working days, and leaves rest days as rest", () => {
        const s = office({ overrides: [o()] })
        expect(day("2026-03-01", s)).toMatchObject({ kind: "WORK", hours: { startMinutes: 600, endMinutes: 900, breakMinutes: 0 }, overrideId: "ramadan", versionId: "v1" })
        expect(day("2026-03-06", s).kind).toBe("REST")
        expect(day("2026-03-22", s)).toMatchObject({ kind: "WORK", overrideId: null, hours: { startMinutes: 540 } })
    })

    it("puts a holiday above the schedule, still naming the version for the record", () => {
        const labour = { id: "labour", date: "2026-04-30", name: "Labour Day", isPaid: true, source: "PUBLIC" as const }
        expect(day("2026-04-30", office(), labour)).toMatchObject({ kind: "HOLIDAY", versionId: "v1", holiday: { name: "Labour Day" } })
    })

    it("has no expectation without a schedule or before its first version", () => {
        expect(day("2026-03-01", null).kind).toBe("NO_SCHEDULE")
        expect(day("2025-12-31").kind).toBe("NO_SCHEDULE")
    })

    it("follows a new version from its date and not before", () => {
        const s = office({ versions: [v(), v({ id: "v2", effectiveFrom: "2026-04-01", startMinutes: 480, endMinutes: 960 })] })
        expect(day("2026-03-31", s)).toMatchObject({ versionId: "v1", hours: { startMinutes: 540 } })
        expect(day("2026-04-01", s)).toMatchObject({ versionId: "v2", hours: { startMinutes: 480 } })
    })
})
