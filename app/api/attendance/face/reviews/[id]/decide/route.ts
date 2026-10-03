import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceReviewService } from "@/lib/services/face-review.service"
import { reviewToDecide, reviewer } from "@/lib/attendance/face-access"

/** Approves or rejects a verification photo (ATTENDANCE_PLAN.md §9.5). */
const schema = z.object({ approve: z.boolean(), reason: z.string().max(500).nullish() })

export const POST = withStandardHandler(async (_req, session, json, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await reviewToDecide(session, id)
    if ("denied" in found) return found.denied
    return ApiResponse.success(await FaceReviewService.decide(id, validation.data.approve, validation.data.reason ?? null, reviewer(session)))
})
