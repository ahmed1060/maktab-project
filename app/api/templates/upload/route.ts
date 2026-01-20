import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { uploadTemplateToCloud } from "@/lib/storage"

export async function POST(req: Request) {
    const session = await getServerSession(authOptions)
    const userRole = (session?.user as any)?.role

    if (!session || userRole !== 'SUPER_ADMIN') {
        return new NextResponse("Unauthorized. Only Super Admins can upload templates.", { status: 401 })
    }

    try {
        const formData = await req.formData()
        const file = formData.get('file') as File
        const locale = formData.get('locale') as string // 'en' or 'ar'

        if (!file) {
            return new NextResponse(JSON.stringify({ message: "No file provided" }), { status: 400 })
        }

        const publicUrl = await uploadTemplateToCloud(file, locale)

        return NextResponse.json({
            success: true,
            message: `Template for ${locale} uploaded successfully`,
            url: publicUrl
        })

    } catch (error: any) {
        console.error("[TEMPLATE_UPLOAD_ERROR]", error)
        return new NextResponse(JSON.stringify({
            message: error.message || "Internal Server Error",
            details: error.stack
        }), { status: 500 })
    }
}
