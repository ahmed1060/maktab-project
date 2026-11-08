'use client'

import { useRef, useState } from 'react'
import { LockOpenIcon } from '@phosphor-icons/react/ssr'
import { Button, StatusBadge } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'

/**
 * Somebody locked out of signing in, beside their status in a list of people:
 * until when, in the language's own time, and Unlock (lib/sign-in-lock.ts).
 * Or whose password tries are paused, which Unlock lifts too, said only where
 * they can still sign in (lib/own-password.ts, decided 2026-11-08).
 * The lists say it only to whoever may unlock (app/api/users/route.ts), so
 * the button is always theirs to press. Nothing for somebody who isn't locked.
 */
export function SignInLock({ personId, name, until, paused, onUnlocked }: {
    personId: string
    name: string
    until: string | null | undefined
    paused?: string | null
    onUnlocked: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [busy, setBusy] = useState(false)
    const here = useRef<HTMLDivElement>(null)
    const lockedOut = !!until
    const at = until || paused
    if (!at) return null

    const time = new Date(at).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
    const unlock = async () => {
        setBusy(true)
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(personId)}/unlock-sign-in`, { method: 'POST' })
            if (!res.ok) return showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
            showToast(t(lockedOut ? 'sign_in_unlocked' : 'own_password_unlocked').replace('{name}', name), 'success')
            // Unlock goes once it's done, and the focus would go with it to
            // the page: it goes to the person's name, in the same row.
            here.current?.closest('tr, li')?.querySelector<HTMLElement>('a[href]')?.focus()
            onUnlocked()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div ref={here} className="ui-sign-in-lock">
            <StatusBadge tone="problem">{t(lockedOut ? 'sign_in_locked_until' : 'own_password_paused_until').replace('{time}', time)}</StatusBadge>
            <Button size="sm" icon={LockOpenIcon} busy={busy} aria-label={t(lockedOut ? 'sign_in_unlock_for' : 'own_password_unlock_for').replace('{name}', name)} onClick={() => { void unlock() }}>
                {t('sign_in_unlock')}
            </Button>
        </div>
    )
}
