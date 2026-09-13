import { withStandardHandler } from '@/lib/api-utils'
import { ApiResponse } from '@/lib/api-response'
import { prisma } from '@/lib/prisma'
import { isTheme } from '@/lib/theme'

/**
 * Persists the theme to the account, so it follows the person to another
 * browser. The cookie is what the server reads on each request; this is what
 * restores that cookie after a sign-in somewhere new.
 *
 * Mirrors /api/user/language exactly, including the Super Admin branch — their
 * accounts live in a separate table.
 */
export const POST = withStandardHandler(async (req, session, json) => {
    const { theme } = json
    if (!isTheme(theme)) {
        return ApiResponse.badRequest("Invalid theme")
    }

    const userId = session.user.id

    if (session.user.role === 'SUPER_ADMIN') {
        await prisma.superAdmin.update({ where: { id: userId }, data: { theme } })
    } else {
        await prisma.user.update({ where: { id: userId }, data: { theme } })
    }

    return ApiResponse.success({ theme })
})
