import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { attendanceNoticeTarget } from "./attendance-notice-target"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * An attendance notification opens the Attendance page, not the Requests page
 * its type's "REQUEST" would otherwise send it to (review on #15).
 */
describe("an attendance notification", () => {
    it("opens the Attendance page, or the page it names", () => {
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "a-request-id")).toBe("/dashboard/attendance")
        expect(attendanceNoticeTarget("ATTENDANCE_DAY", "/dashboard/attendance")).toBe("/dashboard/attendance")
        expect(attendanceNoticeTarget("REQUEST_STATUS", "r1")).toBeNull()
        expect(attendanceNoticeTarget("DAY_OFF_RESULT", "d1")).toBeNull()
    })

    it("opens permission hours and missing punches on the Requests page, picked out, now that they're decided there (UI_PLAN.md §2.3, part 3c)", () => {
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "p1", "notice_att_permission_approved")).toBe("/dashboard/requests?kind=permission&highlight=p1")
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "p1", "notice_att_permission_rejected")).toBe("/dashboard/requests?kind=permission&highlight=p1")
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "m1", "notice_att_missing_approved")).toBe("/dashboard/requests?kind=missingPunch&highlight=m1")
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "m1", "notice_att_missing_rejected")).toBe("/dashboard/requests?kind=missingPunch&highlight=m1")
        // Overtime decided is about one's own day, which is on the Attendance page.
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "o1", "notice_att_overtime_approved")).toBe("/dashboard/attendance")
        // An old notice with no key still opens the Attendance page.
        expect(attendanceNoticeTarget("ATTENDANCE_REQUEST", "p1", null)).toBe("/dashboard/attendance")
    })

    it("opens a new phone waiting on the Requests page, an old notice's too, now that it's decided there (part 4d)", () => {
        // The notice's own link, with the phone picked out.
        expect(attendanceNoticeTarget("ATTENDANCE_PHONE", "/dashboard/requests?tab=review&kind=phone&highlight=ph1", "notice_att_phone_requested"))
            .toBe("/dashboard/requests?tab=review&kind=phone&highlight=ph1")
        // One sent before, to the Attendance page's tab that points there now.
        expect(attendanceNoticeTarget("ATTENDANCE_PHONE", "/dashboard/attendance?tab=requests", "notice_att_phone_requested")).toBe("/dashboard/requests?tab=review&kind=phone")
        // One's own phone decided stays on the Attendance page.
        expect(attendanceNoticeTarget("ATTENDANCE_PHONE", null, "notice_att_phone_approved")).toBe("/dashboard/attendance")
    })

    it("says where the new phone is decided: the Requests page, not the Attendance page's tab (found in the browser)", () => {
        expect(en.notice_att_phone_requested).toContain("Requests page")
        expect(en.notice_att_phone_requested).not.toContain("Attendance →")
        expect(ar.notice_att_phone_requested).toContain("صفحة الطلبات")
        expect(ar.notice_att_phone_requested).not.toContain("الحضور ←")
    })

    it("is given the notice's key by the bell and by the push, which open the same page", () => {
        expect(readFileSync("components/NotificationBell.tsx", "utf8")).toContain("attendanceNoticeTarget(type, notification.relatedId, notification.messageKey)")
        expect(readFileSync("lib/services/push.service.ts", "utf8")).toContain("attendanceNoticeTarget(n.type, n.relatedId, n.messageKey)")
    })

    it("is routed by the bell before the generic request branch", () => {
        const bell = readFileSync("components/NotificationBell.tsx", "utf8")
        const attendance = bell.indexOf("attendanceNoticeTarget(type")
        const request = bell.indexOf("type.includes('REQUEST')")
        expect(attendance).toBeGreaterThan(0)
        expect(attendance).toBeLessThan(request)
    })
})
