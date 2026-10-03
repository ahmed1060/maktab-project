import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceExceptionService } from "@/lib/services/attendance-exception.service"
import { punchCompany, correctsPerson } from "@/lib/attendance/punch-access"

/** Takes back a decision on a day: it is charged as measured again. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const { id } = await context.params
    const decision = await AttendanceExceptionService.decisionOf(id)
    if (!decision) return ApiResponse.notFound("Decision not found.")
    const access = await punchCompany(session, decision.companyId)
    if ("denied" in access || access.companyId !== decision.companyId) return ApiResponse.notFound("Decision not found.")
    if (!correctsPerson(session, { companyId: decision.companyId, userId: decision.userId, teamLeaderId: decision.user.teamLeaderId })) return ApiResponse.forbidden()
    await AttendanceExceptionService.withdraw(id, session.user.id)
    return ApiResponse.success({ withdrawn: true })
})
