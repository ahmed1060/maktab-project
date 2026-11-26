import type { TranslationKey } from "@/lib/translations"

/**
 * Owners (LATER_CHANGES_PLAN.md §7.3, step 3a, PR 426): each time someone is
 * an owner, from the start of the month they're marked, in their company's
 * calendar, to the start of the month they're no longer one. An owner in a
 * month has no payslip for it, and attendance counts no days.
 *
 * Kept as periods rather than one date, so a month they were an owner in
 * stays so once the mark is taken off: a month paid without them is never
 * worked out again as owed.
 *
 * A period's start and end are the moments a month starts in the company's
 * time zone then. Its months are told apart by the calendar month, not by
 * those moments, so a change of the company's time zone afterwards moves no
 * one in or out of one.
 */

export type OwnerPeriodRow = { id: string; startsAt: Date; endsAt: Date | null }

const HOUR = 3_600_000

/**
 * The month, 'YYYY-MM', whose start a period's start or end is. A month
 * starts within 14 hours of midnight UTC on its 1st in every time zone
 * (UTC−12 to UTC+14), so 14 hours on lands on its 1st in UTC.
 */
export function monthOf(boundary: Date): string {
    return new Date(boundary.getTime() + 14 * HOUR).toISOString().slice(0, 7)
}

/** The middle of a month, 'YYYY-MM': in it in every time zone, and far from either end. */
function middleOf(month: string): Date {
    return new Date(`${month}-15T00:00:00Z`)
}

/** Whether they're an owner in a month, 'YYYY-MM'. */
export function ownerIn(periods: readonly OwnerPeriodRow[], month: string): boolean {
    const at = middleOf(month).getTime()
    return periods.some(p => p.startsAt.getTime() <= at && (p.endsAt === null || p.endsAt.getTime() > at))
}

/** The people who aren't owners in a month, 'YYYY-MM', as a filter on User. */
export function notOwnerIn(month: string) {
    const at = middleOf(month)
    return { NOT: { ownerPeriods: { some: { startsAt: { lte: at }, OR: [{ endsAt: null }, { endsAt: { gt: at } }] } } } }
}

/**
 * The people who aren't owners now, as a filter on User: no period still
 * open (LATER_CHANGES_PLAN.md §7.3, step 3b2, PR 428). A period is opened
 * from the start of this month, so an open one is this month's, in any
 * company's calendar.
 */
export function notOwnerNow() {
    return { NOT: { ownerPeriods: { some: { endsAt: null } } } }
}

/** Since which month, 'YYYY-MM', they're an owner now: their open period's; null for none. */
export function ownerSince(periods: readonly OwnerPeriodRow[]): string | null {
    const open = periods.find(p => p.endsAt === null)
    return open ? monthOf(open.startsAt) : null
}

/** The month after a month, 'YYYY-MM'. */
function nextMonth(month: string): string {
    const [year, m] = month.split("-").map(Number)
    return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, "0")}`
}

/**
 * The months a change from `month` on reaches, 'YYYY-MM', to check and lock
 * against their payroll's approval: this one and every one after, a year
 * ahead, and on to `lastRun`, the last month with a payroll run, where that's
 * further. A payroll approved further ahead with no run before it is beyond
 * what's asked of anyone.
 */
export function monthsReached(month: string, lastRun: string | null): string[] {
    let through = month
    for (let i = 0; i < 12; i++) through = nextMonth(through)
    if (lastRun !== null && lastRun > through) through = lastRun
    const months = [month]
    while (months[months.length - 1] < through) months.push(nextMonth(months[months.length - 1]))
    return months
}

/** The months, 'YYYY-MM', that the days from `from` to `to`, 'YYYY-MM-DD', fall in. */
export function monthsSpanned(from: string, to: string): string[] {
    const months = [from.slice(0, 7)]
    while (months[months.length - 1] < to.slice(0, 7)) months.push(nextMonth(months[months.length - 1]))
    return months
}

export type OwnerPlan =
    | { ok: true; action: "create" }
    | { ok: true; action: "reopen" | "close" | "delete"; id: string }
    | { ok: false; refusal: "ALREADY_OWNER" | "NOT_OWNER" }

/**
 * What marking someone as an owner from the start of `month`, 'YYYY-MM', or
 * taking it off, does to their periods. Marked: a period starts, or the one
 * taken off this month carries on. Taken off: their open period ends this
 * month, or goes, where it started this month.
 */
export function planOwner(periods: readonly OwnerPeriodRow[], month: string, owner: boolean): OwnerPlan {
    const open = periods.find(p => p.endsAt === null)
    if (owner) {
        if (open) return { ok: false, refusal: "ALREADY_OWNER" }
        const endedNow = periods.find(p => p.endsAt !== null && monthOf(p.endsAt) === month)
        return endedNow ? { ok: true, action: "reopen", id: endedNow.id } : { ok: true, action: "create" }
    }
    if (!open) return { ok: false, refusal: "NOT_OWNER" }
    return monthOf(open.startsAt) >= month ? { ok: true, action: "delete", id: open.id } : { ok: true, action: "close", id: open.id }
}

/** A month, 'YYYY-MM', worded in the page's language and its digits: "November 2026". */
export function monthLabel(month: string, locale: string): string {
    const date = new Date(`${month}-01T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return month
    return date.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", { month: "long", year: "numeric", timeZone: "UTC" })
}

const REFUSALS: Record<string, TranslationKey> = {
    OWNER_OPEN_WORK: "owner_open_work",
    PAYROLL_MONTH_LOCKED: "owner_month_locked",
    ALREADY_OWNER: "owner_already",
    NOT_OWNER: "owner_not",
    NO_COMPANY: "owner_no_company",
    OWNER_SETTLED: "owner_settled",
    OWNER_NOT_ADMIN: "owner_not_admin",
}

/** A refusal's code, as the words the dialog says it in; null for none of its own. */
export function ownerRefusal(code: string | undefined): TranslationKey | null {
    return code !== undefined && code in REFUSALS ? REFUSALS[code] : null
}
