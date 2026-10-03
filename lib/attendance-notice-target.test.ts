import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { attendanceNoticeTarget } from "./attendance-notice-target"

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

    it("is routed by the bell before the generic request branch", () => {
        const bell = readFileSync("components/NotificationBell.tsx", "utf8")
        const attendance = bell.indexOf("attendanceNoticeTarget(type")
        const request = bell.indexOf("type.includes('REQUEST')")
        expect(attendance).toBeGreaterThan(0)
        expect(attendance).toBeLessThan(request)
    })
})
