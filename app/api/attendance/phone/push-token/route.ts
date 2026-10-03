import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { mobileSelf } from "@/lib/attendance/mobile-access"

const schema = z.object({
    keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    token: z.string().min(1).max(4096),
})

/**
 * Where to push to this person's phone (ATTENDANCE_PLAN.md §13.4): the app
 * sends the token its push service gave it, for the phone it is running on —
 * their phone in use or the one waiting for approval. Any other phone answers
 * 404: pushes go only where the person checks in.
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = await mobileSelf(session)
    if ("denied" in self) return self.denied
    const { count } = await prisma.checkInPhone.updateMany({
        where: { userId: self.userId, keyFingerprint: validation.data.keyFingerprint, status: { in: ["ACTIVE", "PENDING"] } },
        data: { pushToken: validation.data.token, pushTokenAt: new Date() },
    })
    if (count === 0) return ApiResponse.notFound("Phone not found.")
    return ApiResponse.success({ saved: true })
})
