import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"

// F-27, Phase 6: includes the device making this very request — clicking
// "revoke all" while sitting on a trusted device means that browser gets
// asked for a code again next login too, which is the expected meaning
// of "sign these all out," not an oversight.
export const POST = withStandardHandler(async (req, session) => {
    const isSuperAdmin = session.user.role === 'SUPER_ADMIN'

    await prisma.trustedDevice.updateMany({
        where: {
            revokedAt: null,
            userId: isSuperAdmin ? undefined : session.user.id,
            superAdminId: isSuperAdmin ? session.user.id : undefined,
        },
        data: { revokedAt: new Date() },
    })

    return ApiResponse.success({ revoked: true })
})
