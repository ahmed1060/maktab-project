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

    const uploadDir = path.join(process.cwd(), "public/uploads")
    await mkdir(uploadDir, { recursive: true })

    const filename = `${Date.now()}-${file.name}`
    const filepath = path.join(uploadDir, filename)

    await writeFile(filepath, buffer)

    return NextResponse.json({ success: true, url: `/uploads/${filename}` })
}
