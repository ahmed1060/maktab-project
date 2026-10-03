import { addDays, weekdayOf } from "./calendar"

/**
 * A re-verification not done within this many working days of being asked,
 * or of falling due, goes on the exceptions screen (ATTENDANCE_PLAN.md §9.5).
 */
export const REVERIFY_GRACE_WORKING_DAYS = 3

/** Working days after `since` up to and including `today`, by the work week. Holidays aren't counted out. */
export function workingDaysSince(since: string, today: string, workWeek: readonly number[]): number {
    let n = 0
    for (let d = addDays(since, 1); d <= today; d = addDays(d, 1)) if (workWeek.includes(weekdayOf(d))) n++
    return n
}

export function reverifyOverdue(since: string, today: string, workWeek: readonly number[]): boolean {
    return workingDaysSince(since, today, workWeek) > REVERIFY_GRACE_WORKING_DAYS
}
