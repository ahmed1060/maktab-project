import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"

/** Withdraw a change of default schedule, while payroll has not locked the dates it governs. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const row = await AttendanceCalendarService.defaultOf(context.params.id)
    if (!row) return ApiResponse.notFound("Not found")
    const denied = await denyAttendanceSettings(session, row.companyId, "edit")
    if (denied) return denied
    await AttendanceCalendarService.withdrawDefault(row.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})
