import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceAgentService } from "@/lib/services/attendance-agent.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"
import { assertStepUp } from "@/lib/step-up"

/**
 * A new one-time code: the first ran out, or the agent is moving to another
 * PC. Asks for the step-up code, as the first did (ATTENDANCE_PLAN.md §17.10).
 */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    const agent = await AttendanceAgentService.agentOf(params.id)
    if (!agent) return ApiResponse.notFound("Agent not found")
    const denied = await denyTerminals(session, agent.companyId)
    if (denied) return denied
    await assertStepUp(session, "attendance.manage_terminals")
    return ApiResponse.success(await AttendanceAgentService.reissueCode(agent.id, session.user.id))
})
