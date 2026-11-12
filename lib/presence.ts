/**
 * Who shows as online, on the Employees list and the Super Admin's All users,
 * and how often a shown tab beats. One place for both, so they can't drift
 * apart: a person counted as online for 60 seconds after their last beat
 * while a tab beat every 90, and someone at work showed as Offline for a
 * third of the time (PR 246).
 *
 * Since part 6a (REALTIME_PLAN.md §3, PR 262) each open tab has a row of its
 * own (OpenTab), added as it's shown and taken away as it closes or has been
 * out of sight for 2 minutes (lib/tab-presence.ts). A person signed in
 * (ACTIVE) is online while any tab of theirs has a fresh row. Until then it
 * was whoever had beaten within two beats and 20 seconds, so someone who'd
 * closed the app showed as online for minutes after, and the heartbeat ran
 * every 90 seconds for it.
 */

/**
 * How often a shown tab says it's still here: the safety net, for a tab whose
 * leaving wasn't heard, such as a phone's app closed in the background.
 */
export const HEARTBEAT_MS = 15 * 60_000

/** How long a tab may be out of sight before it says it's gone. */
export const AWAY_AFTER_MS = 2 * 60_000

/**
 * How long a tab's row stays fresh after it was last seen: two beats, so one
 * lost to a bad connection doesn't show anyone offline, and the 2 minutes a
 * tab may be out of sight. A row older than this is from a tab that left
 * unheard.
 */
export const ONLINE_WINDOW_MS = 2 * HEARTBEAT_MS + AWAY_AFTER_MS

/**
 * A person's status as the list shows it, from when their newest tab was last
 * seen (null for none open): someone signed in (ACTIVE) is online while it's
 * within the window, and offline once it isn't, or with no tab open. Every
 * other status is as it's stored.
 */
export function presenceStatus(status: string, lastSeen: Date | string | null, now: Date = new Date()): string {
    if (status !== "ACTIVE") return status
    if (lastSeen === null) return "OFFLINE"
    return now.getTime() - new Date(lastSeen).getTime() > ONLINE_WINDOW_MS ? "OFFLINE" : "ACTIVE"
}

/** The list's Online and Offline filters, asking what presenceStatus shows. */
export function presenceWhere(filter: "ACTIVE" | "OFFLINE", now: Date = new Date()) {
    const fresh = { seenAt: { gte: new Date(now.getTime() - ONLINE_WINDOW_MS) } }
    if (filter === "ACTIVE") return { status: "ACTIVE", openTabs: { some: fresh } }
    return {
        OR: [
            { status: "OFFLINE" },
            { status: "ACTIVE", openTabs: { none: fresh } },
        ],
    }
}
