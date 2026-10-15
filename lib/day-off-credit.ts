/**
 * Day off credit used this year: the year's allowance less what's left.
 *
 * One answer for every screen. The dashboard used to add up the days of every
 * approved request ever made, so it counted days taken out of salary, which
 * never touch the credit, and every year before the last reset; the Day Off
 * page said something else for the same person.
 */
export function usedDayOffCredit(base: number | null | undefined, remaining: number | null | undefined): number {
    return Math.max(0, (base ?? 0) - (remaining ?? 0))
}
