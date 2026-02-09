import { ApiResponse } from "@/lib/api-response"
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
            return ApiResponse.badRequest("No files provided")
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
                return ApiResponse.badRequest(`File ${file.name} exceeds 4MB limit`)
            }

            // 2. Validate Extension
            const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase()
            if (!allowedExtensions.includes(ext)) {
                return ApiResponse.badRequest(`Invalid file type for ${file.name}. Only Images, PDFs, and Office documents are allowed.`)
            }

            // 3. Upload to Supabase via helper
            const publicUrl = await uploadToCloud(file, folder)
            publicUrls.push(publicUrl)
        }

        return ApiResponse.success({
            url: publicUrls[0],
            urls: publicUrls
        })
    } catch (error: any) {
        console.error('Upload route error:', error)
        return ApiResponse.error(error.message || 'Failed to upload file to cloud storage')
    }
}
