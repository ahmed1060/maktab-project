import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { versionSchema } from "@/lib/validations/attendance-calendar.schema"

/** New hours for a schedule from a date (ATTENDANCE_PLAN.md §6.1). */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const validation = versionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const schedule = await AttendanceCalendarService.scheduleOf(context.params.id)
    if (!schedule) return ApiResponse.notFound("Schedule not found")
    const denied = await denyAttendanceSettings(session, schedule.companyId, "edit")
    if (denied) return denied
    return ApiResponse.success(await AttendanceCalendarService.addVersion(schedule.id, validation.data, session.user.id), 201)
})
