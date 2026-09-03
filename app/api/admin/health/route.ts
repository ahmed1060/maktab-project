export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MaintenanceService } from '@/lib/services/maintenance.service'
import { ApiResponse } from '@/lib/api-response'
import { AuditLogService } from '@/lib/services/audit-log.service'
import { isNextInternalError } from '@/lib/next-internal-error'

export async function GET() {
    let superAdminId: string | null = null
    try {
        const session = await getServerSession(authOptions)

        if (!session || session.user.role !== 'SUPER_ADMIN') {
            return ApiResponse.error("Unauthorized", 401)
        }
        superAdminId = session.user.id

        const stats = await MaintenanceService.getStats()
        return ApiResponse.success(stats)
    } catch (error) {
        if (isNextInternalError(error)) throw error
        console.error("[Health API] Error:", error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/admin/health', method: 'GET', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}
