import { apiErrorText } from '@/lib/api-error-text'

/** A write to the attendance API: the body's data, or the error to show. */
export async function send(url: string, init: RequestInit, fallback: string): Promise<{ ok: true; body: any } | { ok: false; error: string }> {
    const res = await fetch(url, init)
    const text = await res.text()
    if (!res.ok) return { ok: false, error: apiErrorText(text, fallback) }
    try { return { ok: true, body: JSON.parse(text)?.data } } catch { return { ok: true, body: null } }
}

export const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
