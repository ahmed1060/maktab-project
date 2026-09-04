import { ApiResponse } from "@/lib/api-response"
import { CronService } from "@/lib/services/cron.service"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

// GET, not POST: Vercel Cron always dispatches with GET.
export async function GET(req: Request) {
    try {
        if (!isValidCronRequest(req)) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await CronService.initializeSalaries()
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Salary initialization failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/salary-init', method: 'GET' })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
