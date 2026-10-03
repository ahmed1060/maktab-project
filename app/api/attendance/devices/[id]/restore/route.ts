import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { denyTerminals } from "@/lib/attendance/terminals-access"

/** A retired terminal back in use. */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    const device = await AttendanceDeviceService.deviceOf(params.id)
    if (!device) return ApiResponse.notFound("Terminal not found")
    const denied = await denyTerminals(session, device.companyId, "edit")
    if (denied) return denied
    await AttendanceDeviceService.restore(device.id, session.user.id)
    return ApiResponse.success({ restored: true })
})
