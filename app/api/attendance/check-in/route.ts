import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCheckInService } from "@/lib/services/attendance-check-in.service"
import { mobileSelf } from "@/lib/attendance/mobile-access"
import { checkInSchema } from "@/lib/validations/attendance-phone.schema"

/** The address a request came from: the first hop the platform's proxy recorded. */
function clientIp(req: Request): string | null {
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    return forwarded || req.headers.get("x-real-ip")?.trim() || null
}

/**
 * Checking in with the app (ATTENDANCE_PLAN.md §9.4, §9.6). The answer says
 * what became of it: accepted, flagged for a person, held for the phone's
 * approval, or refused and why. A refusal is an answer, not an error: the
 * person is told why, and it is recorded.
 */
export const POST = withStandardHandler(async (req, session, json) => {
    const validation = checkInSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = await mobileSelf(session)
    if ("denied" in self) return self.denied
    return ApiResponse.success(await AttendanceCheckInService.checkIn(self.companyId, self.userId, validation.data, clientIp(req)))
})
