import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { updateScheduleSchema } from "@/lib/validations/attendance-calendar.schema"

/** Rename a schedule. Making it the default is dated: ./default. */
export const PATCH = withStandardHandler(async (_req, session, json, context) => {
    const validation = updateScheduleSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const schedule = await AttendanceCalendarService.scheduleOf(context.params.id)
    if (!schedule) return ApiResponse.notFound("Schedule not found")
    const denied = await denyAttendanceSettings(session, schedule.companyId, "edit")
    if (denied) return denied
    return ApiResponse.success(await AttendanceCalendarService.updateSchedule(schedule.id, validation.data, session.user.id))
})

/** Retire a schedule nobody is on. Kept, since past days were measured against it. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const schedule = await AttendanceCalendarService.scheduleOf(context.params.id)
    if (!schedule) return ApiResponse.notFound("Schedule not found")
    const denied = await denyAttendanceSettings(session, schedule.companyId, "edit")
    if (denied) return denied
    await AttendanceCalendarService.archiveSchedule(schedule.id, session.user.id)
    return ApiResponse.success({ archived: true })
})
