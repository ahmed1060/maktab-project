import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { FaceKeyService } from "@/lib/services/face-key.service"

/**
 * Pause and purge face verification (ATTENDANCE_PLAN.md §10.4): the last
 * one's record for every Super Admin, the purge itself for the protected one,
 * typed confirmation and a fresh authenticator code.
 */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    return ApiResponse.success(await FaceKeyService.lastPurge())
})

const schema = z.object({ confirm: z.literal("PURGE") })

export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role !== "SUPER_ADMIN") return ApiResponse.forbidden()
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    return ApiResponse.success(await FaceKeyService.purge(session))
})
