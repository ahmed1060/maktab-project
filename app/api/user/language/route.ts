import { withStandardHandler } from '@/lib/api-utils'
import { ApiResponse } from '@/lib/api-response'
import { UserService } from '@/lib/services/user.service'
import { prisma } from '@/lib/prisma'

export const POST = withStandardHandler(async (req, session, json) => {
    const { language } = json
    if (!language || !['en', 'ar'].includes(language)) {
        return ApiResponse.badRequest("Invalid language")
    }

    try {
        const userId = session.user.id
        const role = session.user.role

        if (role === 'SUPER_ADMIN') {
            await prisma.superAdmin.update({
                where: { id: userId },
                data: { language }
            })
        } else {
            await UserService.updateLanguage(userId, language)
        }

        return ApiResponse.success({ success: true })
    } catch (error: any) {
        throw error
    }
})
