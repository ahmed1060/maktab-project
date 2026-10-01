/**
 * When somebody was supposed to be at work (ATTENDANCE_PLAN.md §7).
 *
 * Pure: no Prisma, no clock. The services load the rows and pass them in; the
 * engine (§11) asks the same questions of the same functions, so the settings
 * screen and the measured day cannot disagree about a date's hours.
 *
 * Dates are calendar dates in the company's timezone, as "YYYY-MM-DD" strings.
 * A string compares and sorts correctly and cannot drift across a timezone the
 * way a Date at midnight UTC can.
 */

/** 0 = Sunday … 6 = Saturday, as Date.getUTCDay() counts. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** Sunday to Thursday (§6.2): the default until a company sets its own. */
export const DEFAULT_WORK_WEEK: readonly Weekday[] = [0, 1, 2, 3, 4]

/** The longest shift: 24 hours. A shift crossing midnight ends past 1440 (§7.1). */
export const MAX_SHIFT_MINUTES = 1440

export type DayHours = { weekday: number; startMinutes: number; endMinutes: number }

export type Version = {
    id: string
    effectiveFrom: string
    startMinutes: number
    endMinutes: number
    breakMinutes: number
    /** Empty means the company's work week. */
    workWeek: readonly number[]
    days: readonly DayHours[]
}

export type Override = {
    id: string
    name: string
    startDate: string
    endDate: string
    startMinutes: number
    endMinutes: number
    breakMinutes: number
    days: readonly DayHours[]
}

export type Schedule = {
    id: string
    versions: readonly Version[]
    overrides: readonly Override[]
}

export type Assignment = { scheduleId: string; effectiveFrom: string }

export type Hours = { startMinutes: number; endMinutes: number; breakMinutes: number }

export type HolidayEntry = { date: string; name: string; isPaid: boolean; source: "PUBLIC" | "COMPANY"; id: string }

/** What a date is for one person: the inputs the engine will record against (§8.6). */
export type ExpectedDay =
    | { kind: "WORK"; hours: Hours; versionId: string; overrideId: string | null }
    | { kind: "REST"; versionId: string }
    | { kind: "HOLIDAY"; holiday: HolidayEntry; versionId: string | null }
    /** No schedule applies: nobody is assigned and the company has no default, or it starts later. */
    | { kind: "NO_SCHEDULE" }

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in the expected shape, not merely the shape: 2026-02-30 is refused. */
export function isDateString(value: unknown): value is string {
    if (typeof value !== "string" || !DATE.test(value)) return false
    const d = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

export function weekdayOf(date: string): Weekday {
    return new Date(`${date}T00:00:00Z`).getUTCDay() as Weekday
}

/** The date `days` after `date` (negative for before). */
export function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
}

/** A Prisma DATE column comes back as a Date at midnight UTC. */
export function toDateString(value: Date | string): string {
    return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10)
}

/**
 * Why a span of hours is not usable, or null when it is. The same rule the
 * database's CHECK constraints hold, so a refusal here is never a 500 there.
 */
export function hoursProblem(startMinutes: number, endMinutes: number, breakMinutes = 0): string | null {
    for (const v of [startMinutes, endMinutes, breakMinutes]) {
        if (!Number.isInteger(v)) return "HOURS_NOT_WHOLE_MINUTES"
    }
    if (startMinutes < 0 || startMinutes >= 1440) return "START_OUT_OF_DAY"
    if (endMinutes <= startMinutes) return "END_NOT_AFTER_START"
    if (endMinutes - startMinutes > MAX_SHIFT_MINUTES) return "SHIFT_TOO_LONG"
    if (breakMinutes < 0 || breakMinutes >= endMinutes - startMinutes) return "BREAK_TOO_LONG"
    return null
}

/** Why a work week is not usable, or null. Empty is allowed where it means "the company's". */
export function workWeekProblem(days: readonly number[], { allowEmpty }: { allowEmpty: boolean }): string | null {
    if (days.length === 0) return allowEmpty ? null : "WORK_WEEK_EMPTY"
    if (days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) return "WORK_WEEK_INVALID_DAY"
    if (new Set(days).size !== days.length) return "WORK_WEEK_DUPLICATE_DAY"
    return null
}

/** Why a set of per-weekday hours is not usable, or null. */
export function dayHoursProblem(days: readonly DayHours[]): string | null {
    const seen = new Set<number>()
    for (const d of days) {
        if (!Number.isInteger(d.weekday) || d.weekday < 0 || d.weekday > 6) return "WORK_WEEK_INVALID_DAY"
        if (seen.has(d.weekday)) return "WORK_WEEK_DUPLICATE_DAY"
        seen.add(d.weekday)
        const problem = hoursProblem(d.startMinutes, d.endMinutes)
        if (problem) return problem
    }
    return null
}

