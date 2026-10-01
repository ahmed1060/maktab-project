import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { assignSchema } from "@/lib/validations/attendance-calendar.schema"

/** Put people on a schedule from a date. Anybody not assigned works the default. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = assignSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    const { userIds, scheduleId, effectiveFrom } = validation.data
    await AttendanceCalendarService.assign(companyId!, { userIds, scheduleId, effectiveFrom }, session.user.id)
    return ApiResponse.success({ assigned: userIds.length })
})
