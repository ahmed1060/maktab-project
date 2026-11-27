import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { sessionHasModule } from "@/lib/features/require"
import { MissionOutOfRange, MissionRequestService } from "@/lib/services/mission-request.service"
import { asksForSelf } from "@/lib/attendance/punch-access"
import { missionRequestSchema } from "@/lib/validations/attendance-request.schema"

/**
 * Asks for a mission, for oneself (ATTENDANCE_PLAN.md §6.10, PR 283), with
 * one of their open tasks where the company has Tasks. Missions are read and
 * decided on the Requests page, through its feed. A date outside the days it
 * may be asked for is refused with them (LATER_CHANGES_PLAN.md §7.4, 4c).
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = missionRequestSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = asksForSelf(session)
    if (!self) return ApiResponse.forbidden()
    try {
        const created = await MissionRequestService.ask(self.companyId, self.userId, validation.data, { tasks: sessionHasModule(session, "TASKS") })
        return ApiResponse.success(created, 201)
    } catch (error) {
        // A date outside the days it may be asked for, with them (LATER_CHANGES_PLAN.md §7.4, 4c).
        if (error instanceof MissionOutOfRange) return ApiResponse.refused(400, `Missions can be asked for from ${error.from} to ${error.to}.`, error.message, { from: error.from, to: error.to })
        throw error
    }
})
