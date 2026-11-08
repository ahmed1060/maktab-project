'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { SignInWait, type WaitKind } from '@/components/SignInWait'
import { useLanguage } from '@/context/LanguageContext'
import { sessionEnded } from '@/lib/session-ended'

export type Hold = { kind: WaitKind; until: number }

/**
 * What the server answered, above a step's primary button (DESIGN.md §5.5,
 * Sign-in), and heard by screen readers: an account held back after wrong
 * tries, or Forgot your password after too many, counted down in even-width
 * digits, in place of anything else; a refusal; or a line of news, such as
 * the hold being over. And, until anything is sent, that the server signed
 * the browser out, when it did.
 */
export function SignInMessage({ hold, error, notice, onHoldOver, untouched = false }: {
    hold: Hold | null
    error: string
    notice: string
    onHoldOver: () => void
    /** Nothing sent yet: whether a session that ended may still be said. */
    untouched?: boolean
}) {
    if (hold) return <p className="ui-error ui-num" role="alert"><SignInWait kind={hold.kind} until={hold.until} onOver={onHoldOver} /></p>
    if (error) return <p className="ui-error" role="alert">{error}</p>
    if (notice) return <p className="ui-hint" role="status">{notice}</p>
    // Read from the address behind its own Suspense, so the sign-in card is
    // still in the first HTML (next/navigation's useSearchParams).
    if (untouched) return <Suspense fallback={null}><SessionEndedNote /></Suspense>
    return null
}

/** A browser the server signed out is told its session ended (DESIGN.md §5.5, Sign-in). */
function SessionEndedNote() {
    const { t } = useLanguage()
    return sessionEnded(useSearchParams()) ? <p className="ui-hint" role="status">{t('sign_in_session_ended')}</p> : null
}
