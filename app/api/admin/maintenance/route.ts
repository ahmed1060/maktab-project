import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MaintenanceService } from '@/lib/services/maintenance.service'
import { ApiResponse } from '@/lib/api-response'
import { AuditLogService } from '@/lib/services/audit-log.service'
import { isNextInternalError } from '@/lib/next-internal-error'
import { z } from 'zod'

const MaintenanceSchema = z.object({
    action: z.enum(['CLEANUP_ASSETS', 'PRUNE_LOGS', 'PRUNE_NOTIFICATIONS']),
    params: z.object({
        retentionDays: z.number().optional()
    }).optional()
})

export async function POST(req: NextRequest) {
    let superAdminId: string | null = null
    try {
        const session = await getServerSession(authOptions)

        if (!session || session.user.role !== 'SUPER_ADMIN') {
            return ApiResponse.error("Unauthorized", 401)
        }
        superAdminId = session.user.id

        const body = await req.json()
        const validated = MaintenanceSchema.safeParse(body)

        if (!validated.success) {
            return ApiResponse.error(validated.error.issues[0].message, 400)
        }

        const { action, params } = validated.data
        let result: any

        switch (action) {
            case 'CLEANUP_ASSETS':
                result = await MaintenanceService.cleanupOrphanedAssets()
                break
            case 'PRUNE_LOGS':
                result = await MaintenanceService.pruneOldLogs(params?.retentionDays || 90)
                break
            case 'PRUNE_NOTIFICATIONS':
                result = await MaintenanceService.pruneOldNotifications(params?.retentionDays || 30)
                break
        }

        return ApiResponse.success({ action, result })
    } catch (error) {
        if (isNextInternalError(error)) throw error
        console.error("[Maintenance API] Error:", error)
        const ref = await AuditLogService.logSystemError({ error, route: '/api/admin/maintenance', method: 'POST', superAdminId })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}
