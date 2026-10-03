import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import { punchCompany, decidesPerson } from "@/lib/attendance/punch-access"

/** Takes back a decision on overtime: the day waits again. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const { id } = await context.params
    const decision = await AttendanceRequestService.decisionOf(id)
    if (!decision) return ApiResponse.notFound("Decision not found.")
    const access = await punchCompany(session, decision.companyId)
    if ("denied" in access || access.companyId !== decision.companyId) return ApiResponse.notFound("Decision not found.")
    if (!decidesPerson(session, "attendance.approve_overtime", { companyId: decision.companyId, userId: decision.userId, teamLeaderId: decision.user.teamLeaderId })) return ApiResponse.forbidden()
    await AttendanceRequestService.withdrawOvertime(id, session.user.id)
    return ApiResponse.success({ withdrawn: true })
})
