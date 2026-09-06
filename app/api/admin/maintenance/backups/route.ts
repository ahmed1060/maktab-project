import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { GDriveService } from "@/lib/services/gdrive.service"

/**
 * Lists available backups from Google Drive for the System Health page's
 * restore picker. Read-only — calls Drive's API directly rather than
 * shelling out to rclone, which isn't available in a Vercel function.
 */
export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    try {
        const backups = await GDriveService.listBackups()
        return ApiResponse.success({ backups })
    } catch (error: any) {
        if (error.message === 'GDRIVE_NOT_CONFIGURED') {
            return ApiResponse.error("Google Drive credentials aren't set up on Vercel yet", 500)
        }
        if (error.message === 'GDRIVE_AUTH_FAILED' || error.message === 'GDRIVE_LIST_FAILED') {
            return ApiResponse.error("Couldn't reach Google Drive to list backups", 502)
        }
        throw error
    }
}, {
    rateLimit: { maxRequests: 20, windowMs: 60_000 },
})
