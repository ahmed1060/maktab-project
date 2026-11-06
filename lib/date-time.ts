import { isoOf } from "@/lib/calendar-keys"

/**
 * A date and a time, as a deadline is picked (DESIGN.md §5.3): a moment kept
 * as an ISO time ("2026-11-06T15:00:00.000Z"), and read and set on the
 * browser's own clock, as the calendar's days and the time field are.
 */

/** The moment a value names, or null when it names none, as an upload can hold. */
const momentOf = (value: string): Date | null => {
    if (!value) return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

/** A day ("YYYY-MM-DD") at a time ("HH:mm") on the browser's clock, as an ISO time. */
const moment = (day: string, hours: number, minutes: number) => {
    const [y, m, d] = day.split("-").map(Number)
    return new Date(y, m - 1, d, hours, minutes).toISOString()
}

/** The day of a moment on the browser's clock, "2026-11-06". Null when it names none. */
export function dayOf(value: string): string | null {
    const date = momentOf(value)
    return date ? isoOf(date) : null
}

/** Its time as a time field holds one, "17:05". Empty when it names none. */
export function timeOf(value: string): string {
    const date = momentOf(value)
    return date ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : ""
}

/** Another day, keeping its time, or at noon when it has none. */
export function onDay(value: string, day: string): string {
    const date = momentOf(value)
    return date ? moment(day, date.getHours(), date.getMinutes()) : moment(day, 12, 0)
}

/**
 * Another time ("HH:mm"), keeping its day, or on `day` when it has none. A
 * time field half typed in gives none: what was picked stays.
 */
export function atTime(value: string, time: string, day: string): string {
    const m = /^(\d{2}):(\d{2})/.exec(time)
    if (!m) return value
    return moment(dayOf(value) ?? day, Number(m[1]), Number(m[2]))
}

/** Whether all of a day is before a moment, so it can't be picked. */
export function endsBefore(day: string, earliest: string): boolean {
    const [y, m, d] = day.split("-").map(Number)
    return new Date(y, m - 1, d, 23, 59, 59, 999).getTime() < new Date(earliest).getTime()
}

/** Whether a moment is before another. A value that names none isn't. */
export function isBefore(value: string, earliest: string): boolean {
    const date = momentOf(value)
    return !!date && date.getTime() < new Date(earliest).getTime()
}
