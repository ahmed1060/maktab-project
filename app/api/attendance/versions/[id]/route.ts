import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"

/** Withdraw a change of hours, while payroll has not locked its month. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const version = await AttendanceCalendarService.versionOf(context.params.id)
    if (!version) return ApiResponse.notFound("Version not found")
    const denied = await denyAttendanceSettings(session, version.schedule.companyId, "edit")
    if (denied) return denied
    await AttendanceCalendarService.deleteVersion(context.params.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})
