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
 */

export type OwnerPeriodRow = { id: string; startsAt: Date; endsAt: Date | null }

/** Whether they're an owner in the month starting at `monthStart`. */
export function ownerIn(periods: readonly OwnerPeriodRow[], monthStart: Date): boolean {
    const at = monthStart.getTime()
    return periods.some(p => p.startsAt.getTime() <= at && (p.endsAt === null || p.endsAt.getTime() > at))
}

/** The people who aren't owners in the month starting at `monthStart`, as a filter on User. */
export function notOwnerIn(monthStart: Date) {
    return { NOT: { ownerPeriods: { some: { startsAt: { lte: monthStart }, OR: [{ endsAt: null }, { endsAt: { gt: monthStart } }] } } } }
}

/** Since when they're an owner now: the start of their open period, or null. */
export function ownerSince(periods: readonly OwnerPeriodRow[]): Date | null {
    return periods.find(p => p.endsAt === null)?.startsAt ?? null
}

export type OwnerPlan =
    | { ok: true; action: "create" }
    | { ok: true; action: "reopen" | "close" | "delete"; id: string }
    | { ok: false; refusal: "ALREADY_OWNER" | "NOT_OWNER" }

/**
 * What marking someone as an owner from the month starting at `monthStart`,
 * or taking it off, does to their periods. Marked: a period starts, or the
 * one taken off this month carries on. Taken off: their open period ends
 * this month, or goes, where it started this month.
 */
export function planOwner(periods: readonly OwnerPeriodRow[], monthStart: Date, owner: boolean): OwnerPlan {
    const at = monthStart.getTime()
    const open = periods.find(p => p.endsAt === null)
    if (owner) {
        if (open) return { ok: false, refusal: "ALREADY_OWNER" }
        const endedNow = periods.find(p => p.endsAt?.getTime() === at)
        return endedNow ? { ok: true, action: "reopen", id: endedNow.id } : { ok: true, action: "create" }
    }
    if (!open) return { ok: false, refusal: "NOT_OWNER" }
    return open.startsAt.getTime() >= at ? { ok: true, action: "delete", id: open.id } : { ok: true, action: "close", id: open.id }
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
}

/** A refusal's code, as the words the dialog says it in; null for none of its own. */
export function ownerRefusal(code: string | undefined): TranslationKey | null {
    return code !== undefined && code in REFUSALS ? REFUSALS[code] : null
}
