export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { downloadTemplateBuffer } from "@/lib/storage"
import { NextResponse } from "next/server"

// Streams the raw base template exactly as the Super Admin uploaded it —
// no company data baked in, no company needed (unlike /api/templates/
// download, which augments the base file with one company's Users/Vendors
// sheets). Only useful for confirming what's actually currently uploaded,
// which is why it's Super-Admin-only, same as the upload endpoint itself.
export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        // 403, not 401 — see the matching comment in /api/templates/status.
        return ApiResponse.forbidden("Only Super Admins can view the base template")
    }

    const { searchParams } = new URL(req.url)
    const locale = searchParams.get('locale') || 'en'

    const buffer = await downloadTemplateBuffer(locale)
    if (!buffer) {
        return ApiResponse.notFound("No template has been uploaded for this locale yet")
    }

    return new NextResponse(buffer as any, {
        status: 200,
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="base_template_${locale}.xlsx"`
        }
    })
})
