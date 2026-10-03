import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceVerificationService } from "@/lib/services/face-verification.service"

/**
 * One's own consent to face verification (ATTENDANCE_PLAN.md §9.5, §10.4):
 * accepted for the text version shown, withdrawn in one tap.
 */
const schema = z.object({ version: z.string().min(1).max(40) })

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role === "SUPER_ADMIN" || !session.user.companyId) return ApiResponse.forbidden()
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    // Only someone it is asked of consents: an acceptance with nothing to accept is meaningless.
    if (!(await FaceVerificationService.statusFor(session.user.id)).required) throw new Error("FACE_NOT_REQUIRED")
    return ApiResponse.success(await FaceVerificationService.acceptConsent(session.user.companyId, session.user.id, validation.data.version), 201)
})

export const DELETE = withStandardHandler(async (_req, session) => {
    if (session.user.role === "SUPER_ADMIN") return ApiResponse.forbidden()
    await FaceVerificationService.withdrawConsent(session.user.id)
    return ApiResponse.success({ withdrawn: true })
})
