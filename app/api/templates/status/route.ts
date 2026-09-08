export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { getTemplateMeta } from "@/lib/storage"

// Whether a base template exists for each locale, and when it was last
// uploaded — powers the Manage Templates modal's status display. Super-
// Admin-only, same as everything else about managing these base files.
export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        // 403, not 401 — the caller is authenticated, just the wrong role.
        // A 401 here would trip AuthInterceptor.tsx's global "force sign out
        // on any non-NextAuth 401" and eject an otherwise-valid session.
        return ApiResponse.forbidden("Only Super Admins can view template status")
    }

    const [en, ar] = await Promise.all([
        getTemplateMeta('en'),
        getTemplateMeta('ar'),
    ])

    return ApiResponse.success({ en, ar })
})
