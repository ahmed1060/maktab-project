import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import fs from "fs"
import path from "path"

export async function GET(req: Request) {
    const session = await getServerSession(authOptions)
    if (!session) {
        return new NextResponse("Unauthorized", { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const locale = searchParams.get('locale') || 'en'
    const fileName = locale === 'ar' ? 'template_ar.xlsx' : 'template_en.xlsx'
    const filePath = path.join(process.cwd(), 'public', 'templates', fileName)

    console.log("[TEMPLATE_DOWNLOAD] path:", filePath)

    if (!fs.existsSync(filePath)) {
        return new NextResponse(JSON.stringify({ message: "Template file not found" }), { status: 404 })
    }

    const fileBuffer = fs.readFileSync(filePath)

    return new NextResponse(fileBuffer, {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename=${fileName}`,
        },
    })
}
