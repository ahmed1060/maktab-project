import { ApiResponse } from "@/lib/api-response"
import { NoteService } from "@/lib/services/note.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

// GET, not POST: Vercel Cron always dispatches with GET. Admins can still
// trigger this manually (via session auth) by visiting/fetching the same URL.
export async function GET(req: Request) {
    let userId: string | null = null
    let superAdminId: string | null = null
    try {
        // Support both Session (Manual) and Cron Secret (Automated)
        const isCron = isValidCronRequest(req)

        const session = await getServerSession(authOptions)
        const role = session && (session.user as any).role
        const isAdmin = session && ['ADMIN', 'SUPER_ADMIN'].includes(role)
        if (role === 'SUPER_ADMIN') superAdminId = (session!.user as any).id
        else if (role === 'ADMIN') userId = (session!.user as any).id

        if (!isCron && !isAdmin) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await NoteService.checkExpiries()
        return ApiResponse.success(result)
    } catch (error: any) {
        if (isNextInternalError(error)) throw error
        console.error('Check expiry failed:', error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/notes/check-expiry', method: 'GET', userId, superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref), 500)
    }
}
