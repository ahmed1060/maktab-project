import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceAgentService } from "@/lib/services/attendance-agent.service"
import { attendanceCompanyFor } from "@/lib/attendance/settings-access"
import { denyTerminals } from "@/lib/attendance/terminals-access"

/** The company's Local Sync Agents (ATTENDANCE_PLAN.md §17). */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyTerminals(session, companyId, "view")
    if (denied) return denied
    return ApiResponse.success({ agents: await AttendanceAgentService.list(companyId!) })
})

const schema = z.object({ companyId: z.string().optional(), name: z.string().max(80) })

/** A new agent, and the one-time code to enrol it with — shown once. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyTerminals(session, companyId, "edit")
    if (denied) return denied
    return ApiResponse.success(await AttendanceAgentService.create(companyId!, validation.data.name, session.user.id), 201)
})
