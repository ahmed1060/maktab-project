import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { NotificationService } from "@/lib/services/notification.service"
import { TerminalAlerts } from "@/lib/services/attendance-terminal-alerts"

export const GET = withStandardHandler(async (req, session) => {
    try {
        // Silent attendance terminals are noticed when someone looks
        // (lib/services/attendance-terminal-alerts.ts). Never at the cost of
        // the bell itself.
        const scope = session.user.role === "SUPER_ADMIN" ? "ALL" : session.user.companyId ? { companyId: session.user.companyId } : null
        if (scope) await TerminalAlerts.check(scope).catch(e => console.error("Terminal alerts check failed", e))
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
