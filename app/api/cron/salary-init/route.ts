import { ApiResponse } from "@/lib/api-response"
import { CronService } from "@/lib/services/cron.service"
import { isValidCronRequest } from "@/lib/cron-auth"

export async function POST(req: Request) {
    try {
        if (!isValidCronRequest(req)) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await CronService.initializeSalaries()
        return ApiResponse.success(result)
    } catch (error: any) {
        console.error('Salary initialization failed:', error)
        return ApiResponse.error("Internal Server Error", 500)
    }
}
