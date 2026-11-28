import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import { asksForSelf } from "@/lib/attendance/punch-access"
import { balanceAsShown } from "@/lib/attendance/permission-left"

/**
 * One's own permission hours for a month: allowed, spent, waiting and left.
 * With `date`, under the policy in force that day — the rules a request for
 * it is held to. And the days they may be asked for, where the policy in
 * force today says any day (LATER_CHANGES_PLAN.md §7.4, 4b), for the form's
 * calendar to offer only them; around the day, the first day that may be
 * (§7.20).
 */
export const GET = withStandardHandler(async (req, session) => {
    const self = asksForSelf(session)
    if (!self) return ApiResponse.forbidden()
    const params = new URL(req.url).searchParams
    const date = params.get("date")
    const month = date?.slice(0, 7) ?? params.get("month") ?? (await AttendanceRequestService.todayIn(self.companyId)).slice(0, 7)
    // Without what's left while the company hides it (LATER_CHANGES_PLAN.md §7.18).
    return ApiResponse.success({
        ...balanceAsShown(await AttendanceRequestService.permissionBalance(self.companyId, self.userId, month, date)),
        days: await AttendanceRequestService.permissionDays(self.companyId),
        // Around the day, the first day that may be asked for, for the calendar to start on (LATER_CHANGES_PLAN.md §7.20).
        earliest: await AttendanceRequestService.permissionEarliest(self.companyId, self.userId),
    })
})
