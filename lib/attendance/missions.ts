import { addDays, isDateString } from "./calendar"
import type { DayOffDays } from "../day-off-window"

/**
 * A mission's dates, as asking for one takes them (ATTENDANCE_PLAN.md §6.10,
 * round 10, PR 283): plain, so the page and the server read them alike.
 *
 * By days, a first and a last date; by hours, one date and the part of the
 * day it covers. A guard keeps a mission within the days that may be asked
 * for: back as far as the policy allows (LATER_CHANGES_PLAN.md §7.4, 4c),
 * and a year ahead, since recomputing reaches a year (§11); and 90 days at
 * most by days.
 */

export type MissionKind = "DAYS" | "HOURS"
export type MissionPart = "TO_END" | "FROM_START"
/** What the page shows a mission as: by days, or which part of the day by hours. */
export type MissionKey = "DAYS" | MissionPart

export const MISSION_MAX_DAYS = 90
/** How far ahead of today a mission's dates may be. */
const AHEAD_DAYS = 365

/**
 * The days a mission may be asked for (LATER_CHANGES_PLAN.md §7.20): from the
 * first day a request may be asked for (`requestDaysBasis`'s `from`) to a
 * year ahead of today, the company's.
 */
export function missionDays(from: string, today: string): DayOffDays {
    return { from, to: addDays(today, AHEAD_DAYS) }
}

export type MissionAsk = { kind: MissionKind; startDate: string; endDate?: string | null; hoursPart?: MissionPart | null }
export type MissionSpan = { startDate: string; endDate: string; hoursPart: MissionPart | null }

/** Days from one date to another, both counted. */
function span(start: string, end: string): number {
    return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1
}

/** A mission's dates as kept, or why they can't be. */
export function missionSpan(ask: MissionAsk, days: DayOffDays): MissionSpan | { refused: "MISSION_DATES_INVALID" | "MISSION_TOO_LONG" | "MISSION_OUT_OF_RANGE" } {
    const startDate = ask.startDate
    const endDate = ask.kind === "HOURS" ? ask.endDate ?? startDate : ask.endDate
    const hoursPart = ask.hoursPart ?? null
    if (!isDateString(startDate) || !isDateString(endDate) || endDate < startDate) return { refused: "MISSION_DATES_INVALID" }
    // By hours: one date, and its part of the day. By days: no part.
    if (ask.kind === "HOURS" ? endDate !== startDate || !hoursPart : hoursPart !== null) return { refused: "MISSION_DATES_INVALID" }
    if (span(startDate, endDate) > MISSION_MAX_DAYS) return { refused: "MISSION_TOO_LONG" }
    if (startDate < days.from || endDate > days.to) return { refused: "MISSION_OUT_OF_RANGE" }
    return { startDate, endDate, hoursPart }
}

/** Each date from the first to the last, in order. */
export function datesOf(start: string, end: string): string[] {
    const out: string[] = []
    for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
    return out
}

/** What the page shows a mission as. */
export function missionKey(kind: MissionKind | string, hoursPart: MissionPart | string | null): MissionKey {
    return kind === "HOURS" ? (hoursPart === "FROM_START" ? "FROM_START" : "TO_END") : "DAYS"
}

/** A day of a mission and its scans, as the clock read them: "09:02". */
export type MissionDayScans = { date: string; times: string[] }

/** Scans, as the wall clock read each, grouped by day, both in order (decision 20). */
export function missionScans(punches: readonly { punchAtLocal: Date }[]): MissionDayScans[] {
    const byDay = new Map<string, string[]>()
    for (const local of punches.map(p => p.punchAtLocal.toISOString()).sort()) {
        const date = local.slice(0, 10)
        byDay.set(date, [...(byDay.get(date) ?? []), local.slice(11, 16)])
    }
    return [...byDay].map(([date, times]) => ({ date, times }))
}
