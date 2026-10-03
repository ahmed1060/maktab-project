import { ApiResponse } from "@/lib/api-response"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"
import { RoleRequestService } from "@/lib/services/role-request.service"

// Reminds whoever decides role requests of the ones left waiting for three
// working days (ROLES_PLAN.md §6.12), so a new hire is not left on the default
// role by oversight. Daily; a request is reminded at most once per interval.
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

        const result = await JobHeartbeatService.run("role-requests", () => RoleRequestService.remindStale())
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Role request reminder cron failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/role-requests', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
