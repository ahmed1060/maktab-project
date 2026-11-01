'use client'
import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import SafeDate from '@/components/SafeDate'
import { Button, Page, PageHeader, Tabs } from '@/components/ui'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useCan } from '@/lib/useCan'
import { useDialog } from '@/lib/useDialog'
import { SalaryTab, type Debt, type SalaryRecord, type Settlement } from './SalaryTab'
import { DayOffTab, ReconsiderDayOff, type DayOffHistory, type DayOffRequest } from './DayOffTab'
import { CostsTab, type UserCost } from './CostsTab'

/**
 * An employee's history: their salary by month, their day off credit and
 * their costs, and the bonuses and deductions behind them. Also each
 * person's own history, from the account menu.
 *
 * On the building blocks in parts (UI_PLAN.md §5 step 5). Part 1, PR 157:
 * the page header with the person's name, the tabs, kept in the address,
 * and the Salary tab (./SalaryTab.tsx). Part 2: the Day off credit tab, with
 * Reconsider on each day off taken from the credit (./DayOffTab.tsx), and
 * the Costs tab (./CostsTab.tsx). The bonuses and deductions dialogs follow.
 */

type Tab = 'salary' | 'day-off' | 'costs'
const TABS: Tab[] = ['salary', 'day-off', 'costs']


interface SalaryAdjustment {
    id: string
    type: 'BONUS' | 'DEDUCTION'
    amount: number
    reason?: string
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

const TERMINAL_ADJUSTMENT_STATUSES = ['ROLLED_BACK', 'REVERSED'] as const
const isTerminal = (status: string) => (TERMINAL_ADJUSTMENT_STATUSES as readonly string[]).includes(status)

interface Employee {
    id: string
    firstName: string
    lastName: string
    salary?: number
}

// One empty list per kind, so an effect depending on a list does not re-run
// just because a fresh [] was made on a render with no data yet.
const NO_RECORDS: SalaryRecord[] = []
const NO_COSTS: UserCost[] = []
const NO_ADJUSTMENTS: SalaryAdjustment[] = []
const NO_ROWS: never[] = []

export default function EmployeeHistoryPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const params = useParams()
    const router = useRouter()
    const pathname = usePathname()
    const { can, canFor } = useCan()
    // Each part of the page asks for the permission its route checks.
    const canSeeSalary = can('salary.view')
    // Anyone's pay but their own (ROLES_PLAN.md §4.2, rule 5).
    const canAdjust = canFor('salary_adjustments.manage', params.id as string | undefined)
    const canReevaluateDayOff = can('dayoff.approve')

    const [rollbackLoading, setRollbackLoading] = useState<string | null>(null)
    const [reversing, setReversing] = useState<SalaryAdjustment | null>(null)
    const [reverseReason, setReverseReason] = useState('')
    // The day off whose days are being reconsidered, from its row on the Day off credit tab.
    const [reconsidering, setReconsidering] = useState<DayOffRequest | null>(null)
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    // The tab is in the address, so a reload or a link opens it; ?highlight= keeps its place beside it.
    const linkedTab = searchParams.get('tab') as Tab | null
    const activeTab: Tab = linkedTab && TABS.includes(linkedTab) ? linkedTab : 'salary'
    const setTab = (next: Tab) => {
        const q = new URLSearchParams(searchParams.toString())
        q.set('tab', next)
        router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    }
    // Shown for six seconds after arriving via ?highlight=. See
    // lib/useFadingHighlight.ts for why this is not an effect any more.
    const visualHighlightId = useFadingHighlight(highlightId, 6000)

    // Each part of the page is its own SWR key: they load together, one
    // failing does not stop the others, and refreshing one after an action
    // is mutate() on that key rather than a hand-written re-fetch.
    const id = params.id as string | undefined
    // Only a network failure raises the banner, as before; a refused endpoint
    // just leaves its section empty.
    const onNetworkError = (err: unknown) => {
        if (err instanceof SWRError) return
        console.error('Error fetching data')
        showToast(t('failed_fetch_data'), 'error')
    }
    const quiet = { onError: onNetworkError }
    const employeeQuery = useSWR(id ? `/api/users?id=${id}` : null, fetcher, quiet)
    // Each tab says itself when its list didn't load, with Try again (PR 157, part 2).
    const recordsQuery = useSWR(id ? `/api/users/${id}/salary-history` : null, fetcher)
    const dayOffQuery = useSWR(id ? `/api/users/${id}/day-off-history` : null, fetcher)
    const costsQuery = useSWR(id ? `/api/users/${id}/costs-history` : null, fetcher)
    const unwrap = (r: any) => r ? (r.data || r) : undefined
    const employee: Employee | null = unwrap(employeeQuery.data) ?? null
    const records: SalaryRecord[] = unwrap(recordsQuery.data) ?? NO_RECORDS
    const dayOffHistory: DayOffHistory | null = unwrap(dayOffQuery.data) ?? null
    const userCosts: UserCost[] = unwrap(costsQuery.data) ?? NO_COSTS

