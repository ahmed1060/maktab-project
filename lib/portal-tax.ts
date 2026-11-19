import { cents } from "@/lib/task-costs"
import { claimBadges, type ClaimBadge, type TaxClaimRow } from "@/lib/tax-claims"

/**
 * A client's tax position as the client's area shows it
 * (CLIENT_PORTAL_PLAN.md §6, §12 step 8a; DESIGN.md §5.5; PR 336): what's
 * owed in all, by item and by how late, and the oldest delay. Worked out
 * from the claims as the server reads them, late already counted in the
 * company's own days (§3.4), so the page and anything else that shows it
 * agree.
 */

/**
 * How late, by time since the due date, in this order: what's not due yet,
 * then under 6 months, 6 months to a year, 1 to 2 years and more than 2
 * years (decided 2026-11-19), so the late groups hold only what's late.
 */
export const LATE_GROUPS = ["not_due", "under_6_months", "6_to_12_months", "1_to_2_years", "over_2_years"] as const
export type LateGroup = (typeof LATE_GROUPS)[number]

/** A calendar day so many months on; a month too short for its day ends the move on its last day. */
function monthsOn(day: string, months: number): string {
    const [y, m, d] = day.split("-").map(Number)
    const index = y * 12 + (m - 1) + months
    const year = Math.floor(index / 12)
    const month = (index % 12) + 1
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate()
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${year}-${pad(month)}-${pad(Math.min(d, last))}`
}

/**
 * Which group a claim is in, by its last day to pay and today where the
 * company is: not due yet on that day and before it (§3.4); then by whole
 * months since, so 6 months, a year and 2 years each start the next group.
 */
export function lateGroup(dueDate: string, today: string): LateGroup {
    // Days as YYYY-MM-DD compare as text.
    if (today <= dueDate) return "not_due"
    if (today < monthsOn(dueDate, 6)) return "under_6_months"
    if (today < monthsOn(dueDate, 12)) return "6_to_12_months"
    if (today < monthsOn(dueDate, 24)) return "1_to_2_years"
    return "over_2_years"
}

/** An item's claims and what they come to (DESIGN.md §5.5, The claims). */
export type ItemGroup = {
    item: string
    /** In the order they were read: the oldest due first. */
    claims: TaxClaimRow[]
    original: number
    paid: number
    remaining: number
    earliestDue: string
    /** The badges its claims have, in a claim's order. */
    badges: ClaimBadge[]
}

const sum = (claims: TaxClaimRow[], amount: (claim: TaxClaimRow) => number) => cents(claims.reduce((total, claim) => total + amount(claim), 0))

/** What's owed by item: the largest remaining first, items owing the same by name. */
export function byItem(claims: TaxClaimRow[]): ItemGroup[] {
    const grouped = new Map<string, TaxClaimRow[]>()
    for (const claim of claims) grouped.set(claim.item, [...(grouped.get(claim.item) ?? []), claim])
    return [...grouped].map(([item, its]): ItemGroup => {
        const badges = new Set(its.flatMap(claimBadges))
        return {
            item,
            claims: its,
            original: sum(its, c => c.originalAmount),
            paid: sum(its, c => c.paidAmount),
            remaining: sum(its, c => c.remainingAmount),
            earliestDue: its.map(c => c.dueDate).reduce((a, b) => (b < a ? b : a)),
            badges: (["late", "partly_paid"] as const).filter(badge => badges.has(badge)),
        }
    }).sort((a, b) => b.remaining - a.remaining || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
}

export type LateRow = { group: LateGroup; remaining: number; count: number }

/** What remains by how late, every group in order, at nothing where none is in it. */
export function byLate(claims: TaxClaimRow[], today: string): LateRow[] {
    return LATE_GROUPS.map(group => {
        const its = claims.filter(claim => lateGroup(claim.dueDate, today) === group)
        return { group, remaining: sum(its, c => c.remainingAmount), count: its.length }
    })
}

/** The most days any claim is late; none where nothing is. */
export function oldestDelay(claims: TaxClaimRow[]): number {
    return claims.reduce((most, claim) => Math.max(most, claim.daysLate), 0)
}

/** What the client's area is given of a client's tax position. */
export type PortalTaxPosition = {
    /** Today where the company is, which late is counted to. */
    today: string
    /** The day the figures are from; none before the first upload. */
    asOf: string | null
    totals: { original: number; paid: number; remaining: number; open: number; late: number; oldestDelay: number }
    items: ItemGroup[]
    late: LateRow[]
}

/** The whole of it, from the client's claims, every one kept being open (§3.2). */
export function summarise(claims: TaxClaimRow[], today: string, asOf: string | null): PortalTaxPosition {
    return {
        today,
        asOf,
        totals: {
            original: sum(claims, c => c.originalAmount),
            paid: sum(claims, c => c.paidAmount),
            remaining: sum(claims, c => c.remainingAmount),
            open: claims.length,
            late: claims.filter(claim => claim.daysLate > 0).length,
            oldestDelay: oldestDelay(claims),
        },
        items: byItem(claims),
        late: byLate(claims, today),
    }
}
