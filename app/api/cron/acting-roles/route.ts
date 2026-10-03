import { ApiResponse } from "@/lib/api-response"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"
import { RoleAssignmentService } from "@/lib/services/role-assignment.service"

// Returns people whose acting role has ended to the role they had (ROLES_PLAN.md
// §6.13). 22:00 UTC, just past midnight in Cairo — the same boundary as the
// employment job, so somebody is back on their own role from the start of the
// date chosen. A return the rules would refuse is held and the company told.
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

        const result = await JobHeartbeatService.run("acting-roles", () => RoleAssignmentService.endActing())
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Acting role cron failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/acting-roles', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
