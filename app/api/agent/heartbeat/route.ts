import { NextResponse } from "next/server"
import { withAgentHandler } from "@/lib/attendance/agent-handler"
import { heartbeatSchema } from "@/lib/attendance/agent-payloads"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"

/**
 * An agent checking in (ATTENDANCE_PLAN.md §17, §13.2): its version, what it
 * still holds, its clock, and the terminals it reads. Answers with each
 * terminal's state and mode, our clock, and whether to rotate its token.
 */
export const POST = withAgentHandler(async (_req, agent, body) => {
    const parsed = heartbeatSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_BODY", error: "The heartbeat isn't in the expected shape.", details: parsed.error.issues.slice(0, 10) }, { status: 400 })
    return NextResponse.json({ success: true, data: await AttendanceDeviceService.heartbeat(agent, parsed.data) })
})
