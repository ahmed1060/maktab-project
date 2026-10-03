/**
 * Where an attendance notification opens (ATTENDANCE_PLAN.md §13.4): the
 * Attendance page. Checked before the bell's other branches, because
 * ATTENDANCE_REQUEST also contains REQUEST, whose branch reads an internal
 * request's id and opens the Requests page — the wrong product (review on #15).
 */
export const ATTENDANCE_PAGE = "/dashboard/attendance"

export function attendanceNoticeTarget(type: string, relatedId: string | null): string | null {
    if (!type.toUpperCase().startsWith("ATTENDANCE")) return null
    return relatedId?.startsWith("/") ? relatedId : ATTENDANCE_PAGE
}
