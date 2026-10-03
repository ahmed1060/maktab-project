import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceReviewService } from "@/lib/services/face-review.service"
import { faceCompany } from "@/lib/attendance/face-access"

/** Verification photos waiting for a decision (ATTENDANCE_PLAN.md §9.5). No photos here: each is fetched, and audited, on its own. */
export const GET = withStandardHandler(async (req, session) => {
    const access = await faceCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    return ApiResponse.success(await FaceReviewService.open(access.companyId, session.user.role === "SUPER_ADMIN" ? null : session.user.id))
})
