import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { sessionHasModule } from "@/lib/features/require"
import { MissionRequestService } from "@/lib/services/mission-request.service"
import { asksForSelf } from "@/lib/attendance/punch-access"

/**
 * One's open tasks, which asking for a mission may name (ATTENDANCE_PLAN.md
 * §6.10, decision 18): none where the company hasn't Tasks.
 */
export const GET = withStandardHandler(async (_req, session) => {
    const self = asksForSelf(session)
    if (!self || !sessionHasModule(session, "TASKS")) return ApiResponse.success({ tasks: [] })
    return ApiResponse.success({ tasks: await MissionRequestService.openTasks(self.companyId, self.userId) })
})
