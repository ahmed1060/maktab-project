import { withStandardHandler } from '@/lib/api-utils'
import { ApiResponse } from '@/lib/api-response'
import { SystemService } from '@/lib/services/system.service'

export const GET = withStandardHandler(async (req, session) => {
    try {
        const result = await SystemService.getBootstrapData(session.user.id, session.user.role)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        throw error
    }
})
