import { ApiResponse } from "@/lib/api-response"
import { RecordService } from "@/lib/services/record.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"

// GET, not POST: Vercel Cron always dispatches with GET. A Super Admin can
// still trigger it by hand (via session auth) at the same URL. Not a company
// Admin: the job runs over every company's records, which is not one company's
// call to make.
export async function GET(req: Request) {
    let superAdminId: string | null = null
    try {
        // Support both Session (Manual) and Cron Secret (Automated)
        const isCron = isValidCronRequest(req)

        const session = await getServerSession(authOptions)
        const role = session && (session.user as any).role
        const isSuperAdmin = role === 'SUPER_ADMIN'
        if (isSuperAdmin) superAdminId = (session!.user as any).id

        if (!isCron && !isSuperAdmin) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await JobHeartbeatService.run("check-expiry", () => RecordService.checkExpiries())
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Check expiry failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/records/check-expiry', method: 'GET', userId: null, superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
