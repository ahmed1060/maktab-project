import { attendanceNoticeTarget } from "@/lib/attendance-notice-target"

/** What of a notification says where it leads. */
export type NoticeForTarget = {
    id: string
    type: string
    relatedId: string | null
    messageKey?: string | null
    /** Whose it is; null for a Super Admin's. */
    userId: string | null
}

/** One of the app's own addresses: "//host" and "/\host" are another site's, to a browser. */
const inApp = (path: string) => path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")

/**
 * Where a notification leads (DESIGN.md §5.1): the page of what it's about,
 * or null for one with nowhere to go, which the bell's panel shows as a row
 * that isn't a link. Moved here from the bell, which followed the same
 * branches on a click, so its rows can be links.
 *
 * Attendance comes first, because ATTENDANCE_REQUEST also contains REQUEST,
 * whose branch reads an internal request's id (lib/attendance-notice-target.ts).
 * A notice that names its page itself is followed only to one of the app's.
 */
export function noticeTarget(n: NoticeForTarget): string | null {
    const related = n.relatedId
    if (!related) return null
    const type = n.type.toUpperCase()
    const page = (path: string | null) => (path && inApp(path) ? path : null)
    const id = encodeURIComponent(related)

    const attendance = attendanceNoticeTarget(type, related, n.messageKey)
    if (attendance) return page(attendance)
    // Its relatedId is a dashboard path, not an entity id.
    if (type.startsWith("ROLE_") || type.includes("SUBSCRIPTION")) return page(related)
    if (type.includes("TASK")) return `/dashboard/tasks?highlight=${id}`
    if (type.includes("OBLIGATION")) return `/dashboard/obligations?highlight=${id}`
    // On the one Requests page (UI_PLAN.md §2.3, part 2d).
    if (type.includes("DAY_OFF")) return `/dashboard/requests?kind=dayOff&highlight=${id}`
    // Their own pay history; a Super Admin has none.
    if (type.includes("BONUS") || type.includes("DEDUCTION")) return n.userId ? `/dashboard/employees/${encodeURIComponent(n.userId)}/history?highlight=${id}` : null
    // A decision on one's name change, on the one Requests page (part 5a).
    if (type.includes("PROFILE")) return `/dashboard/requests?kind=nameChange&highlight=${id}`
    if (type.includes("NOTE")) {
        // A record's page, with the note picked out unless it already is.
        const path = page(related)
        if (!path) return null
        if (path.includes("highlight=") || path.includes("noteId=")) return path
        return `${path}${path.includes("?") ? "&" : "?"}highlight=${encodeURIComponent(n.id)}`
    }
    // The person's own profile, which shows their leader, or the leader's team list.
    if (type.includes("TEAM")) return page(related)
    // The Requests page opens it on its tab, and on Waiting or Done by its status.
    if (type.includes("REQUEST")) return `/dashboard/requests?highlight=${id}`
    return null
}
