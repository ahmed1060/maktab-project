/**
 * Which period a page is about, kept in its address (DESIGN.md §5.3, decided
 * on 2026-10-31): `?year=2026&month=10` for Payroll's month, `?year=2027` for
 * Public holidays' year, so a reload or a link opens on it. Each part is read
 * on its own, and one that isn't a year or month it could be is this one's,
 * as no part at all is.
 */

type Params = { get(name: string): string | null }

const whole = (value: string | null, min: number, max: number) => {
    if (value === null || !/^\d+$/.test(value)) return null
    const n = Number(value)
    return n >= min && n <= max ? n : null
}

export function periodFromAddress(params: Params, now: Date): { year: number; month: number } {
    return {
        year: whole(params.get('year'), 2000, 2100) ?? now.getFullYear(),
        month: whole(params.get('month'), 1, 12) ?? now.getMonth() + 1,
    }
}

/** The address with this period in it, the rest kept: the top bar's company among them. */
export function addressWithPeriod(pathname: string, current: string, year: number, month: number): string {
    const next = new URLSearchParams(current)
    next.set('year', String(year))
    next.set('month', String(month))
    return `${pathname}?${next.toString()}`
}

/** A page about a year alone, such as Public holidays (PR 146). */
export function yearFromAddress(params: Params, now: Date): number {
    return whole(params.get('year'), 2000, 2100) ?? now.getFullYear()
}

/** The address with this year in it, the rest kept. */
export function addressWithYear(pathname: string, current: string, year: number): string {
    const next = new URLSearchParams(current)
    next.set('year', String(year))
    return `${pathname}?${next.toString()}`
}

/** The years offered: two either side of this one, and one a link opened that's further off, in its place. */
export function yearsAround(thisYear: number, picked?: number): number[] {
    const years = Array.from({ length: 5 }, (_, i) => thisYear - 2 + i)
    if (picked !== undefined && !years.includes(picked)) years.push(picked)
    return years.sort((a, b) => a - b)
}

/**
 * A day of the month the address names (`?day=15`), as Attendance's punches
 * are narrowed to (PR 150): null for every day, as for none at all or one the
 * month hasn't got.
 */
export function dayFromAddress(params: Params, year: number, month: number): number | null {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return whole(params.get('day'), 1, last)
}

/** The address with this day in it, or none for every day, the rest kept. */
export function addressWithDay(pathname: string, current: string, day: number | null): string {
    const next = new URLSearchParams(current)
    if (day === null) next.delete('day')
    else next.set('day', String(day))
    return `${pathname}?${next.toString()}`
}