/** The latest item whose start is on or before `date`. `items` in any order. */
function latestFrom<T>(items: readonly T[], date: string, startOf: (item: T) => string): T | null {
    let best: T | null = null
    for (const item of items) {
        const from = startOf(item)
        if (from <= date && (best === null || from > startOf(best))) best = item
    }
    return best
}

/** The version in force on a date, or null before the first one. */
export function versionOn(versions: readonly Version[], date: string): Version | null {
    return latestFrom(versions, date, v => v.effectiveFrom)
}

/** The override covering a date, if any. Overrides of one schedule never overlap (overridesOverlap). */
export function overrideOn(overrides: readonly Override[], date: string): Override | null {
    return overrides.find(o => o.startDate <= date && date <= o.endDate) ?? null
}

/** Which schedule a person works on a date: their assignment then, else the company default. */
export function scheduleIdOn(assignments: readonly Assignment[], defaultScheduleId: string | null, date: string): string | null {
    return latestFrom(assignments, date, a => a.effectiveFrom)?.scheduleId ?? defaultScheduleId
}

export function overridesOverlap(a: Pick<Override, "startDate" | "endDate">, b: Pick<Override, "startDate" | "endDate">): boolean {
    return a.startDate <= b.endDate && b.startDate <= a.endDate
}

/** The days a version works: its own work week, or the company's when it has none. */
export function workDaysOf(version: Pick<Version, "workWeek">, companyWorkWeek: readonly number[]): readonly number[] {
    return version.workWeek.length > 0 ? version.workWeek : companyWorkWeek
}

/**
 * The holidays a company observes between two dates, inclusive: the central
 * calendar less the days it opted out of, plus its own. Its own wins a date
 * both name, since that is the one it chose.
 */
export function observedHolidays(
    central: readonly { id: string; date: string; name: string }[],
    excludedIds: ReadonlySet<string>,
    own: readonly { id: string; date: string; name: string; isPaid: boolean }[],
    from: string,
    to: string,
): Map<string, HolidayEntry> {
    const out = new Map<string, HolidayEntry>()
    for (const h of central) {
        if (h.date < from || h.date > to || excludedIds.has(h.id)) continue
        out.set(h.date, { date: h.date, name: h.name, isPaid: true, source: "PUBLIC", id: h.id })
    }
    for (const h of own) {
        if (h.date < from || h.date > to) continue
        out.set(h.date, { date: h.date, name: h.name, isPaid: h.isPaid, source: "COMPANY", id: h.id })
    }
    return out
}

/**
 * What one date is for one person on one schedule.
 *
 * A holiday outranks the schedule; a rest day stays a rest day under an
 * override (Ramadan changes hours, not which days are worked); and the hours
 * come from the override when one covers the date, else the version, each
 * with its per-weekday exceptions.
 */
export function expectedDay(input: {
    date: string
    schedule: Schedule | null
    companyWorkWeek: readonly number[]
    holiday: HolidayEntry | null
}): ExpectedDay {
    const { date, schedule, companyWorkWeek, holiday } = input
    const version = schedule ? versionOn(schedule.versions, date) : null
    if (holiday) return { kind: "HOLIDAY", holiday, versionId: version?.id ?? null }
    if (!schedule || !version) return { kind: "NO_SCHEDULE" }

    const weekday = weekdayOf(date)
    if (!workDaysOf(version, companyWorkWeek).includes(weekday)) return { kind: "REST", versionId: version.id }

    const override = overrideOn(schedule.overrides, date)
    const source = override ?? version
    const day = source.days.find(d => d.weekday === weekday)
    return {
        kind: "WORK",
        hours: {
            startMinutes: day?.startMinutes ?? source.startMinutes,
            endMinutes: day?.endMinutes ?? source.endMinutes,
            breakMinutes: source.breakMinutes,
        },
        versionId: version.id,
        overrideId: override?.id ?? null,
    }
}

/** "09:00" for 540; a shift past midnight reads "02:00 (+1)". */
export function formatMinutes(minutes: number): string {
    const nextDay = minutes >= 1440
    const m = minutes % 1440
    const text = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
    return nextDay ? `${text} (+1)` : text
}

/** 540 for "09:00", or null when it is not a time. */
export function parseTime(value: string): number | null {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim())
    return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/**
 * The end of a shift given as clock times: an end at or before the start is
 * the next day (a 22:00–06:00 night shift).
 */
export function shiftEnd(startMinutes: number, endClock: number): number {
    return endClock <= startMinutes ? endClock + 1440 : endClock
}
