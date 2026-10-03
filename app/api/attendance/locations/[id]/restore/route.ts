import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceLocationService } from "@/lib/services/attendance-location.service"
import { locationFor } from "@/lib/attendance/mobile-access"

/** Back in use. */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    const found = await locationFor(session, params.id)
    if ("denied" in found) return found.denied
    await AttendanceLocationService.restore(found.location.id, session.user.id)
    return ApiResponse.success({ restored: true })
})
