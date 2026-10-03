import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"

/** Remove one of the company's own holidays. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const holiday = await AttendanceCalendarService.holidayOf(context.params.id)
    if (!holiday) return ApiResponse.notFound("Holiday not found")
    const denied = await denyAttendanceSettings(session, holiday.companyId, "edit")
    if (denied) return denied
    await AttendanceCalendarService.deleteHoliday(holiday.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})
