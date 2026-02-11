export const dynamic = 'force-dynamic'

import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { MaintenanceService } from '@/lib/services/maintenance.service'
import { ApiResponse } from '@/lib/api-response'

export async function GET() {
    try {
        const session = await getServerSession(authOptions)

        if (!session || session.user.role !== 'SUPER_ADMIN') {
            return ApiResponse.error("Unauthorized", 401)
        }

        const stats = await MaintenanceService.getStats()
        return ApiResponse.success(stats)
    } catch (error) {
        console.error("[Health API] Error:", error)
        return ApiResponse.error("Failed to fetch health metrics")
    }
}
