import { ApiResponse } from "@/lib/api-response"
import { EmploymentService } from "@/lib/services/employment.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"

// What makes a future-dated employment event mean anything.
//
// EmploymentService.record only moves User.status when the event is already in
// force, so a contract ending on the 1st of next month leaves the status alone
// today — which is right, and which also means something has to come back and
// apply it when the date arrives. That something is this.
//
// 22:00 UTC, which is just past midnight in Cairo in either half of the year.
// The schedule is deliberately pinned to the local day boundary rather than to
// a convenient hour: an event effective "the 1st" takes effect at the first
// instant of the 1st locally, and running at, say, 04:00 UTC would leave
// somebody whose contract ended able to sign in for the first six hours of a
// day they are no longer employed on.
//
// Already-open sessions close on their own within about ninety seconds: the
// JWT refreshes its status copy every sixty, and UserHeartbeat polls
// /api/user/activity, which does a live read.
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

        if (!isCron && !isSuperAdmin) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await JobHeartbeatService.run("employment", () =>
            EmploymentService.applyDueEvents()
        )

        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Employment cron failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/employment', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
