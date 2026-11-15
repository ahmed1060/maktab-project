import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"
import { assertStepUp } from "@/lib/step-up"

/**
 * A new address for a Hikvision terminal straight to Nizmo, returned once
 * (ATTENDANCE_PLAN.md §17.2, §17.7, PR 292). The one it has stops working
 * at once. The address lets scans in for any employee number, so it asks
 * for the step-up code (§17.10).
 */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    const device = await AttendanceDeviceService.deviceOf(params.id)
    if (!device) return ApiResponse.notFound("Terminal not found")
    const denied = await denyTerminals(session, device.companyId)
    if (denied) return denied
    await assertStepUp(session, "attendance.manage_terminals")
    return ApiResponse.success(await AttendanceDeviceService.issueAddress(device.id, session.user.id))
})
