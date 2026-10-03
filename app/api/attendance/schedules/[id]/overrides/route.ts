import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { overrideSchema } from "@/lib/validations/attendance-calendar.schema"

/** Dated hours laid over a schedule: Ramadan, summer hours (ATTENDANCE_PLAN.md §7.1). */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const validation = overrideSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const schedule = await AttendanceCalendarService.scheduleOf(context.params.id)
    if (!schedule) return ApiResponse.notFound("Schedule not found")
    const denied = await denyAttendanceSettings(session, schedule.companyId, "edit")
    if (denied) return denied
    return ApiResponse.success(await AttendanceCalendarService.createOverride(schedule.id, validation.data, session.user.id), 201)
})
