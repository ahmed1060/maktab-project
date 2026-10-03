import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceChallengeService } from "@/lib/services/attendance-challenge.service"
import { mobileSelf } from "@/lib/attendance/mobile-access"
import { challengeSchema } from "@/lib/validations/attendance-phone.schema"

/** A one-time number for the phone to sign, just before it registers or checks in (ATTENDANCE_PLAN.md §9.2). */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = challengeSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = await mobileSelf(session)
    if ("denied" in self) return self.denied
    return ApiResponse.success(await AttendanceChallengeService.issue(self.userId, validation.data.purpose))
})
