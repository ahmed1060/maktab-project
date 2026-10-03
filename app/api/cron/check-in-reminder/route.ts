import { ApiResponse } from "@/lib/api-response"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { CheckInReminderService } from "@/lib/services/check-in-reminder.service"
import { isNextInternalError } from "@/lib/next-internal-error"
import { JobHeartbeatService } from "@/lib/services/job-heartbeat.service"

// "You haven't checked in" reminders, and the push outbox (ATTENDANCE_PLAN.md
// §13.4). Every five minutes, from .github/workflows/check-in-reminder.yml:
// Vercel's Hobby plan runs crons at most daily, and a reminder needs minutes.
// Each run sends what is due; a reminder goes once per person and day
// however often this runs.
//
// GET, with CRON_SECRET, like every scheduled job. A Super Admin can trigger
// it by hand at the same URL.
export async function GET(req: Request) {
    let superAdminId: string | null = null
    try {
        const isCron = isValidCronRequest(req)
        const session = await getServerSession(authOptions)
        const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'
        if (isSuperAdmin) superAdminId = session!.user.id
        if (!isCron && !isSuperAdmin) return ApiResponse.unauthorized("Unauthorized")

        const result = await JobHeartbeatService.run("check-in-reminder", () => CheckInReminderService.run())
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Check-in reminder cron failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/cron/check-in-reminder', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
