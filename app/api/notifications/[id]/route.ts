import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { NotificationService } from "@/lib/services/notification.service"

/**
 * Read one notification of the person's own: the bell's panel, when it's
 * followed (DESIGN.md §5.1). One to deal with now stays unread until it's
 * dealt with, and someone else's is left as it is.
 */
export const PATCH = withStandardHandler(async (_req, session, _json, context) => {
    await NotificationService.markAsRead(session.user.id, context.params.id)
    return ApiResponse.success({ success: true })
})
