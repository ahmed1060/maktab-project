'use client'
import Link from 'next/link'
import { CalendarBlankIcon, CoinsIcon, HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, DataList, EmptyState, ListCard, StatusBadge, type Column } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import type { SWRError } from '@/lib/swr-fetcher'

/**
 * An employee's history, its Costs tab (UI_PLAN.md §5 step 5, an employee's
 * history part 2): each task they paid for, what's to pay them back, and
 * whether it's been paid, as the Costs page shows it.
 */

export type UserCost = {
    /** The task's id. */
    id: string
    title: string
    /** What's to pay back to this person for the task. */
    amount: number
    /** PAID, or PENDING_PAYMENT. */
    status: string
    date: string
}

export function CostsTab({ costs, loading, error, retrying, retry }: {
    costs: UserCost[]
    loading: boolean
    error: unknown
    retrying: boolean
    retry: () => void
}) {
    const { t, locale } = useLanguage()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    // As the Costs page writes an amount (PR 117).
    const money = (n: number) => `${n.toLocaleString(digits, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const date = (d: string) => new Date(d).toLocaleDateString(digits, { day: 'numeric', month: 'long', year: 'numeric' })
    const task = (c: UserCost) => <Link className="ui-item-link" href={`/dashboard/tasks/${c.id}`} prefetch={false}><bdi>{c.title}</bdi></Link>
    const amount = (c: UserCost) => <strong className="ui-nowrap ui-num">{money(c.amount)}</strong>
    // As a task's own costs say it.
    const badge = (c: UserCost) => (
        <StatusBadge tone={c.status === 'PAID' ? 'good' : 'waiting'}>{t(c.status === 'PAID' ? 'payment_status_paid' : 'payment_status_pending')}</StatusBadge>
    )

    if (costs.length === 0 && loading) return <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
    if (costs.length === 0 && error) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('hist_costs_load_failed')} detail={(error as SWRError).info?.error}
                action={<Button busy={retrying} onClick={retry}>{t('try_again')}</Button>} />
        </div>
    )

    const columns: Column<UserCost>[] = [
        { key: 'task', header: t('costs_col_task'), cell: c => <span className="ui-item-title">{task(c)}</span> },
        { key: 'date', header: t('date_label'), cell: c => date(c.date) },
        { key: 'amount', header: t('hist_cost_col_amount'), cell: amount, align: 'end' },
        { key: 'status', header: t('status_label'), cell: badge },
    ]

    return (
        <DataList
            caption={t('hist_costs_list')}
            columns={columns}
            rows={costs}
            rowKey={c => c.id}
            empty={<EmptyState icon={CoinsIcon} title={t('hist_costs_none')} />}
            card={c => (
                <ListCard
                    title={task(c)}
                    status={badge(c)}
                    details={[
                        { icon: CalendarBlankIcon, text: date(c.date) },
                        // Paid back once it's paid: "To pay back" beside "Paid" said the opposite of its badge (PR 158).
                        { icon: CoinsIcon, text: <span>{t(c.status === 'PAID' ? 'hist_cost_paid_back' : 'advances_to_pay_back')}: {amount(c)}</span> },
                    ]}
                />
            )}
        />
    )
}
