import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import { asksForSelf } from "@/lib/attendance/punch-access"

/** Withdraws one's own report while it waits. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const { id } = await context.params
    const self = asksForSelf(session)
    if (!self) return ApiResponse.notFound("Request not found.")
    await AttendanceRequestService.cancelMissingPunch(id, self.userId)
    return ApiResponse.success({ cancelled: true })
})
