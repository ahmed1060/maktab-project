/**
 * What's left of one's own permission hours, shown or hidden by the
 * company's switch (LATER_CHANGES_PLAN.md §7.18; DESIGN.md §5.5,
 * Permission hours left). Hidden, the pages aren't sent it: only the
 * policy's limits, which a request is still held to.
 *
 * Pure, and safe for the pages to import.
 */

/** The figures that say what's been spent, is waiting or is left: what hiding takes away. */
export const LEFT_FIGURES = ["allowanceMinutes", "carriedMinutes", "approvedMinutes", "pendingMinutes", "remainingMinutes", "overdrawnMinutes", "requests"] as const
type LeftFigure = (typeof LEFT_FIGURES)[number]

/**
 * A balance as it's sent to the page: in full while what's left is shown,
 * and without those figures while it's hidden. One with nothing said, read
 * before the switch, is shown.
 */
export function balanceAsShown<T extends object>(balance: T): T | Omit<T, LeftFigure> {
    if ((balance as { leftShown?: boolean }).leftShown !== false) return balance
    const sent = { ...balance } as Record<string, unknown>
    for (const figure of LEFT_FIGURES) delete sent[figure]
    return sent as Omit<T, LeftFigure>
}

/**
 * The Requests page's Permission hours, above the list on Mine: what's left
 * of the month's and what was carried, and what waits. None while the
 * policy has no permission hours, or while the company hides what's left.
 */
export function permissionAllowance(balance: {
    enabled: boolean; leftShown?: boolean
    remainingMinutes: number; allowanceMinutes: number; carriedMinutes: number; pendingMinutes: number
}): { left: number; total: number; pending: number; carried: number } | null {
    if (!balance.enabled || balance.leftShown === false) return null
    return {
        left: balance.remainingMinutes,
        total: balance.allowanceMinutes + balance.carriedMinutes,
        pending: balance.pendingMinutes,
        carried: balance.carriedMinutes,
    }
}
