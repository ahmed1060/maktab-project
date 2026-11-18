/**
 * A client's tax claims (CLIENT_PORTAL_PLAN.md §3): what the server and the
 * screens share. A claim is one row of the Tax Authority's portal, kept as
 * the portal's file had it.
 */

/** How many claims a client's page starts with, and how many to a page once all are asked for (§3.5). */
export const TAX_PREVIEW = 5
export const TAX_PAGE = 20

export type TaxClaimRow = {
    id: string
    /** As text, so its leading zeros stay. */
    claimNumber: string
    item: string
    taxType: string | null
    registrationType: string | null
    originalAmount: number
    paidAmount: number
    remainingAmount: number
    currency: string | null
    status: string | null
    /** Calendar days, YYYY-MM-DD. */
    periodStart: string | null
    periodEnd: string | null
    /** Its last day to pay before the penalty. */
    dueDate: string
    /** Days since that day, in the company's own days; 0 until it has passed (§3.4). */
    daysLate: number
}

export type TaxPosition = {
    client: { id: string; name: string; archived: boolean }
    /** Today where the company is, which late is counted to. */
    today: string
    /** Null until the portal's file is uploaded for the client. Its days are the company's. */
    position: { asOf: string; uploadedOn: string; uploadedBy: string | null } | null
    /** Of all the client's claims, whichever page is asked for. */
    totals: { original: number; paid: number; remaining: number; open: number; late: number }
    claims: TaxClaimRow[]
    total: number
    totalPages: number
}

const DAY_MS = 86_400_000
const at = (day: string) => Date.parse(`${day}T00:00:00Z`)

/** Whole days from one calendar day to another; negative when the second is the earlier. */
export function daysBetween(from: string, to: string): number {
    return Math.round((at(to) - at(from)) / DAY_MS)
}

/** How late a claim is, in days: its last day to pay has passed (§3.4). 0 on that day and before it. */
export function daysLate(dueDate: string, today: string): number {
    return Math.max(0, daysBetween(dueDate, today))
}

/** From how many days after the day its figures are from a client's tax position says how long it's been (§4.3). */
export const TAX_OLD_AFTER_DAYS = 30

/**
 * How many days old a client's figures are, once that's worth saying (§4.3,
 * step 5, PR 321): 30 or more, from the day they're from to today where the
 * company is. Null before that, on the day itself too.
 */
export function figuresAge(asOf: string, today: string): number | null {
    const days = daysBetween(asOf, today)
    return days >= TAX_OLD_AFTER_DAYS ? days : null
}

export type ClaimBadge = "late" | "partly_paid"

/** A claim's badges (§3.4): Late once its last day to pay has passed, Partly paid where something is paid. It can have both. */
export function claimBadges(claim: Pick<TaxClaimRow, "daysLate" | "paidAmount">): ClaimBadge[] {
    const badges: ClaimBadge[] = []
    if (claim.daysLate > 0) badges.push("late")
    if (claim.paidAmount > 0) badges.push("partly_paid")
    return badges
}

/** Where a client's claims are read from: the first five, or all of them a page at a time (§3.5). */
export function taxClaimsUrl(clientId: string, all: boolean, page: number): string {
    return `/api/tax-claims?${new URLSearchParams({ clientId, limit: String(all ? TAX_PAGE : TAX_PREVIEW), page: String(all ? page : 1) })}`
}
