'use client'

import useSWR from 'swr'
import { WalletIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Icon } from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'

/**
 * Add cost's line about the person's cash advance (CLIENTS_PLAN.md §7.2):
 * "Your advance: 700 EGP", as costs they add are paid from it first. There's
 * nothing to choose. Only where the company uses cash advances, as the side
 * bar already knows, and for someone who holds one.
 */
export default function AdvanceBalanceHint() {
    const { t, locale } = useLanguage()
    const viewer = useViewer()
    const { data: shell } = useSWR<{ data: { cashAdvances?: boolean } }>(viewer?.id && viewer.role !== 'SUPER_ADMIN' ? '/api/company-settings/visible' : null, fetcher)
    const uses = !!shell?.data?.cashAdvances
    const { data } = useSWR<{ data: { balance: number } }>(uses && viewer?.id ? `/api/cash-advances/${encodeURIComponent(viewer.id)}?limit=1` : null, fetcher)
    const balance = data?.data?.balance
    if (!uses || balance === undefined || balance <= 0) return null
    const money = `${balance.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    return (
        <p className="ui-meta" role="status">
            <Icon icon={WalletIcon} size={16} />
            <span>{t('advances_add_cost_hint').replace('{amount}', money)}</span>
        </p>
    )
}
