import { addDays } from "./calendar"

/**
 * The date a day's missing check-out falls on: the day itself, or the next
 * when the shift ends past midnight — a night shift's 06:00 check-out
 * belongs to the morning after the date the day is kept under (review on #15).
 */
export function checkoutDate(date: string, expectedEndMinutes: number | null | undefined): string {
    return expectedEndMinutes != null && expectedEndMinutes >= 1440 ? addDays(date, 1) : date
}
