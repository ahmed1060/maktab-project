import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceVerificationService } from "@/lib/services/face-verification.service"

/**
 * Face verification for the whole system (ATTENDANCE_PLAN.md §10.4). Every
 * Super Admin sees where it stands; only the protected one changes it, with a
 * fresh authenticator code.
 */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success({ state: await FaceVerificationService.systemState(), canChange: !!session.user.isProtected })
})

const schema = z.object({ state: z.enum(["ON", "PAUSED"]) })

export const PUT = withStandardHandler(async (_req, session, json) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await FaceVerificationService.setSystemState(session, validation.data.state))
})
