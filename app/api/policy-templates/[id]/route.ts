import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePolicyService } from "@/lib/services/attendance-policy.service"
import { policyTemplateSchema as templateSchema } from "@/lib/validations/attendance-calendar.schema"

/** Edit a template: no company changes, since applying one copied it (ATTENDANCE_PLAN.md §6.8). */
export const PUT = withStandardHandler(async (_req, session, json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = templateSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await AttendancePolicyService.updateTemplate(context.params.id, validation.data, session.user.id))
})

export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    await AttendancePolicyService.deleteTemplate(context.params.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})
