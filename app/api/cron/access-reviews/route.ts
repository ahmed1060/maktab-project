import { ApiResponse } from "@/lib/api-response"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"
import { AccessReviewService } from "@/lib/services/access-review.service"

// Opens the periodic access reviews that are due (ROLES_PLAN.md §6.14), for
// the companies whose contract includes them, and schedules the next. Daily.
//
// GET, not POST: Vercel Cron always dispatches with GET. A Super Admin can
// trigger it by hand at the same URL.
export async function GET(req: Request) {
    let superAdminId: string | null = null
    try {
        const isCron = isValidCronRequest(req)
        const session = await getServerSession(authOptions)
        const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
        if (isSuperAdmin) superAdminId = session!.user.id
        if (!isCron && !isSuperAdmin) return ApiResponse.unauthorized("Unauthorized")

        const result = await JobHeartbeatService.run("access-reviews", () => AccessReviewService.runDue())
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Access review cron failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/access-reviews', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
