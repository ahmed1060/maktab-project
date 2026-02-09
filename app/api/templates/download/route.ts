import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { getTemplateUrl } from "@/lib/storage"
import fs from "fs"
import path from "path"
import { NextResponse } from "next/server"

export const GET = withStandardHandler(async (req) => {
    const { searchParams } = new URL(req.url)
    const locale = searchParams.get('locale') || 'en'

    // 1. Try to get from cloud first
    const cloudUrl = getTemplateUrl(locale)
    if (cloudUrl) {
        return NextResponse.redirect(cloudUrl)
    }

    // 2. Fallback to local
    const fileName = locale === 'ar' ? 'template_ar.xlsx' : 'template_en.xlsx'
    const filePath = path.join(process.cwd(), 'public', 'templates', fileName)

    if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath)
        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename=${fileName}`,
            },
        })
    }

    return ApiResponse.notFound("Template file not found")
})
