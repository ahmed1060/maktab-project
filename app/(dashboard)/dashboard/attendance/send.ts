import { apiErrorText } from '@/lib/api-error-text'

/** A write to the attendance API: the body's data, or the error to show. */
export async function send(url: string, init: RequestInit, fallback: string): Promise<{ ok: true; body: any } | { ok: false; error: string; code?: string }> {
    const res = await fetch(url, init)
    const text = await res.text()
    if (!res.ok) return { ok: false, error: apiErrorText(text, fallback), code: codeOf(text) }
    try { return { ok: true, body: JSON.parse(text)?.data } } catch { return { ok: true, body: null } }
}

export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** The refusal's code, when the server gave one (lib/api-utils.ts): what the app decides on, not the words. */
function codeOf(text: string): string | undefined {
    try {
        const code = JSON.parse(text)?.code
        return typeof code === 'string' ? code : undefined
    } catch { return undefined }
}
