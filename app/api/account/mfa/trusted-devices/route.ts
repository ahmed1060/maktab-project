import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"

// F-27, Phase 6: lists this account's currently-active trusted devices
// (already-revoked or expired ones aren't meaningful to show or manage,
// so they're excluded rather than shown greyed out).
export const GET = withStandardHandler(async (req, session) => {
    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'

    const devices = await prisma.trustedDevice.findMany({
        where: {
            revokedAt: null,
            expiresAt: { gt: new Date() },
            userId: isSuperAdmin ? undefined : session.user.id,
            superAdminId: isSuperAdmin ? session.user.id : undefined,
        },
        orderBy: { lastUsedAt: 'desc' },
        select: { id: true, label: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    })

    return ApiResponse.success({ devices })
})
