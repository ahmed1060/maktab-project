/**
 * Where an attendance notification opens (ATTENDANCE_PLAN.md §13.4): the
 * Attendance page. Checked before the bell's other branches, because
 * ATTENDANCE_REQUEST also contains REQUEST, whose branch reads an internal
 * request's id and opens the Requests page — the wrong product (review on #15).
 *
 * A decision on permission hours or a missing punch opens the one Requests
 * page, with the request picked out, since they're asked for and decided
 * there (UI_PLAN.md §2.3, part 3c). Its notice's key says which it was; an
 * older notice without one opens the Attendance page, as before.
 *
 * A new phone waiting opens it on the Requests page, where it's decided
 * (part 4d); its notice names the page itself. One sent before named the
 * Attendance page's tab that only points there now, so it opens the
 * Requests page's phones instead.
 */
export const ATTENDANCE_PAGE = "/dashboard/attendance"

/** The notices of a decision on a kind that moved to the Requests page, and which kind. */
const ON_REQUESTS_PAGE: Record<string, string> = {
    notice_att_permission_approved: "permission",
    notice_att_permission_rejected: "permission",
    notice_att_missing_approved: "missingPunch",
    notice_att_missing_rejected: "missingPunch",
}

/** Where a notice about a new phone sent deciders before part 4d. */
const OLD_PHONE_REQUESTS = "/dashboard/attendance?tab=requests"

export function attendanceNoticeTarget(type: string, relatedId: string | null, messageKey?: string | null): string | null {
    if (!type.toUpperCase().startsWith("ATTENDANCE")) return null
    if (relatedId === OLD_PHONE_REQUESTS && messageKey === "notice_att_phone_requested") return "/dashboard/requests?tab=review&kind=phone"
    if (relatedId?.startsWith("/")) return relatedId
    const kind = messageKey ? ON_REQUESTS_PAGE[messageKey] : undefined
    if (kind && relatedId) return `/dashboard/requests?kind=${kind}&highlight=${encodeURIComponent(relatedId)}`
    return ATTENDANCE_PAGE
}
