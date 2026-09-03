import { ApiResponse } from "@/lib/api-response"
import { CronService } from "@/lib/services/cron.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)

    const isCron = isValidCronRequest(req)
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    if (!isCron && !isSuperAdmin) {
        return ApiResponse.unauthorized("Unauthorized")
    }

    try {
        const result = await CronService.resetDayOffCredits()
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Error in cron reset-day-off:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/reset-day-off', method: 'GET', superAdminId: isSuperAdmin ? session!.user.id : null })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
