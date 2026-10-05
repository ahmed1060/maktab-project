import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceAgentService } from "@/lib/services/attendance-agent.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"

/** Revokes an agent: its token stops working at once. */
export const DELETE = withStandardHandler(async (_req, session, _json, { params }) => {
    const agent = await AttendanceAgentService.agentOf(params.id)
    if (!agent) return ApiResponse.notFound("Agent not found")
    const denied = await denyTerminals(session, agent.companyId, "edit")
    if (denied) return denied
    await AttendanceAgentService.revoke(agent.id, session.user.id)
    return ApiResponse.success({ revoked: true })
})
