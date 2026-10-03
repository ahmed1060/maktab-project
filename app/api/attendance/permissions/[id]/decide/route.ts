import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import { punchCompany, decidesPerson } from "@/lib/attendance/punch-access"
import { decisionSchema } from "@/lib/validations/attendance-request.schema"

/** Approves or rejects somebody else's permission hours. */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const { id } = await context.params
    const validation = decisionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const request = await AttendanceRequestService.permissionOf(id)
    if (!request) return ApiResponse.notFound("Request not found.")
    const access = await punchCompany(session, request.companyId)
    if ("denied" in access || access.companyId !== request.companyId) return ApiResponse.notFound("Request not found.")
    const target = { companyId: request.companyId, userId: request.userId, teamLeaderId: request.user.teamLeaderId }
    if (!decidesPerson(session, "attendance.approve_permissions", target)) return ApiResponse.forbidden()
    await AttendanceRequestService.decidePermission(id, validation.data, session.user.id)
    return ApiResponse.success({ decided: true })
})
