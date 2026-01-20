import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getTemplateUrl } from "@/lib/storage"
import fs from "fs" // Keep for fallback if needed
import path from "path"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const locale = searchParams.get('locale') || 'en'

    // 1. Try to get from cloud first
    const cloudUrl = getTemplateUrl(locale)
    if (cloudUrl) {
        console.log("[TEMPLATE_DOWNLOAD] Redirecting to cloud:", cloudUrl)
        return NextResponse.redirect(cloudUrl)
    }

    // 2. Fallback to local (for local development or if cloud fails)
    const fileName = locale === 'ar' ? 'template_ar.xlsx' : 'template_en.xlsx'
    const filePath = path.join(process.cwd(), 'public', 'templates', fileName)

    console.log("[TEMPLATE_DOWNLOAD] Fallback to local path:", filePath)

    if (fs.existsSync(filePath)) {
        const fileBuffer = fs.readFileSync(filePath)
        return new NextResponse(fileBuffer, {
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename=${fileName}`,
            },
        })
    }

    return new NextResponse(JSON.stringify({ message: "Template file not found" }), { status: 404 })
}
