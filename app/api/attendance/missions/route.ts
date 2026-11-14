import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { sessionHasModule } from "@/lib/features/require"
import { MissionRequestService } from "@/lib/services/mission-request.service"
import { asksForSelf } from "@/lib/attendance/punch-access"
import { missionRequestSchema } from "@/lib/validations/attendance-request.schema"

/**
 * Asks for a mission, for oneself (ATTENDANCE_PLAN.md §6.10, PR 283), with
 * one of their open tasks where the company has Tasks. Missions are read and
 * decided on the Requests page, through its feed.
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = missionRequestSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = asksForSelf(session)
    if (!self) return ApiResponse.forbidden()
    const created = await MissionRequestService.ask(self.companyId, self.userId, validation.data, { tasks: sessionHasModule(session, "TASKS") })
    return ApiResponse.success(created, 201)
})
