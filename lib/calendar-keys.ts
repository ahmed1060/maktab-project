/**
 * Moving around a calendar's days with the keyboard (WAI-ARIA date picker
 * pattern): the arrows a day or a week, Home and End to the start or end of
 * the week, Page Up and Page Down a month. Left and right follow reading
 * direction, so in Arabic the right arrow goes to the day before.
 *
 * Dates are local "YYYY-MM-DD" strings, as the pickers keep them.
 */

export function isoOf(date: Date): string {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, "0")
    const d = String(date.getDate()).padStart(2, "0")
    return `${y}-${m}-${d}`
}

function dateOf(iso: string): Date {
    const [y, m, d] = iso.split("-").map(Number)
    return new Date(y, m - 1, d)
}

/** The day a key moves to from `iso`, or null if the key doesn't move. */
export function moveDay(iso: string, key: string, rtl: boolean): string | null {
    const date = dateOf(iso)
    const forward = rtl ? "ArrowLeft" : "ArrowRight"
    const back = rtl ? "ArrowRight" : "ArrowLeft"
    switch (key) {
        case forward: date.setDate(date.getDate() + 1); break
        case back: date.setDate(date.getDate() - 1); break
        case "ArrowDown": date.setDate(date.getDate() + 7); break
        case "ArrowUp": date.setDate(date.getDate() - 7); break
        case "Home": date.setDate(date.getDate() - date.getDay()); break
        case "End": date.setDate(date.getDate() + (6 - date.getDay())); break
        case "PageDown":
        case "PageUp": {
            const step = key === "PageDown" ? 1 : -1
            const day = date.getDate()
            date.setDate(1)
            date.setMonth(date.getMonth() + step)
            // The same day of the month, or the last one when it is shorter (31 Jan → 28 Feb).
            const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
            date.setDate(Math.min(day, last))
            break
        }
        default: return null
    }
    return isoOf(date)
}

/** The first day of the month `iso` is in, for showing that month. */
export function monthOf(iso: string): Date {
    const d = dateOf(iso)
    return new Date(d.getFullYear(), d.getMonth(), 1)
}
