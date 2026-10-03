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
