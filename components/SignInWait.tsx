'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { waitText } from '@/lib/login-errors'
import type { TranslationKey } from '@/lib/translations'

/** What's waited for: signing in after five wrong tries or ten, resetting a password after too many, or the code a high-risk action asks for after five. */
export type WaitKind = 'pause' | 'lock' | 'reset' | 'code'

const SAID: Record<WaitKind, TranslationKey> = {
    pause: 'sign_in_paused_wait',
    lock: 'sign_in_locked_wait',
    reset: 'forgot_wait',
    code: 'step_up_paused_wait',
}

/**
 * Held back from signing in after wrong tries (lib/sign-in-lock.ts): the 30
 * seconds after five, or the fifteen minutes after ten, counted down as they
 * pass (decided 2026-11-03). So is Forgot your password after too many tries
 * (lib/password-reset.ts), and the code a high-risk action asks for after
 * five in fifteen minutes (components/StepUpInterceptor.tsx). The time is a
 * timer, so a screen reader says the sentence once rather than every second.
 * Once it's over, onOver.
 */
export function SignInWait({ kind, until, onOver }: { kind: WaitKind; until: number; onOver: () => void }) {
    const { t, locale } = useLanguage()
    const [now, setNow] = useState(() => Date.now())
    const left = until - now
    const over = left <= 0

    useEffect(() => {
        if (over) return
        const tick = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(tick)
    }, [over])

    useEffect(() => {
        if (over) onOver()
        // Once, when it's over; onOver is the page's and changes every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [over])

    const [before, after] = t(SAID[kind]).split('{time}')
    return (
        <>
            {before}<span role="timer" aria-live="off">{waitText(left, locale)}</span>{after}
        </>
    )
}
