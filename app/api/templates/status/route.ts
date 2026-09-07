export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { getTemplateMeta } from "@/lib/storage"

// Whether a base template exists for each locale, and when it was last
// uploaded — powers the Manage Templates modal's status display. Super-
// Admin-only, same as everything else about managing these base files.
export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return ApiResponse.unauthorized("Only Super Admins can view template status")
    }

    const [en, ar] = await Promise.all([
        getTemplateMeta('en'),
        getTemplateMeta('ar'),
    ])

    return ApiResponse.success({ en, ar })
})
