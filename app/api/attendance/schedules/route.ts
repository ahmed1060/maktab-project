import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { createScheduleSchema } from "@/lib/validations/attendance-calendar.schema"

/** A new schedule with its first hours. The company's first one becomes its default, from those hours' date. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = createScheduleSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    const { name, version } = validation.data
    return ApiResponse.success(await AttendanceCalendarService.createSchedule(companyId!, { name, version }, session.user.id), 201)
})
