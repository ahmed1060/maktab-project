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

        // Two passes, in this order, sharing the one daily run.
        //
        // checkSubscriptions is the advance warning — the 14/3/1 reminder
        // ladder, sent while there is still time to act. checkSubscriptionLifecycle
        // is what happens when there was not: grace beginning, grace ending,
        // and lockout.
        //
        // The lifecycle pass used to live in CronService.dailyCheck(), which
        // nothing has ever called — so it had never run, and would not have run
        // on the day it was first due. It belongs here, which is what its own
        // comment in that function said: share the daily pass rather than take
        // a cron of its own.
        const result = await CompanyService.checkSubscriptions()
        const lifecycle = await CompanyService.checkSubscriptionLifecycle()
        return ApiResponse.success({
            success: true,
            ...result,
            lifecycle,
            checkedAt: new Date().toISOString()
        })
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Subscription check failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/companies/check-subscriptions', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}
