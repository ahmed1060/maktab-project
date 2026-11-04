'use client'

import { useEffect, useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { waitText } from '@/lib/login-errors'

/**
 * Held back from signing in after wrong tries (lib/sign-in-lock.ts): the 30
 * seconds after five, or the fifteen minutes after ten, counted down as they
 * pass (decided 2026-11-03). The time is a timer, so a screen reader says the
 * sentence once rather than every second. Once it's over, onOver.
 */
export function SignInWait({ kind, until, onOver }: { kind: 'pause' | 'lock'; until: number; onOver: () => void }) {
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

    const [before, after] = t(kind === 'pause' ? 'sign_in_paused_wait' : 'sign_in_locked_wait').split('{time}')
    return (
        <>
            {before}<span role="timer" aria-live="off">{waitText(left, locale)}</span>{after}
        </>
    )
}
