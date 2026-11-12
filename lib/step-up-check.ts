/**
 * What the check of the code a high-risk action asks for came to
 * (components/StepUpInterceptor.tsx; DESIGN.md §5.5, Dialog).
 */
export type StepUpCheck = 'confirmed' | 'wrong' | 'unchecked' | 'paused'

/**
 * Reads the session update's answer. No session back means the check wasn't
 * made, as when the browser is offline or the server failed: it's never said
 * as a wrong code, which it was (PR 217). A new step-up time means it was
 * confirmed: a new time, not one compared against this browser's clock,
 * which may not agree with the server's. Without one, a wait means the server
 * checked no code, after five in fifteen minutes: that's said too, not that
 * the code was wrong, which it was (PR 267).
 */
export function stepUpCheck(session: unknown, previous: number | null): StepUpCheck {
    if (!session) return 'unchecked'
    const at = (session as { user?: { stepUpAt?: number | null } }).user?.stepUpAt
    if (at && at !== previous) return 'confirmed'
    return stepUpWait(session) ? 'paused' : 'wrong'
}

/** How many seconds until codes are checked again, as the server counted them; null when they are. */
export function stepUpWait(session: unknown): number | null {
    const wait = (session as { user?: { stepUpWait?: number | null } } | null | undefined)?.user?.stepUpWait
    return typeof wait === 'number' && wait > 0 ? wait : null
}
