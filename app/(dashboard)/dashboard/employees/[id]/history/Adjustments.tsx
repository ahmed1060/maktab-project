'use client'
import { useEffect, useState } from 'react'
import { ArrowCounterClockwiseIcon, ArrowUUpLeftIcon, CalendarBlankIcon, ClockIcon, HourglassIcon, PlusMinusIcon, TagIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import {
    Button, DataList, Dialog, DialogActions, EmptyState, Field, ListCard, RowMenu, Section, StatusBadge, TextArea, visibleRow,
    type Column, type MenuItem,
} from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { countOf } from '@/lib/plural'
import type { SWRError } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'
import { useBusyAction } from '@/lib/useBusyAction'

/**
 * An employee's history, its bonuses and deductions (UI_PLAN.md §5 step 5, an
 * employee's history part 3): a section of the Salary tab, each with what it
 * was, the month it counts in, where it came from, why and when it was
 * entered, and Reverse or Roll back on one still in effect, each asking first.
 */

export type SalaryAdjustment = {
    id: string
    type: 'BONUS' | 'DEDUCTION'
    /** In days. */
    amount: number
    reason?: string | null
    // Two terminal statuses, not one. A row that only knew about ROLLED_BACK
    // would render a reversed adjustment as live and offer a Rollback button
    // that the API refuses.
    status: 'ACTIVE' | 'ROLLED_BACK' | 'REVERSED'
    /** The month the days landed on, which is not always the month it was entered in. */
    month: number
    year: number
    source: 'MANUAL' | 'TASK_PENALTY' | 'DAY_OFF' | 'SETTLEMENT'
    sourceId?: string | null
    createdAt: string
}

type Undo = 'reverse' | 'rollback'

const TERMINAL_ADJUSTMENT_STATUSES = ['ROLLED_BACK', 'REVERSED'] as const
const isTerminal = (status: string) => (TERMINAL_ADJUSTMENT_STATUSES as readonly string[]).includes(status)

/** The page's own words and digits for an adjustment, in the list and in its dialog. */
function useAdjustmentWords() {
    const { t, locale } = useLanguage()
    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    return {
        t, locale,
        /** "2 days bonus", "1.5 days deducted". */
        what: (adj: SalaryAdjustment) => t(adj.type === 'BONUS' ? 'hist_bonus_n' : 'hist_deducted_n').replace('{days}', countOf(t, locale, adj.amount, 'days')),
        // The month it applies to, beside the moment it was entered. They
        // are usually the same and occasionally not, and only one of them
        // decides what anybody is paid.
        monthLabel: (year: number, month: number) => new Date(year, month - 1).toLocaleString(digits, { month: 'long', year: 'numeric' }),
        entered: (iso: string) => new Date(iso).toLocaleString(digits, { day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit' }),
    }
}

export function Adjustments({ userId, adjustments, loading, error, retrying, retry, canUndo, highlighted, onUndone }: {
    userId: string
    adjustments: SalaryAdjustment[]
    loading: boolean
    error: unknown
    retrying: boolean
    retry: () => void
    /** salary_adjustments.manage over this person: never one's own pay. */
    canUndo: boolean
    /** The one a notification opened, while it's marked. */
    highlighted: string | null
    onUndone: () => void
}) {
    const { t, what, monthLabel, entered } = useAdjustmentWords()
    const [undoing, setUndoing] = useState<{ adj: SalaryAdjustment; action: Undo } | null>(null)

    // The one a notification opened, brought into view once it's listed. The
    // list has it twice, as a table row and as a phone card, so it's the one
    // showing at this width.
    const shown = !!highlighted && adjustments.some(adj => adj.id === highlighted)
    useEffect(() => {
        if (!highlighted || !shown) return
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        visibleRow(highlighted)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }, [highlighted, shown])

    const source = (adj: SalaryAdjustment) => t(`adjustment_source_${adj.source}` as TranslationKey)
    const reason = (adj: SalaryAdjustment) => (adj.reason ? <bdi>{adj.reason}</bdi> : null)
    const badge = (adj: SalaryAdjustment) => isTerminal(adj.status)
        ? <StatusBadge tone="neutral">{t(adj.status === 'REVERSED' ? 'reversed_label' : 'rolled_back_label')}</StatusBadge>
        : null
    // Only one still in effect can be undone, by who may adjust this person's pay.
    const menu = (adj: SalaryAdjustment) => {
        if (!canUndo || isTerminal(adj.status)) return null
        const items: MenuItem[] = [
            { key: 'reverse', label: t('reverse_adjustment'), icon: ArrowCounterClockwiseIcon, onSelect: () => setUndoing({ adj, action: 'reverse' }) },
            // It rolled back on one click; now it asks first, as a destructive action does.
            { key: 'rollback', label: t('hist_adj_rollback'), icon: ArrowUUpLeftIcon, danger: true, onSelect: () => setUndoing({ adj, action: 'rollback' }) },
        ]
        return <RowMenu label={t('ui_more_actions_for').replace('{name}', `${what(adj)}, ${monthLabel(adj.year, adj.month)}`)} tooltip={t('ui_more_actions')} items={items} />
    }

    const columns: Column<SalaryAdjustment>[] = [
        { key: 'what', header: t('hist_adj_col_what'), cell: adj => <span className="ui-item-title">{what(adj)}</span> },
        { key: 'month', header: t('hist_col_month'), cell: adj => monthLabel(adj.year, adj.month) },
        { key: 'source', header: t('hist_adj_col_source'), cell: source },
        { key: 'reason', header: t('hist_dayoff_col_reason'), cell: reason },
        { key: 'entered', header: t('hist_adj_col_entered'), cell: adj => entered(adj.createdAt) },
        { key: 'status', header: t('status_label'), cell: badge },
        ...(canUndo ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: menu }] : []),
    ]

    const body = (() => {
        if (adjustments.length === 0 && loading) return <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        if (adjustments.length === 0 && error) return (
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('hist_adj_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={retrying} onClick={retry}>{t('try_again')}</Button>} />
            </div>
        )
        return (
            <DataList
                caption={t('hist_adjustments')}
                columns={columns}
                rows={adjustments}
                rowKey={adj => adj.id}
                tone={adj => (highlighted === adj.id ? 'selected' : undefined)}
                empty={<EmptyState icon={PlusMinusIcon} title={t('hist_adj_none')} />}
                card={adj => (
                    <ListCard
                        title={what(adj)}
                        status={badge(adj)}
                        details={[
                            { icon: CalendarBlankIcon, text: monthLabel(adj.year, adj.month) },
                            { icon: TagIcon, text: source(adj) },
                            { icon: ClockIcon, text: entered(adj.createdAt) },
                        ]}
                        foot={reason(adj) || menu(adj)
                            ? <>{reason(adj) && <span className="ui-hint">{reason(adj)}</span>}{menu(adj) && <span className="ui-row-actions">{menu(adj)}</span>}</>
                            : undefined}
                    />
                )}
            />
        )
    })()

    return (
        <Section title={t('hist_adjustments')}>
            {body}
            {undoing && (
                <UndoAdjustment
                    userId={userId}
                    adjustment={undoing.adj}
                    action={undoing.action}
                    onClose={() => setUndoing(null)}
                    onDone={() => { setUndoing(null); onUndone() }}
                />
            )}
        </Section>
    )
}

/**
 * Reversing an adjustment (it was right, and is now being undone), with why
 * if there's a reason, or rolling it back (it should never have existed).
 * Either asks first, and stays open until it's done: the server may first
 * ask for the authenticator code, a high-risk action's, over it.
 */
export function UndoAdjustment({ userId, adjustment, action, onClose, onDone }: {
    userId: string
    adjustment: SalaryAdjustment
    action: Undo
    onClose: () => void
    onDone: () => void
}) {
    const { t, what, monthLabel } = useAdjustmentWords()
    const { showToast } = useToast()
    const busy = useBusyAction()
    const [reason, setReason] = useState('')
    const reversing = action === 'reverse'
    const close = () => { if (!busy.running) onClose() }

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        void busy.run('undo', async () => {
            const failed = t('hist_adj_undo_failed')
            try {
                const res = await fetch(`/api/users/${userId}/adjustments/${adjustment.id}/${action}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ reason: reversing ? reason.trim() || undefined : undefined }),
                })
                if (!res.ok) {
                    // Why, where the server says: a month already approved can't be undone.
                    showToast(apiErrorText(await res.text(), failed), 'error')
                    return
                }
                showToast(t(reversing ? 'hist_adj_reversed' : 'hist_adj_rolled_back'), 'success')
                onDone()
            } catch {
                showToast(failed, 'error')
            }
        })
    }

    return (
        <Dialog open onClose={close} title={t(reversing ? 'hist_adj_reverse_title' : 'hist_adj_rollback_title')}>
            <form className="ui-form" noValidate onSubmit={submit}>
                <p>{t('hist_adj_what').replace('{what}', what(adjustment)).replace('{month}', monthLabel(adjustment.year, adjustment.month))}</p>
                <p className="ui-hint">{t(reversing ? 'hist_adj_reverse_msg' : 'hist_adj_rollback_msg')}</p>
                {reversing && (
                    <Field label={t('reverse_reason')}>{p => (
                        <TextArea {...p} dir="auto" value={reason} onChange={e => setReason(e.target.value)} />
                    )}</Field>
                )}
                <DialogActions>
                    <Button onClick={close} disabled={busy.running}>{t('cancel')}</Button>
                    <Button type="submit" variant={reversing ? 'primary' : 'danger'} disabled={busy.running} busy={busy.is('undo')}>
                        {t(reversing ? 'reverse_adjustment' : 'hist_adj_rollback')}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
