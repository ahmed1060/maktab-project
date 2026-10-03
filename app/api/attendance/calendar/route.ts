import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { can } from "@/lib/permissions/can"

/**
 * A company's attendance calendar (ATTENDANCE_PLAN.md §7): schedules with their
 * versions and overrides, who works which, and one year's holidays.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    const companyId = attendanceCompanyFor(session, params.get("companyId"))
    const denied = await denyAttendanceSettings(session, companyId, "view")
    if (denied) return denied
    const asked = Number(params.get("year"))
    const today = await AttendanceCalendarService.today(companyId!)
    const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : Number(today.slice(0, 4))
    return ApiResponse.success({
        ...(await AttendanceCalendarService.calendar(companyId!, year)),
        canEdit: can(session.user, "settings.edit", { companyId: companyId! }),
    })
})
