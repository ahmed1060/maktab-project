import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SystemService } from "@/lib/services/system.service"

export const GET = withStandardHandler(
    async () => {
        try {
            const metrics = await SystemService.getHealthMetrics()
            return ApiResponse.success(metrics)
        } catch (error) {
            console.error("[HEALTH_API_ERROR]", error)
            return ApiResponse.error("Failed to fetch system metrics")
        }
    },
    {
        allowedRoles: ['SUPER_ADMIN']
    }
)
