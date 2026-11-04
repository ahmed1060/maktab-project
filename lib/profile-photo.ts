import { apiErrorText } from '@/lib/api-error-text'

/**
 * A person's photo (DESIGN.md §5.5, A person's photo): what can be picked,
 * and saving it. The upload route takes these images (app/api/upload/route.ts),
 * so a photo it would refuse, such as a HEIC, is said before it's sent.
 */

/** The upload route's image kinds. */
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp'

/** The largest file the upload route takes. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024

/** What's wrong with a picked file, as a translation key, or null. */
export function photoProblem(file: { name: string; size: number }): 'profile_photo_wrong_type' | 'profile_photo_too_large' | null {
    const dot = file.name.lastIndexOf('.')
    const ext = dot < 0 ? '' : file.name.slice(dot).toLowerCase()
    if (!PHOTO_ACCEPT.split(',').includes(ext)) return 'profile_photo_wrong_type'
    if (file.size > PHOTO_MAX_BYTES) return 'profile_photo_too_large'
    return null
}

const json = { 'Content-Type': 'application/json' }

/**
 * Uploads the photo, then makes it theirs. It's theirs only once both are
 * done: a refused save hands back what was wrong, and the photo they had
 * stays. Each is sent once, as a save is (DESIGN.md §5.5).
 */
export async function savePhoto(userId: string, file: File, fallback: string): Promise<{ url: string } | { error: string }> {
    try {
        const form = new FormData()
        form.append('file', file)
        form.append('folder', 'avatars')
        const uploaded = await fetch('/api/upload', { method: 'POST', body: form })
        const text = await uploaded.text()
        if (!uploaded.ok) return { error: apiErrorText(text, fallback) }
        let url: unknown
        try { url = JSON.parse(text)?.data?.url } catch { /* no address: said below */ }
        if (typeof url !== 'string' || !url) return { error: fallback }
        const saved = await fetch('/api/users', { method: 'PUT', body: JSON.stringify({ id: userId, avatar: url }), headers: json })
        if (!saved.ok) return { error: apiErrorText(await saved.text(), fallback) }
        return { url }
    } catch {
        return { error: fallback }
    }
}

/** Takes their photo away, which is done only once it's saved. */
export async function removePhoto(userId: string, fallback: string): Promise<{ ok: true } | { error: string }> {
    try {
        const res = await fetch('/api/users', { method: 'PUT', body: JSON.stringify({ id: userId, avatar: null }), headers: json })
        return res.ok ? { ok: true } : { error: apiErrorText(await res.text(), fallback) }
    } catch {
        return { error: fallback }
    }
}
