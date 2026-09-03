import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

// GET, not POST: Vercel Cron always dispatches with GET.
export async function GET(req: Request) {
    let superAdminId: string | null = null
    try {
        const session = await getServerSession(authOptions)
        const isCron = isValidCronRequest(req)
        const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
        if (isSuperAdmin) superAdminId = session!.user.id

        if (!isCron && !isSuperAdmin && process.env.NODE_ENV === 'production') {
            return ApiResponse.unauthorized()
        }

        const result = await CompanyService.checkSubscriptions()
        return ApiResponse.success({
            success: true,
            ...result,
            checkedAt: new Date().toISOString()
        })
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Subscription check failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/companies/check-subscriptions', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}
