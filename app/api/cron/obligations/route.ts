import { ApiResponse } from "@/lib/api-response"
import { ObligationService } from "@/lib/services/obligation.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

/**
 * Advances recurring obligations: closes the one that just came due and opens
 * the next occurrence.
 *
 * New, because this had no trigger at all. It was called from
 * CronService.dailyCheck(), which nothing has ever invoked — so every other job
 * in that function had quietly grown its own route over time and this one never
 * did. A DAILY obligation has therefore never recurred in production.
 *
 * GET, not POST: Vercel Cron always dispatches with GET.
 */
export async function GET(req: Request) {
    let superAdminId: string | null = null
    try {
        const session = await getServerSession(authOptions)
        const isCron = isValidCronRequest(req)
        const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
        if (isSuperAdmin) superAdminId = session!.user.id

        if (!isCron && !isSuperAdmin) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await ObligationService.processRecurrentObligations()
        return ApiResponse.success({ ...result, checkedAt: new Date().toISOString() })
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Recurring obligations cron failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/obligations', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
