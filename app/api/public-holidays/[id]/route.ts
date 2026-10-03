import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PublicHolidayService } from "@/lib/services/public-holiday.service"
import { publicHolidaySchema } from "@/lib/validations/attendance-calendar.schema"

/** Move or rename a public holiday: companies that observe it follow, and ones that opted out stay out. */
export const PUT = withStandardHandler(async (_req, session, json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = publicHolidaySchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await PublicHolidayService.update(context.params.id, validation.data, session.user.id))
})

export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    await PublicHolidayService.remove(context.params.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})
