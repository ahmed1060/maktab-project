/**
 * Who shows as online, on the Employees list and the Super Admin's All users,
 * and how often a tab says its person is there. One place for both, so they
 * can't drift apart: a person counted as online for 60 seconds after their
 * last beat while a tab beat every 90, and someone at work showed as Offline
 * for a third of the time (PR 246).
 *
 * Signing in marks a person ACTIVE and seen (lib/auth.ts); each open tab that
 * is shown beats while it's open (components/UserHeartbeat.tsx), which marks
 * them seen again (UserService.updateActivity). A tab out of sight doesn't
 * beat, so a person whose only tab is hidden shows as offline, as before.
 */

/** How often an open, shown tab tells the server its person is there. */
export const HEARTBEAT_MS = 90_000

/**
 * How long after their last beat a person still shows as online: two beats
 * and a little, so one beat lost to a bad connection, or a slow answer,
 * doesn't show them offline.
 */
export const ONLINE_WINDOW_MS = 2 * HEARTBEAT_MS + 20_000

/**
 * A person's status as the list shows it: someone signed in (ACTIVE) and seen
 * within the window is online, and signed in and not seen within it is
 * offline. Every other status is as it's stored. Everyone has been seen at
 * some time: the column is never empty, and starts at the moment they were
 * added.
 */
export function presenceStatus(status: string, lastActivity: Date | string, now: Date = new Date()): string {
    if (status !== "ACTIVE") return status
    return now.getTime() - new Date(lastActivity).getTime() > ONLINE_WINDOW_MS ? "OFFLINE" : "ACTIVE"
}

/** The list's Online and Offline filters, asking what presenceStatus shows. */
export function presenceWhere(filter: "ACTIVE" | "OFFLINE", now: Date = new Date()) {
    const cutoff = new Date(now.getTime() - ONLINE_WINDOW_MS)
    if (filter === "ACTIVE") return { status: "ACTIVE", lastActivity: { gte: cutoff } }
    return {
        OR: [
            { status: "OFFLINE" },
            { status: "ACTIVE", lastActivity: { lt: cutoff } },
        ],
    }
}
