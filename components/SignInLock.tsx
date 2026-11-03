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
 * The lists say it only to whoever may unlock (app/api/users/route.ts), so
 * the button is always theirs to press. Nothing for somebody who isn't locked.
 */
export function SignInLock({ personId, name, until, onUnlocked }: {
    personId: string
    name: string
    until: string | null | undefined
    onUnlocked: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [busy, setBusy] = useState(false)
    const here = useRef<HTMLDivElement>(null)
    if (!until) return null

    const time = new Date(until).toLocaleTimeString(locale === 'ar' ? 'ar-EG' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
    const unlock = async () => {
        setBusy(true)
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(personId)}/unlock-sign-in`, { method: 'POST' })
            if (!res.ok) return showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
            showToast(t('sign_in_unlocked').replace('{name}', name), 'success')
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
            <StatusBadge tone="problem">{t('sign_in_locked_until').replace('{time}', time)}</StatusBadge>
            <Button size="sm" icon={LockOpenIcon} busy={busy} aria-label={t('sign_in_unlock_for').replace('{name}', name)} onClick={() => { void unlock() }}>
                {t('sign_in_unlock')}
            </Button>
        </div>
    )
}
