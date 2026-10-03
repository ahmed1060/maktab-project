import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceReviewService, MAX_PHOTO_BYTES } from "@/lib/services/face-review.service"

/**
 * A verification photo from the app (ATTENDANCE_PLAN.md §9.5): signed by the
 * phone's key over its hash, with the phone's attestation. Waits for a person
 * to approve it.
 */
const schema = z.object({
    nonce: z.string().min(20).max(100),
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().min(1).max(500),
    photo: z.string().min(1).max(Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 4),
    modelVersion: z.string().min(1).max(60),
    attestation: z.string().max(20_000).nullish(),
})

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role === "SUPER_ADMIN" || !session.user.companyId) return ApiResponse.forbidden()
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await FaceReviewService.submit(session.user.companyId, session.user.id, validation.data), 201)
})
