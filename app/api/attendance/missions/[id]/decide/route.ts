import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { MissionRequestService } from "@/lib/services/mission-request.service"
import { punchCompany, decidesPerson } from "@/lib/attendance/punch-access"
import { decisionSchema } from "@/lib/validations/attendance-request.schema"

/** Approves or rejects somebody else's mission, with Decide missions at them (ATTENDANCE_PLAN.md §6.10, decision 4). */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const { id } = await context.params
    const validation = decisionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const mission = await MissionRequestService.of(id)
    if (!mission) return ApiResponse.notFound("Request not found.")
    const access = await punchCompany(session, mission.companyId)
    if ("denied" in access || access.companyId !== mission.companyId) return ApiResponse.notFound("Request not found.")
    const target = { companyId: mission.companyId, userId: mission.userId, teamLeaderId: mission.user.teamLeaderId }
    if (!decidesPerson(session, "attendance.approve_missions", target)) return ApiResponse.forbidden()
    await MissionRequestService.decide(id, validation.data, session.user.id)
    return ApiResponse.success({ decided: true })
})
