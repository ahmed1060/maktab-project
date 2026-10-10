import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { z } from "zod"
import { FacePhotoKeyService } from "@/lib/services/face-photo-key.service"

// Where the last run stopped, to read on from (review on #33). Nothing: from the start.
const body = z.object({
    from: z.object({ table: z.enum(["review", "frame"]), after: z.string().min(1).max(100) }).nullable().optional(),
}).nullable().optional()

/**
 * Rotating FACE_PHOTO_KEY (mobile/README.md, "Rotating FACE_PHOTO_KEY"):
 * where it stands, and re-encrypting the stored face photos with the new key.
 * Super Admins only.
 */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success(await FacePhotoKeyService.status())
})

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const parsed = body.safeParse(json)
    if (!parsed.success) return ApiResponse.badRequest("Validation Error")
    return ApiResponse.success(await FacePhotoKeyService.rekey(session, parsed.data?.from ?? null))
}, {
    // Its own counter: the service audits, so there is no audit action to name it by (review on #33).
    rateLimit: { maxRequests: 30, windowMs: 60 * 60 * 1000, key: "REKEY_FACE_PHOTOS" },
})
