import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"
import { MAX_IP_RANGES } from "@/lib/attendance/ip-ranges"
import { assertStepUp } from "@/lib/step-up"

const schema = z.object({
    connection: z.enum(["AGENT", "DIRECT"]),
    officeAddresses: z.array(z.string().max(64)).max(MAX_IP_RANGES).optional(),
})

/**
 * A terminal moved to its other way of connecting (ATTENDANCE_PLAN.md
 * §17.6, §17.7, PR 298). Straight to Nizmo, scans are let in from the
 * office's address, or from an address issued for it, so it asks for the
 * step-up code (§17.10), as adding it did. To the agent, nothing is let
 * in, and it doesn't.
 */
export const PUT = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const device = await AttendanceDeviceService.deviceOf(params.id)
    if (!device) return ApiResponse.notFound("Terminal not found")
    const denied = await denyTerminals(session, device.companyId)
    if (denied) return denied
    if (validation.data.connection === "DIRECT") await assertStepUp(session, "attendance.manage_terminals")
    return ApiResponse.success(await AttendanceDeviceService.changeConnection(device.id, validation.data, session.user.id))
})
