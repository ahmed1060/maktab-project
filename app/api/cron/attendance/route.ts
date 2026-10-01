import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { AttendanceEngineService } from "@/lib/services/attendance-engine.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"

// The nightly reconciliation (ATTENDANCE_PLAN.md §11). Every change to an
// input rebuilds what it touched as it happens; this catches what that
// missed — a recompute that failed, a salary or employment change, which do
// not trigger one — and turns each yesterday into a measured day, so an
// absence appears the morning after it, not only when somebody next imports.
//
// This month and last, for every company with punches; a month whose payroll
// is approved is skipped. 22:30 UTC: just past midnight in Cairo in either
// half of the year, so "yesterday" is a whole day there.
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

        const result = await JobHeartbeatService.run("attendance", async () => {
            const companies = await prisma.attendancePunch.findMany({ distinct: ["companyId"], select: { companyId: true } })
            const outcome = await AttendanceEngineService.reconcileAll(companies.map(c => c.companyId))
            // Every company was tried; any that failed turn the job's card red.
            if (outcome.failed.length > 0) throw new Error(`Attendance reconciliation failed for ${outcome.failed.length} month(s): ${outcome.failed.map(f => `${f.companyId} ${f.month} ${f.error}`).join("; ")}`)
            return outcome
        })
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Attendance cron failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/attendance', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
