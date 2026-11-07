/**
 * What the check of the code a high-risk action asks for came to
 * (components/StepUpInterceptor.tsx; DESIGN.md §5.5, Dialog).
 */
export type StepUpCheck = 'confirmed' | 'wrong' | 'unchecked'

/**
 * Reads the session update's answer. No session back means the check wasn't
 * made, as when the browser is offline or the server failed: it's never said
 * as a wrong code, which it was (PR 217). A new step-up time means it was
 * confirmed: a new time, not one compared against this browser's clock,
 * which may not agree with the server's.
 */
export function stepUpCheck(session: unknown, previous: number | null): StepUpCheck {
    if (!session) return 'unchecked'
    const at = (session as { user?: { stepUpAt?: number | null } }).user?.stepUpAt
    return at && at !== previous ? 'confirmed' : 'wrong'
}