    // The only route to an ended contract's statement. The person it is about
    // cannot sign in, so if it is not reachable from their page it is not
    // reachable at all.
    const { data: settlementsResult } = useSWR(can('settlements.manage') && id ? `/api/users/${id}/settlements` : null, fetcher)
    const settlements: Settlement[] = settlementsResult?.data || NO_ROWS
    // E2: raised when, recovered from which months, settled or written off by
    // whom. Every one of those was recorded and none of them was assembled.
    const { data: debtsResult } = useSWR(can('debts.view') && id ? `/api/users/${id}/debts` : null, fetcher)
    const debts: Debt[] = debtsResult?.data || NO_ROWS

    // Arriving with ?highlight= opens the adjustments, which may be what it
    // points at; the list itself is only asked for while they are open.
    const [isAdjustmentsModalOpen, setIsAdjustmentsModalOpen] = useState(Boolean(highlightId))
    const adjustmentsDialog = useDialog(isAdjustmentsModalOpen, () => setIsAdjustmentsModalOpen(false))
    const reverseDialog = useDialog(!!reversing, () => setReversing(null))
    useAdjustOnChange([highlightId], () => { if (highlightId) setIsAdjustmentsModalOpen(true) })
    const { data: adjustmentsResult, mutate: fetchAdjustments } = useSWR(
        isAdjustmentsModalOpen && id ? `/api/users/${id}/adjustments` : null, fetcher,
    )
    const adjustments: SalaryAdjustment[] = unwrap(adjustmentsResult) ?? NO_ADJUSTMENTS

