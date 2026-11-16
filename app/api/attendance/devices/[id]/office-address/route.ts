import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"
import { MAX_IP_RANGES } from "@/lib/attendance/ip-ranges"
import { assertStepUp } from "@/lib/step-up"

const schema = z.object({ addresses: z.array(z.string().max(64)).max(MAX_IP_RANGES) })

/**
 * The office's internet addresses a ZKTeco terminal straight to Nizmo is
 * let in from, changed (ATTENDANCE_PLAN.md §17.3, §17.7, PR 297). From
 * there, scans are let in for any employee number, so it asks for the
 * step-up code (§17.10), as adding the terminal did.
 */
export const PUT = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const device = await AttendanceDeviceService.deviceOf(params.id)
    if (!device) return ApiResponse.notFound("Terminal not found")
    const denied = await denyTerminals(session, device.companyId)
    if (denied) return denied
    await assertStepUp(session, "attendance.manage_terminals")
    return ApiResponse.success(await AttendanceDeviceService.setOfficeAddresses(device.id, validation.data.addresses, session.user.id))
})
