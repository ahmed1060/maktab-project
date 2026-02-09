import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { NotificationService } from "@/lib/services/notification.service"

export const GET = withStandardHandler(async (req, session) => {
    try {
        const result = await NotificationService.getByUser(session.user.id)
        return ApiResponse.success(result)
    } catch (error: any) {
        throw error
    }
})

export const PATCH = withStandardHandler(async (req, session) => {
    try {
        await NotificationService.markAllAsRead(session.user.id)
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        throw error
    }
})
