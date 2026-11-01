'use client'
import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { HourglassIcon } from '@phosphor-icons/react/ssr'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import SafeDate from '@/components/SafeDate'
import { Button, EmptyState, Page, PageHeader, Tabs } from '@/components/ui'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useCan } from '@/lib/useCan'
import { apiErrorText } from "@/lib/api-error-text"
import { useDialog } from '@/lib/useDialog'
import { SalaryTab, type Debt, type SalaryRecord, type Settlement } from './SalaryTab'

/**
 * An employee's history: their salary by month, their day off credit and
 * their costs, and the bonuses and deductions behind them. Also each
 * person's own history, from the account menu.
 *
 * On the building blocks in parts (UI_PLAN.md §5 step 5). Part 1, PR 157:
 * the page header with the person's name, the tabs, kept in the address,
 * and the Salary tab (./SalaryTab.tsx). The Day off credit and Costs tabs,
 * and the dialogs, follow.
 */

type Tab = 'salary' | 'day-off' | 'costs'
const TABS: Tab[] = ['salary', 'day-off', 'costs']


interface DayOffRequest {
    id: string
    type: string
    date: string
    daysDeducted: number
    deductionType: string
    reason?: string
}

interface DayOffCreditSnapshot {
    id: string
    year: number
    baseCredit: number
    remainingCredit: number
    /** Set when the reset had to reconstruct this year rather than measure it. */
    note?: string | null
}

interface DayOffHistoryYear {
    year: number
    snapshot: DayOffCreditSnapshot | null
    requests: DayOffRequest[]
}

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

interface UserCost {
    id: string
    title: string
    amount: number
    status: string
    date: string
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

