'use client'

import { Fragment } from 'react'
import useSWR from 'swr'
import { WalletIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Icon } from '@/components/ui'
import { fill } from '@/components/attendance-calendar/fill'
import { fetcher } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'
import { paysFirst, type HeldPart } from '@/lib/cash-advances'

/**
 * Add cost's line about the person's cash advance (CLIENTS_PLAN.md §7.2):
 * "Your advance: 700 EGP", as costs they add are paid from it first. There's
 * nothing to choose. Only where the company uses cash advances, as the side
 * bar already knows, and for someone who holds one.
 *
 * Where they hold money for this task or its client (§7.9), it says what
 * pays a cost here, in order: "400 EGP for this task, then 300 EGP for Nile
 * Foods, then 665 EGP from your running balance". Money for any other task
 * or client never does, so it isn't counted.
 */
export default function AdvanceBalanceHint({ on }: { on: { taskId: string; clientId: string | null } }) {
    const { t, locale } = useLanguage()
    const viewer = useViewer()
    const { data: shell } = useSWR<{ data: { cashAdvances?: boolean } }>(viewer?.id && viewer.role !== 'SUPER_ADMIN' ? '/api/company-settings/visible' : null, fetcher)
    const uses = !!shell?.data?.cashAdvances
    const { data } = useSWR<{ data: { balance: number; running: number; held: HeldPart[] } }>(uses && viewer?.id ? `/api/cash-advances/${encodeURIComponent(viewer.id)}?limit=1` : null, fetcher)
    if (!uses || !data?.data) return null
    const { balance, running, held } = data.data
    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    // Nothing held for a task or a client anywhere: the one balance pays it, as before.
    if (!held.length) {
        if (balance <= 0) return null
        return (
            <p className="ui-meta" role="status">
                <Icon icon={WalletIcon} size={16} />
                <span>{t('advances_add_cost_hint').replace('{amount}', money(balance))}</span>
            </p>
        )
    }
    const parts = paysFirst(held, running, on)
    if (!parts.length) return null
    const said = parts.map((p, i) => (
        <Fragment key={p.kind}>
            {i > 0 && t('advances_add_cost_then')}
            {p.kind === 'task' ? fill(t('advances_add_cost_task'), { amount: <span className="ui-num ui-nowrap">{money(p.amount)}</span> })
                : p.kind === 'client' ? fill(t('advances_add_cost_client'), { amount: <span className="ui-num ui-nowrap">{money(p.amount)}</span>, name: <bdi>{p.name}</bdi> })
                    : fill(t('advances_add_cost_running'), { amount: <span className="ui-num ui-nowrap">{money(p.amount)}</span> })}
        </Fragment>
    ))
    return (
        <p className="ui-meta" role="status">
            <Icon icon={WalletIcon} size={16} />
            <span>{fill(t('advances_add_cost_parts'), { parts: said })}</span>
        </p>
    )
}
