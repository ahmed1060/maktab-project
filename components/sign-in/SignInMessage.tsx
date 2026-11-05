'use client'

import { SignInWait, type WaitKind } from '@/components/SignInWait'

export type Hold = { kind: WaitKind; until: number }

/**
 * What the server answered, above a step's primary button (DESIGN.md §5.5,
 * Sign-in), and heard by screen readers: an account held back after wrong
 * tries, or Forgot your password after too many, counted down in even-width
 * digits, in place of anything else; a refusal; or a line of news, such as
 * the hold being over.
 */
export function SignInMessage({ hold, error, notice, onHoldOver }: {
    hold: Hold | null
    error: string
    notice: string
    onHoldOver: () => void
}) {
    if (hold) return <p className="ui-error ui-num" role="alert"><SignInWait kind={hold.kind} until={hold.until} onOver={onHoldOver} /></p>
    if (error) return <p className="ui-error" role="alert">{error}</p>
    if (notice) return <p className="ui-hint" role="status">{notice}</p>
    return null
}
