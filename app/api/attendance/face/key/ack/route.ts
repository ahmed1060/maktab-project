import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceKeyService } from "@/lib/services/face-key.service"

/** The phone deleted its (unreadable) face templates, as asked (ATTENDANCE_PLAN.md §10.4), signed by its key. */
const schema = z.object({
    nonce: z.string().min(20).max(100),
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().min(1).max(256),
})

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role === "SUPER_ADMIN" || !session.user.companyId) return ApiResponse.forbidden()
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    await FaceKeyService.acknowledgeDeletion(session.user.companyId, session.user.id, validation.data)
    return ApiResponse.success({ acknowledged: true })
})