    const [reevaluating, setReevaluating] = useState(false)
    const [rollbackLoading, setRollbackLoading] = useState<string | null>(null)
    const [reversing, setReversing] = useState<SalaryAdjustment | null>(null)
    const [reverseReason, setReverseReason] = useState('')
    const [isReevaluateModalOpen, setIsReevaluateModalOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<DayOffRequest | null>(null)
    const [reevaluateValue, setReevaluateValue] = useState('')
    const [isManageDeductionsOpen, setIsManageDeductionsOpen] = useState(false)
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
    // The Salary tab says itself when its list didn't load, with Try again (PR 157).
    const recordsQuery = useSWR(id ? `/api/users/${id}/salary-history` : null, fetcher)
    const dayOffQuery = useSWR(id ? `/api/users/${id}/day-off-history` : null, fetcher, quiet)
    const costsQuery = useSWR(id ? `/api/users/${id}/costs-history` : null, fetcher, quiet)
    const unwrap = (r: any) => r ? (r.data || r) : undefined
    const employee: Employee | null = unwrap(employeeQuery.data) ?? null
    const records: SalaryRecord[] = unwrap(recordsQuery.data) ?? NO_RECORDS
    const dayOffHistory: { baseCredit: number, remainingCredit: number, history: DayOffHistoryYear[] } | null = unwrap(dayOffQuery.data) ?? null
    const userCosts: UserCost[] = unwrap(costsQuery.data) ?? NO_COSTS
    const fetchData = () => Promise.all([employeeQuery.mutate(), recordsQuery.mutate(), dayOffQuery.mutate(), costsQuery.mutate()])

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
    const reevaluateDialog = useDialog(isReevaluateModalOpen && !!selectedRequest, () => setIsReevaluateModalOpen(false))
    const deductionsDialog = useDialog(isManageDeductionsOpen, () => setIsManageDeductionsOpen(false))
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

    const handleReevaluate = async () => {
        if (!selectedRequest || !reevaluateValue) return

        try {
            setReevaluating(true)
            const res = await fetch(`/api/admin/day-off-requests/${selectedRequest.id}/reevaluate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ newDays: parseFloat(reevaluateValue) })
            })

            if (res.ok) {
                showToast(t('update_success' as any) || 'Re-evaluation successful', 'success')
                await fetchData()
                setIsReevaluateModalOpen(false)
            } else {
                const err = await res.text()
                showToast(apiErrorText(err, t('update_failed' as any)), 'error')
            }
        } catch {
            showToast(t('update_failed' as any), 'error')
        } finally {
            setReevaluating(false)
        }
    }

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
    // Each tab's own action, in the page header (DESIGN.md §5.5).
    const action = activeTab === 'salary' && canAdjust
        ? <Button variant="primary" onClick={() => setIsAdjustmentsModalOpen(true)}>{t('hist_adjustments')}</Button>
        : activeTab === 'day-off' && canReevaluateDayOff
            ? <Button variant="primary" onClick={() => setIsManageDeductionsOpen(true)}>{t('hist_manage_deductions')}</Button>
            : undefined
    // The tabs not on the building blocks yet (part 2) say they're loading the same way.
    const waiting = <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>

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
            ) : activeTab === 'costs' ? (costsQuery.isLoading ? waiting : (
                <div className="card" style={{ overflowX: 'auto', padding: '1.5rem', background: 'var(--panel-70)' }}>
                    <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                        {t('costs_tab' as any) || 'Costs'}
                    </h2>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: 'var(--surface-subtle)', borderBottom: '2px solid var(--border)' }}>
                                <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('date_label')}</th>
                                <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('task_title' as any) || 'Task'}</th>
                                <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('amount_label' as any) || 'Amount'}</th>
                                <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('status' as any) || 'Status'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {userCosts.length === 0 ? (
                                <tr>
                                    <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-soft)' }}>
                                        {t('no_records_found')}
                                    </td>
                                </tr>
                            ) : (
                                userCosts.map(cost => (
                                    <tr key={cost.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            <SafeDate date={cost.date} locale={locale} format="dateOnly" />
                                        </td>
                                        <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            {cost.title}
                                        </td>
                                        <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left', fontWeight: 'bold' }}>
                                            {new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(cost.amount)}
                                        </td>
                                        <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                            <span style={{
                                                padding: '0.25rem 0.75rem',
                                                borderRadius: '1rem',
                                                fontSize: '0.875rem',
                                                fontWeight: 'bold',
                                                background: cost.status === 'PAID' ? 'var(--ok-bg)' : 'var(--danger-bg)',
                                                color: cost.status === 'PAID' ? 'var(--ok-fg)' : 'var(--danger-fg)'
                                            }}>
                                                {cost.status === 'PAID' ? t('payment_status_paid' as any) : t('payment_status_pending' as any)}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            )) : dayOffQuery.isLoading ? waiting : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {dayOffHistory && (
                        <p style={{ margin: '0.25rem 0 0 0', fontSize: '1rem' }}>
                                    {t('assigned_day_off_credit_label' as any) || 'Assigned Credit'}: <strong>{dayOffHistory.baseCredit}</strong> |
                                    {t('remaining_day_off_credit_label' as any) || ' Remaining'}: <strong style={{ color: 'var(--ok-fg)' }}>{dayOffHistory.remainingCredit}</strong>
                                </p>
                    )}
                    {dayOffHistory?.history.map(yearData => (
                        <div key={yearData.year} className="card" style={{ overflowX: 'auto', padding: '1.5rem', background: 'var(--panel-70)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                                <h2 style={{ margin: 0 }}>{yearData.year}</h2>
                                {yearData.snapshot && (
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                        <div>
                                            {t('base_credit' as any) || 'Base'}: <strong>{yearData.snapshot.baseCredit}</strong> |
                                            {t('remaining_before_reset' as any) || ' Remaining (End of Year)'}: <strong>{yearData.snapshot.remainingCredit}</strong>
                                        </div>
                                        {/*
                                          A reconstructed year says so on the
                                          screen, not only in the column. The
                                          figures beside it are carried, not
                                          measured, and somebody reading a leave
                                          balance from years ago should be told
                                          which kind of number they are looking at.
                                        */}
                                        {yearData.snapshot.note && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--warn-fg)', marginTop: '0.35rem', maxWidth: '420px' }}>
                                                {yearData.snapshot.note}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ background: 'var(--surface-subtle)', borderBottom: '2px solid var(--border)' }}>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('date_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('type_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('reason_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('days_label')}</th>
                                        <th style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('deducted_from' as any) || 'Deducted From'}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {yearData.requests.length === 0 ? (
                                        <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-soft)' }}>{t('no_records_found')}</td></tr>
                                    ) : (
                                        yearData.requests.map(req => (
                                            <tr key={req.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}><SafeDate date={req.date} locale={locale} format="dateOnly" /></td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t(req.type as any) || req.type}</td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.reason || '-'}</td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left', fontWeight: 'bold' }}>{req.daysDeducted}</td>
                                                <td style={{ padding: '0.75rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.deductionType === 'CREDIT' ? t('day_off_credit') : t('salary_label' as any)}</td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </div>
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

            {/* ReEvaluate Modal */}
            {isReevaluateModalOpen && selectedRequest && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 1100,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--scrim)',
                    backdropFilter: 'blur(4px)',
                    padding: '1rem'
                }}>
                    <div {...reevaluateDialog.panelProps} className="glass" style={{
                        width: '100%',
                        maxWidth: '400px',
                        padding: '2rem',
                        background: 'var(--panel-95)',
                        borderRadius: '1.5rem',
                        boxShadow: '0 20px 25px -5px var(--shadow-weak)',
                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                    }}>
                        <h2 id={reevaluateDialog.titleId} style={{ marginBottom: '1rem' }}>{t('reevaluate')}</h2>
                        <p style={{ color: 'var(--text-soft)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                            <SafeDate date={selectedRequest.date} locale={locale} format="dateOnly" /> - {t(selectedRequest.type as any) || selectedRequest.type}
                        </p>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                                {t('days_label')}
                            </label>
                            <input aria-label={t('days_label')}
                                type="number"
                                step="0.5"
                                value={reevaluateValue}
                                onChange={(e) => setReevaluateValue(e.target.value)}
                                className="input"
                                style={{ width: '100%' }}
                                autoFocus
                            />
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
                            <button onClick={() => setIsReevaluateModalOpen(false)} className="btn glass">{t('cancel_button')}</button>
                            <button
                                onClick={handleReevaluate}
                                className="btn btn-primary"
                                disabled={reevaluating}
                                aria-busy={reevaluating || undefined}
                            >
                                {t('confirm')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Manage Deductions Modal */}
            {isManageDeductionsOpen && (
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
                    <div {...deductionsDialog.panelProps} className="glass" style={{
                        width: '100%',
                        maxWidth: '700px',
                        maxHeight: '85vh',
                        overflowY: 'auto',
                        padding: '2rem',
                        background: 'var(--panel-95)',
                        borderRadius: '2rem',
                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                            <h2 id={deductionsDialog.titleId} style={{ margin: 0 }}>{t('manage_deductions')}</h2>
                            <button aria-label={t('close')} onClick={() => setIsManageDeductionsOpen(false)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-soft)' }}>×</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {dayOffHistory?.history.flatMap(y => y.requests).filter(r => r.deductionType === 'CREDIT').length === 0 ? (
                                <p style={{ textAlign: 'center', color: 'var(--text-soft)' }}>{t('no_records_found')}</p>
                            ) : (
                                dayOffHistory?.history.flatMap(y => y.requests).filter(r => r.deductionType === 'CREDIT')
                                    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                    .map(req => (
                                        <div key={req.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.25rem', background: 'var(--surface)', borderRadius: '1.25rem', border: '1px solid var(--border)' }}>
                                            <div>
                                                <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{t(req.type as any) || req.type}</div>
                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}><SafeDate date={req.date} locale={locale} format="dateOnly" /></div>
                                                {req.reason && <div style={{ fontSize: '0.85rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>{req.reason}</div>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                                <div style={{ fontWeight: '800', fontSize: '1.2rem', color: 'var(--danger-fg-strong)' }}>-{req.daysDeducted}</div>
                                                <button
                                                    onClick={() => { setSelectedRequest(req); setReevaluateValue(req.daysDeducted.toString()); setIsReevaluateModalOpen(true); }}
                                                    className="btn glass"
                                                    style={{ fontSize: '0.85rem' }}
                                                >
                                                    {t('reevaluate')}
                                                </button>
                                            </div>
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </Page>
    )
}
