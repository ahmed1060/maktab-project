import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { overrideSchema } from "@/lib/validations/attendance-calendar.schema"

async function locate(session: any, id: string) {
    const override = await AttendanceCalendarService.overrideOf(id)
    if (!override) return { response: ApiResponse.notFound("Override not found") }
    const denied = await denyAttendanceSettings(session, override.schedule.companyId, "edit")
    return denied ? { response: denied } : { override }
}

/** Change seasonal hours: Ramadan's dates are confirmed late (ATTENDANCE_PLAN.md §7.1). */
export const PUT = withStandardHandler(async (_req, session, json, context) => {
    const validation = overrideSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await locate(session, context.params.id)
    if (found.response) return found.response
    return ApiResponse.success(await AttendanceCalendarService.updateOverride(context.params.id, validation.data, session.user.id))
})

export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const found = await locate(session, context.params.id)
    if (found.response) return found.response
    await AttendanceCalendarService.deleteOverride(context.params.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})
