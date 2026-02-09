import { ApiResponse } from "@/lib/api-response"
import { NoteService } from "@/lib/services/note.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function POST(req: Request) {
    try {
        // Support both Session (Manual) and Cron Secret (Automated)
        const authHeader = req.headers.get('Authorization')
        const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`

        const session = await getServerSession(authOptions)
        const isAdmin = session && ['ADMIN', 'SUPER_ADMIN'].includes((session.user as any).role)

        if (!isCron && !isAdmin) {
            return ApiResponse.unauthorized("Unauthorized")
        }

        const result = await NoteService.checkExpiries()
        return ApiResponse.success(result)
    } catch (error: any) {
        console.error('Check expiry failed:', error)
        return ApiResponse.error("Failed to check expiry", 500)
    }
}
