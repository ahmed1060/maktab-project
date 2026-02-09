import { ApiResponse } from "@/lib/api-response"
import { CronService } from "@/lib/services/cron.service"

export async function POST(req: Request) {
    try {
        const authHeader = req.headers.get('Authorization')
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await CronService.initializeSalaries()
        return ApiResponse.success(result)
    } catch (error: any) {
        console.error('Salary initialization failed:', error)
        return ApiResponse.error("Internal Server Error", 500)
    }
}
