import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { MissionRequestService } from "@/lib/services/mission-request.service"
import { asksForSelf } from "@/lib/attendance/punch-access"

/** Withdraws one's own mission while it waits (ATTENDANCE_PLAN.md §6.10, decision 25). */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const { id } = await context.params
    const self = asksForSelf(session)
    if (!self) return ApiResponse.notFound("Request not found.")
    await MissionRequestService.withdraw(id, self.userId)
    return ApiResponse.success({ withdrawn: true })
})
