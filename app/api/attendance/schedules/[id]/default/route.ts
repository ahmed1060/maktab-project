import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { setDefaultSchema } from "@/lib/validations/attendance-calendar.schema"

/** Make a schedule the company's default from a date: unassigned people move to it then, not before. */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const validation = setDefaultSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const schedule = await AttendanceCalendarService.scheduleOf(context.params.id)
    if (!schedule) return ApiResponse.notFound("Schedule not found")
    const denied = await denyAttendanceSettings(session, schedule.companyId, "edit")
    if (denied) return denied
    await AttendanceCalendarService.setDefault(schedule.id, validation.data.effectiveFrom, session.user.id)
    return ApiResponse.success({ effectiveFrom: validation.data.effectiveFrom })
})