    // Scroll to highlighted adjustment inside modal
    useEffect(() => {
        if (highlightId && isAdjustmentsModalOpen && adjustments.length > 0) {
            // Use a small timeout to ensure the modal content is rendered
            const timer = setTimeout(() => {
                const element = document.getElementById(`adj-${highlightId}`);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [highlightId, isAdjustmentsModalOpen, adjustments]);

    const handleUndo = async (adjId: string, action: 'rollback' | 'reverse', reason?: string) => {
        setRollbackLoading(adjId)
        try {
            const res = await fetch(`/api/users/${params.id}/adjustments/${adjId}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: reason || undefined }),
            })
            if (res.ok) {
                showToast(action === 'reverse' ? t('reverse_success' as any) : t('rollback_success' as any), 'success')
                fetchAdjustments()
                // Refresh records too. Through the same key as the first load,
                // so it is unwrapped the same way; the hand-written re-fetch
                // this replaces stored the whole { success, data } envelope.
                recordsQuery.mutate()
            } else {
                showToast(action === 'reverse' ? t('failed_reverse' as any) : t('failed_rollback' as any), 'error')
            }
        } catch {
            console.error(`Error applying ${action}`)
            showToast(action === 'reverse' ? t('failed_reverse' as any) : t('failed_rollback' as any), 'error')
        } finally {
            setRollbackLoading(null)
        }
    }

    const handleRollback = (adjId: string) => handleUndo(adjId, 'rollback')

    const getMonthName = (month: number) => {
        return new Date(2000, month - 1).toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US', { month: 'long' })
    }

    const monthLabel = (year: number, month: number) => `${getMonthName(month)} ${year}`

    const formatDays = (days: number) => {
        if (locale === 'ar') {
            if (days === 1) return t('day_singular' as any)
            if (days === 2) return t('day_dual')
            return `${days} ${t('days_label')}`
        }
        return `${days} ${days === 1 ? t('day_singular' as any) : t('days_label')}`
    }

    // Someone else's history goes back to Employees; one's own, opened from the account menu, has nowhere to go back to.
    const own = session?.user?.id === id
    const name = employee ? `${employee.firstName} ${employee.lastName}`.trim() : ''
    const tabLabel: Record<Tab, string> = {
        salary: canSeeSalary ? t('salary_label') : t('history'),
        'day-off': t('hist_tab_day_off'),
        costs: t('costs_tab'),
    }
    // The tab's own action, in the page header (DESIGN.md §5.5). Day off
    // credit has none: Reconsider is on each day off it can change (part 2).
    const action = activeTab === 'salary' && canAdjust
        ? <Button variant="primary" onClick={() => setIsAdjustmentsModalOpen(true)}>{t('hist_adjustments')}</Button>
        : undefined

    return (
        <Page>
            <PageHeader
                back={own ? undefined : { href: '/dashboard/employees', label: t('employees') }}
                title={name ? <bdi>{name}</bdi> : t('history')}
                subtitle={name ? t('history') : undefined}
                action={action}
            />
            <Tabs label={t('history')} idPrefix="history-tab" value={activeTab} onChange={setTab}
                items={TABS.map(k => ({ value: k, label: tabLabel[k], controls: 'history-panel' }))} />
            <div role="tabpanel" id="history-panel" className="ui-tab-panel" aria-labelledby={`history-tab-${activeTab}`}>
            {activeTab === 'salary' ? (
                <SalaryTab
                    employee={employee}
                    records={records}
                    loading={recordsQuery.isLoading}
                    error={recordsQuery.error}
                    retrying={recordsQuery.isValidating}
                    retry={() => { void recordsQuery.mutate() }}
                    settlements={settlements}
                    debts={debts}
                />
            ) : activeTab === 'costs' ? (
                <CostsTab
                    costs={userCosts}
                    loading={costsQuery.isLoading}
                    error={costsQuery.error}
                    retrying={costsQuery.isValidating}
                    retry={() => { void costsQuery.mutate() }}
                />
            ) : (
                <DayOffTab
                    history={dayOffHistory}
                    loading={dayOffQuery.isLoading}
                    error={dayOffQuery.error}
                    retrying={dayOffQuery.isValidating}
                    retry={() => { void dayOffQuery.mutate() }}
                    canReconsider={canReevaluateDayOff}
                    onReconsider={setReconsidering}
                />
            )}
            </div>

            {/* Adjustments Modal */}
            {isAdjustmentsModalOpen && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--scrim)',
                    backdropFilter: 'blur(4px)',
                    padding: '1rem'
                }}>
                    <div {...adjustmentsDialog.panelProps} className="glass" style={{
                        width: '100%',
                        maxWidth: '600px',
                        maxHeight: '80vh',
                        overflowY: 'auto',
                        padding: '2rem',
                        position: 'relative',
                        background: 'var(--panel-95)'
                    }}>
                        <button aria-label={t('close')}
                            onClick={() => setIsAdjustmentsModalOpen(false)}
                            style={{
                                position: 'absolute',
                                top: '1rem',
                                [locale === 'ar' ? 'left' : 'right']: '1rem',
                                border: 'none',
                                background: 'none',
                                fontSize: '1.5rem',
                                cursor: 'pointer',
                                color: 'var(--text-soft)'
                            }}
                        >
                            ×
                        </button>
                        <h2 id={adjustmentsDialog.titleId} style={{ marginBottom: '1.5rem' }}>{t('adjustment_history' as any)}</h2>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {adjustments.length === 0 ? (
                                <p style={{ textAlign: 'center', color: 'var(--text-soft)' }}>{t('no_adjustments_found' as any)}</p>
                            ) : (
                                adjustments.map(adj => (
                                    <div
                                        key={adj.id}
                                        id={`adj-${adj.id}`}
                                        className={visualHighlightId === adj.id ? 'highlight-pulse' : ''}
                                        style={{
                                            position: 'relative',
                                            padding: '1.25rem',
                                            borderRadius: '1rem',
                                            background: visualHighlightId === adj.id ? 'var(--highlight-tint)' : 'var(--surface)',
                                            border: '1px solid var(--border)',
                                            borderInlineStart: visualHighlightId === adj.id ? '4px solid var(--accent-solid)' : '1px solid var(--border)',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            transition: 'all 0.3s ease'
                                        }}
                                    >
                                        {/* Strikethrough Line */}
                                        {isTerminal(adj.status) && (
                                            <div style={{
                                                position: 'absolute',
                                                top: '50%',
                                                left: '-5px',
                                                right: '-5px',
                                                height: '2px',
                                                background: 'var(--danger-fill)',
                                                transform: 'rotate(-2deg)',
                                                zIndex: 5,
                                                opacity: 0.8,
                                                pointerEvents: 'none'
                                            }} />
                                        )}

                                        <div style={{ opacity: isTerminal(adj.status) ? 0.6 : 1 }}>
                                            <div style={{ fontWeight: 'bold', fontSize: '1.1rem', color: adj.type === 'BONUS' ? 'var(--accent-solid-deep)' : 'var(--danger-solid-hover)' }}>
                                                {adj.type === 'BONUS' ? '+' : '-'}{formatDays(adj.amount)}
                                            </div>
                                            {adj.reason && (
                                                <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: '0.25rem', maxWidth: '300px' }}>
                                                    {adj.reason}
                                                </div>
                                            )}
                                            {/*
                                              The month it applies to, beside the
                                              moment it was entered. They are
                                              usually the same and occasionally
                                              not, and only one of them decides
                                              what anybody is paid.
                                            */}
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                                <span style={{ fontWeight: 600 }}>
                                                    {t('applies_to_month' as any)} {monthLabel(adj.year, adj.month)}
                                                </span>
                                                <span style={{
                                                    padding: '0.1rem 0.5rem',
                                                    borderRadius: '0.5rem',
                                                    background: 'var(--surface-sunk)',
                                                    color: 'var(--text-soft)',
                                                    fontSize: '0.72rem',
                                                }}>
                                                    {t(`adjustment_source_${adj.source}` as any)}
                                                </span>
                                            </div>
                                            <div style={{ fontSize: '0.875rem', color: 'var(--text-faint)', marginTop: '0.25rem' }}>
                                                <SafeDate date={adj.createdAt} locale={locale} showTime />
                                            </div>
                                        </div>

                                        {adj.status === 'ACTIVE' && canAdjust && (
                                            <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                                                <button
                                                    onClick={() => { setReversing(adj); setReverseReason('') }}
                                                    disabled={!!rollbackLoading}
                                                    className="btn"
                                                    style={{
                                                        background: 'var(--surface-sunk)',
                                                        color: 'var(--text-strong)',
                                                        fontSize: '0.875rem',
                                                        padding: '0.5rem 1rem'
                                                    }}
                                                >
                                                    {t('reverse_adjustment' as any)}
                                                </button>
                                                <button
                                                    onClick={() => handleRollback(adj.id)}
                                                    disabled={!!rollbackLoading}
                                                    className="btn"
                                                    style={{
                                                        background: 'var(--danger-bg)',
                                                        color: 'var(--danger-fg)',
                                                        fontSize: '0.875rem',
                                                        padding: '0.5rem 1rem'
                                                    }}
                                                >
                                                    {rollbackLoading === adj.id ? '...' : t('rollback_adjustment' as any)}
                                                </button>
                                            </div>
                                        )}
                                        {isTerminal(adj.status) && (
                                            <span style={{ fontSize: '0.8rem', color: 'var(--danger-fg-strong)', fontWeight: 'bold', flexShrink: 0 }}>
                                                {adj.status === 'REVERSED'
                                                    ? t('reversed_label' as any)
                                                    : t('rolled_back_label' as any)}
                                            </span>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
            {/* Reverse Modal */}
            {reversing && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--scrim)',
                    padding: '1rem',
                }}>
                    <div {...reverseDialog.panelProps} style={{
                        background: 'var(--surface)',
                        borderRadius: '1rem',
                        border: '1px solid var(--border)',
                        padding: '1.5rem',
                        maxWidth: '460px',
                        width: '100%',
                        textAlign: locale === 'ar' ? 'right' : 'left',
                    }}>
                        <h3 id={reverseDialog.titleId} style={{ margin: '0 0 0.75rem' }}>{t('reverse_adjustment_title' as any)}</h3>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginTop: 0 }}>
                            {t('reverse_adjustment_msg' as any)}
                        </p>
                        <p style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                            {reversing.type === 'BONUS' ? '+' : '-'}{formatDays(reversing.amount)}
                            {' · '}
                            {monthLabel(reversing.year, reversing.month)}
                        </p>
                        <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.4rem' }}>
                            {t('reverse_reason' as any)}
                        </label>
                        <textarea aria-label={t('reverse_reason' as any)}
                            className="input"
                            rows={2}
                            value={reverseReason}
                            onChange={e => setReverseReason(e.target.value)}
                        />
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
                            <button
                                type="button"
                                className="btn"
                                style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                                onClick={() => setReversing(null)}
                            >
                                {t('close_button')}
                            </button>
                            <button
                                type="button"
                                className="btn"
                                style={{ background: 'var(--danger-fill)', color: 'var(--text-on-accent)' }}
                                disabled={!!rollbackLoading}
                                aria-busy={!!rollbackLoading || undefined}
                                onClick={async () => {
                                    // Closed after, not before: the dialog shows it working.
                                    const target = reversing
                                    try { await handleUndo(target.id, 'reverse', reverseReason) } finally { setReversing(null) }
                                }}
                            >
                                {t('reverse_adjustment' as any)}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ReconsiderDayOff
                request={reconsidering}
                onClose={() => setReconsidering(null)}
                onDone={() => { setReconsidering(null); void dayOffQuery.mutate() }}
            />
        </Page>
    )
}
