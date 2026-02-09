import { ApiResponse } from "@/lib/api-response"
import { CronService } from "@/lib/services/cron.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    const authHeader = req.headers.get('authorization')

    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
    const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

    if (!isCron && !isSuperAdmin) {
        return ApiResponse.unauthorized("Unauthorized")
    }

    try {
        const result = await CronService.resetDayOffCredits()
        return ApiResponse.success(result)
    } catch (error: any) {
        console.error('Error in cron reset-day-off:', error)
        return ApiResponse.error("Reset failed", 500)
    }
}
