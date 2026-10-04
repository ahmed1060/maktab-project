'use client'
import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import SafeDate from '@/components/SafeDate'
import Link from 'next/link'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useCan } from '@/lib/useCan'
import { apiErrorText } from "@/lib/api-error-text"
import { useDialog } from '@/lib/useDialog'


interface SalaryRecord {
    id: string
    month: number
    year: number
    totalDays: number
    deductions: number // Deductions in DAYS
    baseSalary: number
    bonusDays: number // Bonus in DAYS
    createdAt: string
    /**
     * Which number this month's total actually is. PAYSLIP means payroll ran
     * and this is what it produced; ESTIMATE means it did not, and the figure
     * is this screen's own approximation of a month it cannot see inside.
     */
    figure?:
    | { source: 'PAYSLIP'; netMinor: number; payslipId: string; status: 'APPROVED' | 'PAID' }
    | { source: 'ESTIMATE'; netMinor: number }
}

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
    const params = useParams()
    const router = useRouter()
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
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [activeTab, setActiveTab] = useState<'SALARY' | 'DAY_OFF' | 'COSTS'>('SALARY')
    const [isReevaluateModalOpen, setIsReevaluateModalOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<DayOffRequest | null>(null)
    const [reevaluateValue, setReevaluateValue] = useState('')
    const [isManageDeductionsOpen, setIsManageDeductionsOpen] = useState(false)
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
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
        setAlert({ type: 'error', message: t('failed_fetch_data') })
        setTimeout(() => setAlert(null), 3000)
    }
    const quiet = { onError: onNetworkError }
    const employeeQuery = useSWR(id ? `/api/users?id=${id}` : null, fetcher, quiet)
    const recordsQuery = useSWR(id ? `/api/users/${id}/salary-history` : null, fetcher, quiet)
    const dayOffQuery = useSWR(id ? `/api/users/${id}/day-off-history` : null, fetcher, quiet)
    const costsQuery = useSWR(id ? `/api/users/${id}/costs-history` : null, fetcher, quiet)
    const unwrap = (r: any) => r ? (r.data || r) : undefined
    const employee: Employee | null = unwrap(employeeQuery.data) ?? null
    const records: SalaryRecord[] = unwrap(recordsQuery.data) ?? NO_RECORDS
    const dayOffHistory: { baseCredit: number, remainingCredit: number, history: DayOffHistoryYear[] } | null = unwrap(dayOffQuery.data) ?? null
    const userCosts: UserCost[] = unwrap(costsQuery.data) ?? NO_COSTS
    const loading = employeeQuery.isLoading || recordsQuery.isLoading || dayOffQuery.isLoading || costsQuery.isLoading || reevaluating
    const fetchData = () => Promise.all([employeeQuery.mutate(), recordsQuery.mutate(), dayOffQuery.mutate(), costsQuery.mutate()])

    // The only route to an ended contract's statement. The person it is about
    // cannot sign in, so if it is not reachable from their page it is not
    // reachable at all.
    const { data: settlementsResult } = useSWR(can('settlements.manage') && id ? `/api/users/${id}/settlements` : null, fetcher)
    const settlements: { id: string; lastWorkingDay: string; net: number; status: string }[] = settlementsResult?.data || NO_ROWS
    // E2: raised when, recovered from which months, settled or written off by
    // whom. Every one of those was recorded and none of them was assembled.
    const { data: debtsResult } = useSWR(can('debts.view') && id ? `/api/users/${id}/debts` : null, fetcher)
    const debts: {
        id: string; amount: number; recovered: number; outstanding: number; writtenOff: number
        status: 'OUTSTANDING' | 'SETTLED' | 'WAIVED'; source: string; reason: string | null
        dueDate: string; settledAt: string | null
    }[] = debtsResult?.data || NO_ROWS

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
                setAlert({
                    type: 'success',
                    message: action === 'reverse' ? t('reverse_success' as any) : t('rollback_success' as any),
                })
                fetchAdjustments()
                // Refresh records too. Through the same key as the first load,
                // so it is unwrapped the same way; the hand-written re-fetch
                // this replaces stored the whole { success, data } envelope.
                recordsQuery.mutate()
            } else {
                setAlert({
                    type: 'error',
                    message: action === 'reverse' ? t('failed_reverse' as any) : t('failed_rollback' as any),
                })
            }
        } catch {
            console.error(`Error applying ${action}`)
            setAlert({
                type: 'error',
                message: action === 'reverse' ? t('failed_reverse' as any) : t('failed_rollback' as any),
            })
        } finally {
            setRollbackLoading(null)
            setTimeout(() => setAlert(null), 3000)
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
                setAlert({ type: 'success', message: t('update_success' as any) || 'Re-evaluation successful' })
                await fetchData()
                setIsReevaluateModalOpen(false)
            } else {
                const err = await res.text()
                setAlert({ type: 'error', message: apiErrorText(err, t('update_failed' as any)) })
            }
        } catch {
            setAlert({ type: 'error', message: t('update_failed' as any) })
        } finally {
            setReevaluating(false)
            setTimeout(() => setAlert(null), 3000)
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

    if (loading) return <LoadingSpinner />

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ marginBottom: '2rem' }}>
                <button aria-label={t('go_back')}
                    onClick={() => router.back()}
                    className="glass"
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '0.75rem',
                        color: 'var(--brand-primary-text)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        border: '1px solid var(--veil-40)',
                        transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`,
                        float: locale === 'ar' ? 'right' : 'left',
                        marginInlineEnd: '1.25rem',
                        cursor: 'pointer',
                        padding: 0
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.transform = `translateY(-4px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        e.currentTarget.style.background = 'var(--panel-90)'
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.transform = `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        e.currentTarget.style.background = 'var(--panel-70)'
                    }}
                    title={t('back_to_employees')}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem',
                    flexWrap: 'wrap',
                    marginBottom: '1rem'
                }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                            onClick={() => setActiveTab('SALARY')}
                            className={`btn ${activeTab === 'SALARY' ? 'btn-primary' : 'glass'}`}
                            style={{ borderRadius: '1rem', padding: '0.5rem 1.5rem', height: '42px' }}
                        >
                            {canSeeSalary ? t('salary_label' as any) : t('history')}
                        </button>
                        <button
                            onClick={() => setActiveTab('DAY_OFF')}
                            className={`btn ${activeTab === 'DAY_OFF' ? 'btn-primary' : 'glass'}`}
                            style={{ borderRadius: '1rem', padding: '0.5rem 1.5rem', height: '42px' }}
                        >
                            {t('day_off_credit_tab' as any) || 'Day Off Credit'}
                        </button>
                        <button
                            onClick={() => setActiveTab('COSTS')}
                            className={`btn ${activeTab === 'COSTS' ? 'btn-primary' : 'glass'}`}
                            style={{ borderRadius: '1rem', padding: '0.5rem 1.5rem', height: '42px' }}
                        >
                            {t('costs_tab' as any) || 'Costs'}
                        </button>
                    </div>
                    {canAdjust && activeTab === 'SALARY' && (
                        <button
                            onClick={() => setIsAdjustmentsModalOpen(true)}
                            className="btn btn-primary"
                        >
                            {t('manage_adjustments' as any)}
                        </button>
                    )}
                    {canReevaluateDayOff && activeTab === 'DAY_OFF' && (
                        <button
                            onClick={() => setIsManageDeductionsOpen(true)}
                            className="btn btn-primary"
                        >
                            {t('manage_deductions' as any) || 'Manage Deductions'}
                        </button>
                    )}
                </div>
                {employee && (
                    <div style={{ fontSize: '1.2rem', color: 'var(--text-muted)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        <p style={{ margin: 0 }}>{t('for_label')}: <strong>{employee.firstName} {employee.lastName}</strong></p>
                        {activeTab === 'SALARY' ? (
                            <>
                                {employee.salary !== undefined && (
                                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '1rem' }}>{t('current_base_salary')}: <strong>{employee.salary} {t('egp')}</strong></p>
                                )}
                                {settlements.length > 0 && (
                                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.95rem' }}>
                                        {t('doc_settlements')}:{' '}
                                        {settlements.map((s, i) => (
                                            <span key={s.id}>
                                                {i > 0 && ', '}
                                                <Link
                                                    href={`/dashboard/documents/settlement/${s.id}`}
                                                    prefetch={false}
                                                    style={{ color: 'var(--accent-solid)', textDecoration: 'underline' }}
                                                >
                                                    <SafeDate date={s.lastWorkingDay} locale={locale} />
                                                </Link>
                                            </span>
                                        ))}
                                    </p>
                                )}

                                {/* Closed debts are listed too. A list of open
                                    ones answers what is left; this answers what
                                    happened, and a written-off debt is the entry
                                    most worth being able to find a year later. */}
                                {debts.length > 0 && (
                                    <div style={{ marginTop: '0.75rem' }}>
                                        <div style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: '0.35rem' }}>
                                            {t('debts_title')}
                                        </div>
                                        {debts.map(d => (
                                            <div key={d.id} style={{ fontSize: '0.9rem', padding: '0.2rem 0' }}>
                                                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                                                    {d.status === 'OUTSTANDING' ? d.outstanding.toFixed(2) : d.amount.toFixed(2)}
                                                </strong>{' '}
                                                <span style={{
                                                    fontSize: '0.75rem', fontWeight: 600,
                                                    color: d.status === 'OUTSTANDING' ? 'var(--warn-fg)'
                                                        : d.status === 'WAIVED' ? 'var(--text-muted)' : 'var(--ok-fg)',
                                                }}>
                                                    {t(`debt_status_${d.status}` as any)}
                                                </span>
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginInlineStart: '0.5rem' }}>
                                                    {d.recovered > 0 && `${t('debt_recovered_so_far').replace('{n}', d.recovered.toFixed(2))} · `}
                                                    {d.writtenOff > 0 && `${t('debt_written_off').replace('{n}', d.writtenOff.toFixed(2))} · `}
                                                    <SafeDate date={d.dueDate} locale={locale} />
                                                    {d.reason ? ` · ${d.reason}` : ''}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </>
                        ) : activeTab === 'DAY_OFF' ? (
                            dayOffHistory && (
                                <p style={{ margin: '0.25rem 0 0 0', fontSize: '1rem' }}>
                                    {t('assigned_day_off_credit_label' as any) || 'Assigned Credit'}: <strong>{dayOffHistory.baseCredit}</strong> |
                                    {t('remaining_day_off_credit_label' as any) || ' Remaining'}: <strong style={{ color: 'var(--ok-fg)' }}>{dayOffHistory.remainingCredit}</strong>
                                </p>
                            )
                        ) : null}
                    </div>
                )}
            </div>

            {/* Alert Toast */}
            {alert && (
                <div style={{
                    position: 'fixed',
                    top: '2rem',
                    right: '2rem',
                    zIndex: 2000,
                    padding: '1rem 1.5rem',
                    borderRadius: '1rem',
                    background: alert.type === 'success' ? 'var(--ok-bg)' : 'var(--danger-bg)',
                    color: alert.type === 'success' ? 'var(--ok-fg)' : 'var(--danger-fg)',
                    boxShadow: '0 10px 15px -3px var(--shadow-weak)',
                    // 0x33/255 is 20%. Written as color-mix rather than an
                    // eight-digit hex so the colour itself can be a token:
                    // var(--ok-fg)33 is not a colour.
                    border: `1px solid ${alert.type === 'success'
                        ? 'color-mix(in srgb, var(--ok-fg) 20%, transparent)'
                        : 'color-mix(in srgb, var(--danger-fg) 20%, transparent)'}`,
                    animation: 'slideInRight 0.3s ease-out'
                }}>
                    {alert.message}
                </div>
            )}

            {activeTab === 'SALARY' ? (
                <div className="card" style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                        <thead>
                            <tr style={{ background: 'var(--surface-subtle)', borderBottom: '2px solid var(--border)' }}>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('month_year_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('base_salary_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('values_net_total_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('deduction_days_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('bonus_days_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('calculated_salary_column')}</th>
                                <th style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('details_column')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {records.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-soft)' }}>
                                        {t('no_records_found')}
                                    </td>
                                </tr>
                            ) : (
                                records.map(record => {
                                    // Net Days = Total - Deductions
                                    const netDays = record.totalDays - record.deductions
                                    const fractionDisplay = netDays % 1 !== 0 ? netDays.toFixed(2) : netDays

                                    // H1: this used to be a second payroll calculation, written
                                    // inline — base ÷ days × payable days — which knew nothing about
                                    // employment timelines, mid-month rate changes, suspensions or
                                    // debt recovery, and disagreed with the payslip for every month
                                    // where any of those happened. The figure now comes from the API,
                                    // which reads the payslip where payroll produced one and falls
                                    // back to that same estimate only for months predating it.
                                    const figure = record.figure
                                    const baseSalaryToUse = record.baseSalary || employee?.salary || 0
                                    const calculatedSalary = (figure?.netMinor ?? 0) / 100
                                    const isEstimate = !figure || figure.source === 'ESTIMATE'

                                    const formattedCalculated = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(calculatedSalary)
                                    const formattedBase = new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(baseSalaryToUse)

                                    return (
                                        <tr key={record.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ padding: '1rem', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {getMonthName(record.month)} {record.year}
                                            </td>
                                            <td style={{ padding: '1rem', color: 'var(--text-muted)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {formattedBase}
                                            </td>
                                            <td style={{ padding: '1rem', fontSize: '1.1rem', color: 'var(--text-strong)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                <span style={{ fontWeight: 'bold' }}>{fractionDisplay}</span>
                                                <span style={{ color: 'var(--text-faint)' }}> / {record.totalDays}</span>
                                            </td>
                                            <td style={{ padding: '1rem', color: 'var(--danger-solid-hover)', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {record.deductions > 0 ? `-${formatDays(record.deductions)}` : '-'}
                                            </td>
                                            <td style={{ padding: '1rem', color: 'var(--accent-solid-deep)', fontWeight: '500', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {record.bonusDays ? `+${formatDays(record.bonusDays)}` : '-'}
                                            </td>
                                            <td style={{ padding: '1rem', fontWeight: '600', color: 'var(--ok-fg)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {formattedCalculated}
                                                {/* Said, rather than left to be assumed. An estimate
                                                    that looks identical to a settled figure is the
                                                    reason this screen and the payslip could disagree
                                                    for months without anybody noticing. */}
                                                {isEstimate ? (
                                                    <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-faint)' }}>
                                                        {t('salary_figure_estimate')}
                                                    </div>
                                                ) : (
                                                    <a
                                                        href={`/dashboard/documents/payslip/${figure!.source === 'PAYSLIP' ? figure!.payslipId : ''}`}
                                                        style={{ display: 'block', fontSize: '0.7rem', fontWeight: 400, color: 'var(--brand-primary-text)' }}
                                                    >
                                                        {t('salary_figure_payslip')}
                                                    </a>
                                                )}
                                            </td>
                                            <td style={{ padding: '1rem', color: 'var(--text-soft)', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                                {t('created_label')}: <SafeDate date={record.createdAt} locale={locale} format="dateOnly" />
                                            </td>
                                        </tr>
                                    )
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            ) : activeTab === 'COSTS' ? (
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
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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
                                            <span style={{ fontSize: '0.8rem', color: 'var(--danger-solid)', fontWeight: 'bold', flexShrink: 0 }}>
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
                                onClick={async () => {
                                    const target = reversing
                                    setReversing(null)
                                    await handleUndo(target.id, 'reverse', reverseReason)
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
                                disabled={loading}
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
                                                <div style={{ fontWeight: '800', fontSize: '1.2rem', color: 'var(--danger-solid-hover)' }}>-{req.daysDeducted}</div>
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
        </div>
    )
}
