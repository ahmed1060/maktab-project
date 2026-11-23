/**
 * The message to show for a refused request, from the response's text.
 *
 * Five screens showed the text as it came: the whole JSON body,
 * `{"success":false,"error":"You already have a leave request for that day."}`,
 * in the alert. The API answers `{ success: false, error }`, so the message is
 * `error`. Anything else (an empty body, an HTML error page, JSON without a
 * message) shows the screen's own fallback.
 */
export function apiErrorText(text: string, fallback: string): string {
    const raw = text.trim()
    if (!raw) return fallback
    try {
        const body = JSON.parse(raw)
        const message = body?.error ?? body?.message
        return typeof message === 'string' && message.trim() ? message : fallback
    } catch {
        return raw.startsWith('<') ? fallback : raw
    }
}

/**
 * The refusal the server gave, with every reason it gave: a grant refused names
 * each in `details.errors`. Here since PR 392, beside the message above: it
 * lived in the Super Admin's roles card, and every screen borrowing it from
 * there reached the card and its calls.
 */
export async function refusalOf(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => ({}))
    const reasons: string[] = body?.details?.errors ?? []
    return [body?.error || fallback, ...reasons].join(' — ')
}
