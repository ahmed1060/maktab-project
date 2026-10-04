import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FacePhotoKeyService } from "@/lib/services/face-photo-key.service"

/**
 * Rotating FACE_PHOTO_KEY (mobile/README.md, "Rotating FACE_PHOTO_KEY"):
 * where it stands, and re-encrypting the stored face photos with the new key.
 * Super Admins only.
 */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success(await FacePhotoKeyService.status())
})

export const POST = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success(await FacePhotoKeyService.rekey(session))
}, {
    rateLimit: { maxRequests: 10, windowMs: 60 * 60 * 1000 },
})
