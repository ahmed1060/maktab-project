import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request) {
    try {
        const session = await getServerSession(authOptions)
        const authHeader = req.headers.get('Authorization')
        const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
        const isSuperAdmin = session?.user?.role === 'SUPER_ADMIN'

        if (!isCron && !isSuperAdmin && process.env.NODE_ENV === 'production') {
            return ApiResponse.unauthorized()
        }

        const result = await CompanyService.checkSubscriptions()
        return ApiResponse.success({
            success: true,
            ...result,
            checkedAt: new Date().toISOString()
        })
    } catch (error: any) {
        console.error('Subscription check failed:', error)
        return ApiResponse.error("Failed to check subscriptions")
    }
}
