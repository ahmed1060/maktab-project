import { NextResponse } from "next/server"
import { uploadToCloud } from "@/lib/storage"

export async function POST(req: Request) {
    try {
        const data = await req.formData()
        const file: File | null = data.get('file') as unknown as File
        const folder = (data.get('folder') as string) || 'misc'

        if (!file) {
            return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 })
        }

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
        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()

        if (!allowedExtensions.includes(ext)) {
            return NextResponse.json({
                success: false,
                error: 'Invalid file type. Only Images, PDFs, and Office documents are allowed.'
            }, { status: 400 })
        }

        // 3. Upload to Supabase via helper
        const publicUrl = await uploadToCloud(file, folder)

        return NextResponse.json({ success: true, url: publicUrl })
    } catch (error: any) {
        console.error('Upload route error:', error)
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to upload file to cloud storage'
        }, { status: 500 })
    }
}
