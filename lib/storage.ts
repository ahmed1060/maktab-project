import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
    console.warn("⚠️ Supabase credentials missing. Cloud storage will fail.")
}

export const supabase = (supabaseUrl && supabaseServiceKey)
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null as any

/**
 * Uploads a file to Supabase Storage in the 'app-assets' bucket.
 * @param file The file object to upload
 * @param folder The subfolder within the bucket (e.g. 'avatars', 'tasks')
 * @returns The public URL of the uploaded file
 */
export async function uploadToCloud(file: File, folder: string) {
    if (!supabase) {
        throw new Error("Supabase client not initialized. Check your environment variables (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).")
    }

    // 1. Create a unique filename
    const fileExt = file.name.split('.').pop()
    const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

    // 2. Convert File to ArrayBuffer for Supabase upload
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 3. Upload to the 'app-assets' bucket
    const { error } = await supabase.storage
        .from('app-assets')
        .upload(fileName, buffer, {
            contentType: file.type,
            cacheControl: '3600',
            upsert: false
        })

    if (error) {
        console.error('Supabase upload error:', error)
        throw error
    }

    // 4. Get the Public URL
    const { data: { publicUrl } } = supabase.storage
        .from('app-assets')
        .getPublicUrl(fileName)

    return publicUrl
}

/**
 * Specifically for system templates. Uses fixed names and enables upsert (overwrite).
 */
export async function uploadTemplateToCloud(file: File, locale: string) {
    if (!supabase) {
        throw new Error("Supabase client not initialized.")
    }

    const fileName = `templates/template_${locale}.xlsx`
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    const { error } = await supabase.storage
        .from('app-assets')
        .upload(fileName, buffer, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            cacheControl: '0', // No cache for templates so changes are immediate
            upsert: true
        })

    if (error) {
        console.error('Supabase template upload error:', error)
        throw error
    }

    const { data: { publicUrl } } = supabase.storage
        .from('app-assets')
        .getPublicUrl(fileName)

    return publicUrl
}

export function getTemplateUrl(locale: string) {
    if (!supabase) return null
    const fileName = `templates/template_${locale}.xlsx`
    const { data: { publicUrl } } = supabase.storage
        .from('app-assets')
        .getPublicUrl(fileName)
    return publicUrl
}
