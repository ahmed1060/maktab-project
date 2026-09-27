import { calendarParts, DEFAULT_TIME_ZONE } from "./time"

/**
 * Working days, for "left undecided for N working days" (ROLES_PLAN.md §6.12).
 *
 * The product has no weekend setting yet, so this is the one place that says
 * what a working day is: Sunday to Thursday, the Egyptian week, in the
 * company's own calendar. When companies get their own weekend, it changes
 * here and nowhere else.
 */
export const WEEKEND: readonly number[] = [5, 6] // Friday, Saturday (Date.getDay())

const DAY = 24 * 60 * 60 * 1000

/** The instant `n` whole working days after `from`, in `timeZone`'s calendar. */
export function addWorkingDays(from: Date, n: number, timeZone: string = DEFAULT_TIME_ZONE): Date {
    let at = from.getTime()
    let left = n
    while (left > 0) {
        at += DAY
        if (!WEEKEND.includes(calendarParts(new Date(at), timeZone).weekday)) left--
    }
    return new Date(at)
}
