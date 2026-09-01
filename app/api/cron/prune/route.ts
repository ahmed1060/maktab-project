import { ApiResponse } from "@/lib/api-response"
import { MaintenanceService } from "@/lib/services/maintenance.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"

// F-18: pruneOldLogs/pruneOldNotifications existed already (used by the
// manual maintenance-page buttons) but nothing scheduled them, so audit
// rows and notifications only ever accumulated. Scheduled here alongside
// the other cron jobs in vercel.json.
//
// GET, not POST: Vercel Cron always dispatches with GET. Admins can still
// trigger this manually (via session auth) by visiting/fetching the same URL.
export async function GET(req: Request) {
    try {
        const isCron = isValidCronRequest(req)

        const session = await getServerSession(authOptions)
        const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

        if (!isCron && !isSuperAdmin) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const [logs, notifications] = await Promise.all([
            MaintenanceService.pruneOldLogs(),
            MaintenanceService.pruneOldNotifications(),
        ])

        return ApiResponse.success({ logs, notifications })
    } catch (error: any) {
        console.error('Prune cron failed:', error)
        return ApiResponse.error("Failed to prune old records", 500)
    }
}
