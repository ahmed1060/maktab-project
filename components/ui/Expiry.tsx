'use client'

import type { ReactNode } from 'react'
import { WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import type { ExpiryState } from '@/lib/record-expiry'
import { Icon } from './Icon'
import { StatusBadge } from './StatusBadge'

/**
 * A date something expires on, with its badge (DESIGN.md §5.5): Expired, with
 * the warning icon, once the day has passed, and Expires soon in the 30 days
 * up to it. The words are always there, so it never rests on colour alone.
 */
export function ExpiryDate({ state, children }: { state: ExpiryState | null; children: ReactNode }) {
    return (
        <span className="ui-expiry">
            <span className="ui-expiry-date">{children}</span>
            <ExpiryBadge state={state} />
        </span>
    )
}

/** The badge alone, for where the date is on a line of its own, such as a phone card's status. */
export function ExpiryBadge({ state }: { state: ExpiryState | null }) {
    const { t } = useLanguage()
    if (state === 'expired') return <StatusBadge tone="problem"><Icon icon={WarningCircleIcon} size={16} />{t('ui_expired')}</StatusBadge>
    if (state === 'soon') return <StatusBadge tone="waiting">{t('ui_expires_soon')}</StatusBadge>
    return null
}
