import { NextResponse } from "next/server"
import { withAgentHandler } from "@/lib/attendance/agent-handler"
import { punchBatchSchema } from "@/lib/attendance/agent-payloads"
import { AttendanceIngestService } from "@/lib/services/attendance-ingest.service"

/**
 * Punches from the terminals, up to a thousand at a time
 * (ATTENDANCE_PLAN.md §17). Body: `{ punches: [{ serialNumber, userNumber,
 * at }] }`, `at` the terminal's wall clock. Answers how many were stored, how
 * many it already had, and for each one refused, why and whether to retry.
 */
export const POST = withAgentHandler(async (_req, agent, body) => {
    const parsed = punchBatchSchema.safeParse(body)
    if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_BODY", error: "The punches aren't in the expected shape.", details: parsed.error.issues.slice(0, 10) }, { status: 400 })
    return NextResponse.json({ success: true, data: await AttendanceIngestService.punches(agent, parsed.data) })
})
