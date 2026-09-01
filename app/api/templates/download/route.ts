export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { getTemplateUrl } from "@/lib/storage"
import { NextResponse } from "next/server"

export const GET = withStandardHandler(async (req) => {
    const { searchParams } = new URL(req.url)
    const locale = searchParams.get('locale') || 'en'

    const cloudUrl = getTemplateUrl(locale)
    if (cloudUrl) {
        return NextResponse.redirect(cloudUrl)
    }

    // F-21: no local-filesystem fallback — Vercel's filesystem is read-only
    // and per-invocation, and `public/templates/` doesn't exist in the repo
    // (storage moved to Supabase), so the old fs.readFileSync fallback here
    // could only ever return a 404 anyway, while still pulling `fs`/`path`
    // into the serverless bundle for no reason.
    return ApiResponse.notFound("Template file not found")
})
