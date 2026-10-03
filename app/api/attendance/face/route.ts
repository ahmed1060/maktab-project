import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceVerificationService } from "@/lib/services/face-verification.service"

/** Where face verification stands for oneself (ATTENDANCE_PLAN.md §9.5): asked of them, consented, in use. */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role === "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success(await FaceVerificationService.statusFor(session.user.id))
})
