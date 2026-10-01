import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import { asksForSelf } from "@/lib/attendance/punch-access"

/**
 * One's own permission hours for a month: allowed, spent, waiting and left.
 * With `date`, under the policy in force that day — the rules a request for
 * it is held to.
 */
export const GET = withStandardHandler(async (req, session) => {
    const self = asksForSelf(session)
    if (!self) return ApiResponse.forbidden()
    const params = new URL(req.url).searchParams
    const date = params.get("date")
    const month = date?.slice(0, 7) ?? params.get("month") ?? (await AttendanceRequestService.todayIn(self.companyId)).slice(0, 7)
    return ApiResponse.success(await AttendanceRequestService.permissionBalance(self.companyId, self.userId, month, date))
})
