import { NextResponse } from "next/server"
import { withAgentHandler } from "@/lib/attendance/agent-handler"
import { AttendanceAgentService } from "@/lib/services/attendance-agent.service"

/**
 * A new token for the calling agent (ATTENDANCE_PLAN.md §17). The current
 * one keeps working until the new one is first used.
 */
export const POST = withAgentHandler(async (_req, agent) => {
    return NextResponse.json({ success: true, data: await AttendanceAgentService.rotate(agent) })
})
