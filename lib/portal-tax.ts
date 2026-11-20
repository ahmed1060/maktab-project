import { cents } from "@/lib/task-costs"
import { claimBadges, type ClaimBadge, type TaxClaimRow } from "@/lib/tax-claims"
import { spellingKey } from "@/lib/tax-file"

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

/**
 * The usual items in their correct spelling (§3.3): however the portal spells
 * one of these, it's shown so.
 */
export const USUAL_ITEMS = [
    "إقرار تجاري",
    "إقرار شهري",
    "إقرار ضريبة الدخل",
    "إقرار القيمة المضافة",
    "مساهمة تكافلية - تأمين صحي",
    "مساهمة تكافلية لصندوق أسر الشهداء",
] as const
const USUAL_BY_KEY: ReadonlyMap<string, string> = new Map(USUAL_ITEMS.map(name => [spellingKey(name), name]))

/**
 * The two usual items with long names go by short ones in the tax position's
 * bars, as the owner's mockup draws them (DESIGN.md §5.5; PR 338), their full
 * names when pointed at; the claims name every item in full.
 */
const SHORT_BY_KEY: ReadonlyMap<string, string> = new Map([
    ["مساهمة تكافلية - تأمين صحي", "تأمين صحي"],
    ["مساهمة تكافلية لصندوق أسر الشهداء", "صندوق أسر الشهداء"],
].map(([name, short]) => [spellingKey(name), short]))

/** An item's short name, matched as the upload matches spellings, or its own name. */
export function shortItemName(item: string): string {
    return SHORT_BY_KEY.get(spellingKey(item)) ?? item
}

/**
 * The name an item is shown by, from the ways the portal spelt it (§3.3):
 * a usual item's correct spelling, else the spelling written most often;
 * two written as often go by text order, whatever order the claims come in.
 */
function itemName(spellings: string[]): string {
    const usual = USUAL_BY_KEY.get(spellingKey(spellings[0]))
    if (usual) return usual
    const times = new Map<string, number>()
    for (const spelling of spellings) times.set(spelling, (times.get(spelling) ?? 0) + 1)
    return [...times].sort(([a, m], [b, n]) => n - m || (a < b ? -1 : a > b ? 1 : 0))[0][0]
}

/** An item's claims and what they come to (DESIGN.md §5.5, The claims). */
export type ItemGroup = {
    /** The name it's shown by (§3.3); each claim keeps the portal's own spelling. */
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

/**
 * What's owed by item, its spellings as one (§3.3): the largest remaining
 * first, items owing the same by name.
 */
export function byItem(claims: TaxClaimRow[]): ItemGroup[] {
    const grouped = new Map<string, TaxClaimRow[]>()
    for (const claim of claims) {
        const key = spellingKey(claim.item)
        grouped.set(key, [...(grouped.get(key) ?? []), claim])
    }
    return [...grouped.values()].map((its): ItemGroup => {
        const badges = new Set(its.flatMap(claimBadges))
        return {
            item: itemName(its.map(claim => claim.item)),
            claims: its,
            original: sum(its, c => c.originalAmount),
            paid: sum(its, c => c.paidAmount),
            remaining: sum(its, c => c.remainingAmount),
            earliestDue: its.map(c => c.dueDate).reduce((a, b) => (b < a ? b : a)),
            badges: (["partly_paid", "late"] as const).filter(badge => badges.has(badge)),
        }
    }).sort((a, b) => b.remaining - a.remaining || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0))
}

/**
 * An item's claims as the claims card lists them, as the owner's mockup draws
 * them: the latest last day to pay first, claims due the same day in the
 * order they were read (DESIGN.md §5.5; PR 339).
 */
export function latestDueFirst(claims: TaxClaimRow[]): TaxClaimRow[] {
    // Days as YYYY-MM-DD compare as text; the sort keeps ties in their order.
    return [...claims].sort((a, b) => (a.dueDate < b.dueDate ? 1 : a.dueDate > b.dueDate ? -1 : 0))
}

/** Which items are open on the claims card, with one opened or closed and the others as they were. */
export function toggledItem(open: ReadonlySet<string>, item: string): ReadonlySet<string> {
    const next = new Set(open)
    if (next.has(item)) next.delete(item)
    else next.add(item)
    return next
}

/** A claim's period as the portal means it (DESIGN.md §5.5; PR 339). */
export type ClaimPeriod =
    | { kind: "year"; year: number }
    | { kind: "month"; year: number; month: number }
    | { kind: "range"; from: string; to: string }
    | { kind: "day"; day: string }

/**
 * A whole year ("Year 2025"), a whole month ("November 2025"), one day, or
 * from its first day to its last; none where the portal gave no period.
 */
export function claimPeriod(start: string | null, end: string | null): ClaimPeriod | null {
    if (!start || !end) return start || end ? { kind: "day", day: (start || end) as string } : null
    if (start === end) return { kind: "day", day: start }
    const [y1, m1, d1] = start.split("-").map(Number)
    const [y2, m2, d2] = end.split("-").map(Number)
    if (y1 === y2 && m1 === 1 && d1 === 1 && m2 === 12 && d2 === 31) return { kind: "year", year: y1 }
    // A month's last day: the day before the next month's first.
    if (y1 === y2 && m1 === m2 && d1 === 1 && d2 === new Date(Date.UTC(y1, m1, 0)).getUTCDate()) return { kind: "month", year: y1, month: m1 }
    return { kind: "range", from: start, to: end }
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

/**
 * How much of the open claims' original amounts is paid, from 0 to 1, to the
 * nearest whole percent, a half up, as the owner's mockup says it, and 99% at
 * most while something is left to pay, so it never says 100% then
 * (DESIGN.md §5.5; PR 338). Worked out on whole piasters, so a sum a hair off
 * its piasters counts as them and a share just under a half isn't rounded up.
 */
export function paidShare(paid: number, original: number): number {
    const p = Math.round(paid * 100), o = Math.round(original * 100)
    if (!(o > 0) || !(p > 0)) return 0
    // The nearest whole percent of p / o, a half up: floor((200p + o) / 2o), in whole numbers.
    const n = 200 * p + o, d = 2 * o
    const percent = (n - (n % d)) / d
    return Math.min(p < o ? 99 : 100, percent) / 100
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
