import { isBlockedBySubscription, type SubscriptionState } from "@/lib/billing/state"

/**
 * Why this signed-in account may not read or act at all, or null when it
 * may: suspended or archived, its company banned, its subscription lapsed
 * (but never for the company's own Admin, who renews it), or the system
 * under maintenance (but never for the Super Admin).
 *
 * One rule for the API handler (lib/api-utils.ts) and for a page that reads
 * the database itself, as the one Requests page does: it read the feed for a
 * suspended account, which the requests API had refused (found by Codex on
 * PR 125).
 */
export type AccountRefusal = "SUSPENDED" | "SUBSCRIPTION" | "MAINTENANCE"

type SessionUser = {
    role?: string | null
    userStatus?: string | null
    companyBanned?: boolean | null
    maintenanceMode?: boolean | null
    subscription?: { state?: string | null } | null
}

export function accountRefusal(user: SessionUser): AccountRefusal | null {
    const subscriptionLocked = isBlockedBySubscription((user.subscription?.state ?? "ACTIVE") as SubscriptionState, user.role)
    const suspendedOrBanned = user.userStatus === "SUSPENDED" || user.userStatus === "ARCHIVED" || !!user.companyBanned
    // A suspension or lapsed subscription is said before maintenance, as the API says it.
    if (suspendedOrBanned || subscriptionLocked) return subscriptionLocked ? "SUBSCRIPTION" : "SUSPENDED"
    if (user.maintenanceMode && user.role !== "SUPER_ADMIN") return "MAINTENANCE"
    return null
}
