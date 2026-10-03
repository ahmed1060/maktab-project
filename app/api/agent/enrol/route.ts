import { NextResponse } from "next/server"
import { withEnrolmentHandler } from "@/lib/attendance/agent-handler"
import { AttendanceAgentService } from "@/lib/services/attendance-agent.service"

/**
 * An agent's first call (ATTENDANCE_PLAN.md §17): the one-time code an admin
 * was shown, exchanged for the token it uses from then on. Body:
 * `{ code, hostname?, agentVersion? }`.
 */
export const POST = withEnrolmentHandler(async (_req, body) => {
    const str = (v: unknown) => (typeof v === "string" ? v : null)
    const code = str(body.code)
    if (!code) return NextResponse.json({ success: false, code: "ENROLMENT_CODE_INVALID", error: "Send the enrolment code." }, { status: 400 })
    const enrolled = await AttendanceAgentService.enrol(code, { hostname: str(body.hostname), agentVersion: str(body.agentVersion) })
    return NextResponse.json({ success: true, data: enrolled }, { status: 201 })
})
