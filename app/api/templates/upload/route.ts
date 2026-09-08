import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { uploadTemplateToCloud } from "@/lib/storage"

export const POST = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        // 403, not 401 — see the matching comment in /api/templates/status.
        // Pre-existing bug, not introduced by the two routes above; fixed
        // here too since it's the same class of issue.
        return ApiResponse.forbidden("Only Super Admins can upload templates")
    }

    try {
        const formData = await req.formData()
        const file = formData.get('file') as File
        const locale = formData.get('locale') as string // 'en' or 'ar'

        if (!file) {
            return ApiResponse.badRequest("No file provided")
        }

        const publicUrl = await uploadTemplateToCloud(file, locale)

        return ApiResponse.success({
            message: `Template for ${locale} uploaded successfully`,
            url: publicUrl
        })
    } catch (error: any) {
        throw error
    }
})
