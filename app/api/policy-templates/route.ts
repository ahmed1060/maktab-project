import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePolicyService } from "@/lib/services/attendance-policy.service"
import { policyTemplateSchema as templateSchema } from "@/lib/validations/attendance-calendar.schema"

/** Attendance policy templates (ATTENDANCE_PLAN.md §6.8), kept by the Super Admin. */

export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success({ templates: await AttendancePolicyService.templates() })
})

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = templateSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await AttendancePolicyService.createTemplate(validation.data, session.user.id), 201)
})
