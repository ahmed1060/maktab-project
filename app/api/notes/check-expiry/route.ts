import { ApiResponse } from "@/lib/api-response"
import { NoteService } from "@/lib/services/note.service"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isValidCronRequest } from "@/lib/cron-auth"

// GET, not POST: Vercel Cron always dispatches with GET. Admins can still
// trigger this manually (via session auth) by visiting/fetching the same URL.
export async function GET(req: Request) {
    try {
        // Support both Session (Manual) and Cron Secret (Automated)
        const isCron = isValidCronRequest(req)

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
