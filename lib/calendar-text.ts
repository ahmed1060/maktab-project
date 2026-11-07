import { calendarDay } from "@/lib/calendar-day"
import { isoOf } from "@/lib/calendar-keys"

/**
 * What a date field and its calendar say (DESIGN.md §5.3), in the page's
 * language and digits through Intl, never put together by hand (§3.3).
 * Days are local "YYYY-MM-DD" strings, as the pickers keep them, read as
 * that day wherever the browser is (lib/calendar-day.ts).
 */

export type Lang = "en" | "ar"

const intl = (locale: Lang) => (locale === "ar" ? "ar-EG" : "en-GB")
const dayFormat = (locale: Lang) => new Intl.DateTimeFormat(intl(locale), { day: "numeric", month: "short", year: "numeric" })
const dateTimeFormat = (locale: Lang) => new Intl.DateTimeFormat(intl(locale), { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })

/**
 * The day a value names, "2026-11-02": a day, or the day of a time given in
 * full ("2026-11-02T06:00:00.000Z"), as the dashboard's link to the audit log
 * gives one. Null when it names none, as "2026-02-30" doesn't.
 */
export function dayIso(value: string): string | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
    if (!m) return null
    const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? `${m[1]}-${m[2]}-${m[3]}` : null
}

/**
 * "6 Nov 2026", «٦ نوفمبر ٢٠٢٦». A value that names no day is shown as it
 * is: Intl would throw on it.
 */
export function dayText(value: string, locale: Lang): string {
    const iso = dayIso(value)
    return iso ? dayFormat(locale).format(calendarDay(iso)) : value
}

/**
 * A range as Intl joins it ("6–10 Nov 2026", "28 Oct – 3 Nov 2026"), a range
 * of one day as that day, and one with an end only as From or Until that day.
 * An end that names no day counts as none. Null with neither end, for the
 * field to say what to pick.
 */
export function rangeText(from: string, to: string, locale: Lang, words: { from: string; until: string }): string | null {
    const [start, end] = [dayIso(from), dayIso(to)]
    if (start && end) {
        // Intl writes "10–6 Nov 2026" for one the wrong way round, as an address can hold it.
        const [first, last] = start <= end ? [start, end] : [end, start]
        if (first === last) return dayText(first, locale)
        return dayFormat(locale).formatRange(calendarDay(first), calendarDay(last))
    }
    if (start) return words.from.replace("{date}", dayText(start, locale))
    if (end) return words.until.replace("{date}", dayText(end, locale))
    return null
}

/**
 * A date and a time as Intl joins them, "6 Nov 2026, 5:00 pm", «٦ نوفمبر
 * ٢٠٢٦، ٥:٠٠ م», on the browser's clock. Null for a value that names no
 * moment, as an upload can hold, for the field to say what to pick.
 */
export function dateTimeText(value: string, locale: Lang): string | null {
    const date = value ? new Date(value) : null
    if (!date || Number.isNaN(date.getTime())) return null
    return dateTimeFormat(locale).format(date)
}

/**
 * The same words, able to break only between the date and the time: where a
 * line hasn't room for both, "7 Nov 2026," goes over "12:48 pm", never "pm"
 * alone, as a face photo's watermark does on a small phone (DESIGN.md §5.5,
 * Face photos; PR 216). Every other space doesn't break.
 */
export function dateTimeBreakable(value: string, locale: Lang): string | null {
    const date = value ? new Date(value) : null
    if (!date || Number.isNaN(date.getTime())) return null
    const parts = dateTimeFormat(locale).formatToParts(date)
    // What Intl puts between the date and the time: ", ", «، ».
    const between = parts.findIndex(part => part.type === "hour") - 1
    return parts.map((part, i) => (i === between ? part.value : part.value.replace(/ /g, "\u00a0"))).join("")
}

/** "November 2026", for the top of the calendar. */
export function monthTitle(month: Date, locale: Lang): string {
    return new Intl.DateTimeFormat(intl(locale), { month: "long", year: "numeric" }).format(month)
}

/** A day read out in full: "Friday, 6 November 2026". */
export function dayLabel(iso: string, locale: Lang): string {
    return new Intl.DateTimeFormat(intl(locale), { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(calendarDay(iso))
}

/** A day's number in the page's digits: "6", «٦». */
export function dayNumber(iso: string, locale: Lang): string {
    return new Intl.DateTimeFormat(intl(locale), { day: "numeric" }).format(calendarDay(iso))
}

/**
 * The days of the week from Sunday, as the work week starts
 * (lib/attendance/calendar.ts): each by its shortest name, "S" or «ح», and
 * in full, for a screen reader.
 */
export function weekdays(locale: Lang): { short: string; full: string }[] {
    const short = new Intl.DateTimeFormat(intl(locale), { weekday: "narrow" })
    const full = new Intl.DateTimeFormat(intl(locale), { weekday: "long" })
    // 1 Nov 2026 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => {
        const day = new Date(2026, 10, 1 + i)
        return { short: short.format(day), full: full.format(day) }
    })
}

/** A month laid out from Sunday: a blank for each day of the week before its first, then its days. */
export function monthCells(month: Date): (string | null)[] {
    const year = month.getFullYear(), index = month.getMonth()
    const blanks = new Date(year, index, 1).getDay()
    const days = new Date(year, index + 1, 0).getDate()
    return [
        ...Array.from({ length: blanks }, () => null),
        ...Array.from({ length: days }, (_, i) => isoOf(new Date(year, index, i + 1))),
    ]
}
