import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceAgentService } from "@/lib/services/attendance-agent.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"

/** A new one-time code: the first ran out, or the agent is moving to another PC. */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    const agent = await AttendanceAgentService.agentOf(params.id)
    if (!agent) return ApiResponse.notFound("Agent not found")
    const denied = await denyTerminals(session, agent.companyId, "edit")
    if (denied) return denied
    return ApiResponse.success(await AttendanceAgentService.reissueCode(agent.id, session.user.id))
})
