import { after } from "next/server"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { NotificationService } from "@/lib/services/notification.service"
import { TerminalAlerts } from "@/lib/services/attendance-terminal-alerts"

/**
 * When each scope's terminals were last checked by this server instance: a
 * company's every minute at most, however many of its people's bells ask;
 * every company's, for the Super Admin, every five. The check is safe to run
 * twice (it locks what it raises), so this only spares the database.
 */
const lastChecked = new Map<string, number>()
function due(key: string, everyMs: number, now = Date.now()) {
    if (now - (lastChecked.get(key) ?? 0) < everyMs) return false
    lastChecked.set(key, now)
    return true
}

export const GET = withStandardHandler(async (req, session) => {
    try {
        // Silent attendance terminals are noticed when someone looks
        // (lib/services/attendance-terminal-alerts.ts): after this answer has
        // gone, so the bell never waits on it, and what it raises is in the
        // bell's next answer.
        const scope = session.user.role === "SUPER_ADMIN" ? "ALL" : session.user.companyId ? { companyId: session.user.companyId } : null
        if (scope && due(scope === "ALL" ? "ALL" : scope.companyId, scope === "ALL" ? 300_000 : 60_000)) {
            after(() => TerminalAlerts.check(scope).catch(e => console.error("Terminal alerts check failed", e)))
        }
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
