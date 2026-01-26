import { NextResponse } from "next/server"
import { uploadToCloud } from "@/lib/storage"

export async function POST(req: Request) {
    try {
        const data = await req.formData()
        const folder = (data.get('folder') as string) || 'misc'

        // Handle both 'files' (plural) and 'file' (singular) keys
        const files: File[] = []

        // Check for multiple files
        const pluralFiles = data.getAll('files') as unknown as File[]
        if (pluralFiles && pluralFiles.length > 0) {
            files.push(...pluralFiles)
        }

        // Check for single file
        const singularFile = data.get('file') as unknown as File
        if (singularFile && singularFile instanceof File) {
            files.push(singularFile)
        }



        if (files.length === 0) {
            return NextResponse.json({ success: false, error: 'No files provided' }, { status: 400 })
        }

        const MAX_SIZE = 4 * 1024 * 1024 // 4MB
        const allowedExtensions = [
            '.jpg', '.jpeg', '.png', '.gif', '.webp', // Images
            '.pdf', // Documents
            '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx' // Office
        ]

        const publicUrls: string[] = []

        for (const file of files) {
            // 1. Validate Size
            if (file.size > MAX_SIZE) {
                return NextResponse.json({ success: false, error: `File ${file.name} exceeds 4MB limit` }, { status: 400 })
            }

            // 2. Validate Extension
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
            if (!allowedExtensions.includes(ext)) {
                return NextResponse.json({
                    success: false,
                    error: `Invalid file type for ${file.name}. Only Images, PDFs, and Office documents are allowed.`
                }, { status: 400 })
            }

            // 3. Upload to Supabase via helper
            const publicUrl = await uploadToCloud(file, folder)
            publicUrls.push(publicUrl)
        }

        // Return single url for legacy single-file components, and urls array for multi-file components
        return NextResponse.json({
            success: true,
            url: publicUrls[0], // For legacy support
            urls: publicUrls    // For multi-file support
        })
    } catch (error: any) {
        console.error('Upload route error:', error)
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to upload file to cloud storage'
        }, { status: 500 })
    }
}
