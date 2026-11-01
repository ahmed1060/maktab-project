'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { countOf } from '@/lib/plural'
import { addressWithDay, addressWithPeriod, dayFromAddress, periodFromAddress, yearsAround } from '@/lib/period-address'

/**
 * What Attendance's tabs share (UI_PLAN.md §5 step 5): the period they're
 * about, kept in the address (DESIGN.md §5.3), and numbers in the page's
 * language (§7). Days, Punches and Exceptions read the same month, and
 * Punches and Exceptions the same day of it.
 */

export const pad = (n: number) => String(n).padStart(2, '0')
export const lastDayOf = (month: string) => { const [y, m] = month.split('-').map(Number); return `${month}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}` }

/** Numbers, amounts and clock times in the page's language (DESIGN.md §7). */
export function useFigures() {
    const { t, locale } = useLanguage()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const num = (n: number) => n.toLocaleString(digits)
    return {
        digits,
        num,
        amount: (minor: number) => (minor / 100).toLocaleString(digits, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        minutes: (n: number) => t('req_minutes').replace('{n}', num(n)),
        // To the eighth of a day, as they're kept: 0.125, not 0.13 (found in the interface audit, PR 149).
        days: (n: number) => countOf(t, locale, n, 'days', 4),
        // "09:12" as the punch has it, in the page's digits.
        clock: (at: string) => at.slice(11, 16).replace(/\d/g, c => num(Number(c))),
        // "Thu 15 Oct", a day of the company's calendar.
        date: (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(digits, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    }
}

/**
 * The month Attendance's tabs are about, kept in the address (DESIGN.md §5.3),
 * so a reload or a link opens on it, and the tabs share it. With none, the
 * month of `opening`, the company's date by default: not the device's, which
 * around midnight or abroad is another (review on #12).
 */
export function useMonthInAddress(today: string, opening: string = today) {
    const { digits } = useFigures()
    const params = useSearchParams()
    const pathname = usePathname()
    const router = useRouter()
    const { year, month: monthNumber } = periodFromAddress(params, new Date(`${opening}T12:00:00`))
    const setPeriod = (y: number, m: number) => router.replace(addressWithPeriod(pathname, params.toString(), y, m), { scroll: false })
    return {
        params, pathname, router, year, monthNumber, setPeriod,
        month: `${year}-${pad(monthNumber)}`,
        monthName: new Date(year, monthNumber - 1).toLocaleString(digits, { month: 'long', year: 'numeric' }),
        months: Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: new Date(2000, i).toLocaleString(digits, { month: 'long' }) })),
        years: yearsAround(Number(today.slice(0, 4)), year).map(y => ({ value: String(y), label: y.toLocaleString(digits, { useGrouping: false }) })),
    }
}

/**
 * A day of that month, kept in the address beside it (`?day=15`, PR 150), and
 * the Day select's choices: every day, then each, named in the page's
 * language. A day after `lastPickable`, not over yet, is listed but can't be
 * picked (DESIGN.md §5.3).
 */
export function useDayInAddress(period: ReturnType<typeof useMonthInAddress>, lastPickable?: string) {
    const { t } = useLanguage()
    const { digits } = useFigures()
    const { params, pathname, router, year, monthNumber, month } = period
    const day = dayFromAddress(params, year, monthNumber)
    const setDay = (d: number | null) => router.replace(addressWithDay(pathname, params.toString(), d), { scroll: false })
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
    const days = [
        { value: '', label: t('punch_every_day') },
        ...Array.from({ length: lastDay }, (_, i) => ({
            value: String(i + 1),
            label: new Date(Date.UTC(year, monthNumber - 1, i + 1)).toLocaleDateString(digits, { weekday: 'short', day: 'numeric', timeZone: 'UTC' }),
            disabled: lastPickable !== undefined && `${month}-${pad(i + 1)}` > lastPickable,
        })),
    ]
    const dayName = day ? new Date(Date.UTC(year, monthNumber - 1, day)).toLocaleDateString(digits, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : null
    return { day, setDay, days, dayName }
}
