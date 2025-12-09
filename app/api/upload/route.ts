import { NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import path from "path"

export async function POST(req: Request) {
    const data = await req.formData()
    const file: File | null = data.get('file') as unknown as File

    if (!file) {
        return NextResponse.json({ success: false })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // 1. Validate Size (10MB)
    const MAX_SIZE = 10 * 1024 * 1024 // 10MB
    if (file.size > MAX_SIZE) {
        return NextResponse.json({ success: false, error: 'File size exceeds 10MB limit' }, { status: 400 })
    }

    // 2. Validate Extension
    const allowedExtensions = [
        // Images
        '.jpg', '.jpeg', '.png', '.gif', '.webp',
        // Documents
        '.pdf',
        // Office
        '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'
    ]
    const ext = path.extname(file.name).toLowerCase()

    if (!allowedExtensions.includes(ext)) {
        return NextResponse.json({
            success: false,
            error: 'Invalid file type. Only Images, PDFs, and Office documents are allowed.'
        }, { status: 400 })
    }

    const uploadDir = path.join(process.cwd(), "public/uploads")
    await mkdir(uploadDir, { recursive: true })

    const filename = `${Date.now()}-${file.name}`
    const filepath = path.join(uploadDir, filename)

    await writeFile(filepath, buffer)

    return NextResponse.json({ success: true, url: `/uploads/${filename}` })
}
