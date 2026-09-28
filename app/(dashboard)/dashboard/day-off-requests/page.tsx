'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { useHeader } from '@/context/HeaderContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import DateRangePicker from '@/components/DateRangePicker'
import DatePickerSingle from '@/components/DatePickerSingle'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useCompany } from '@/context/CompanyContext'
import Pagination from '@/components/Pagination'
import { fetcher } from '@/lib/swr-fetcher'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useCan } from '@/lib/useCan'

// Badge color + translation key per type, keyed once here rather than as a
// chained ternary — REGULAR/CASUAL/SICK are reachable from the request
// form below; EMERGENCY/UNPAID are valid DayOffType values with no form
// entry point yet, kept here so an existing/future row of either still
// renders correctly instead of silently falling back to "Regular."
const DAY_OFF_TYPE_STYLE: Record<string, { bg: string; color: string; labelKey: string }> = {
    REGULAR: { bg: 'var(--info-bg)', color: 'var(--info-fg)', labelKey: 'regular_day_off' },
    CASUAL: { bg: 'var(--lifetime-bg)', color: 'var(--accent-fg)', labelKey: 'casual_day_off' },
    SICK: { bg: 'var(--danger-bg)', color: 'var(--danger-fg-strong)', labelKey: 'sick_day_off' },
    EMERGENCY: { bg: 'var(--warn-bg-warm)', color: 'var(--warn-fg-warm-strong)', labelKey: 'emergency_day_off' },
    UNPAID: { bg: 'var(--surface-sunk)', color: 'var(--text-muted)', labelKey: 'unpaid_day_off' },
}

interface DayOffRequest {
    id: string
    userId: string
    type: 'REGULAR' | 'SICK' | 'EMERGENCY' | 'UNPAID' | 'CASUAL'
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    reason: string | null
    rejectionReason?: string | null
    date: string
    endDate?: string | null
    daysDeducted: number
    deductionType?: 'CREDIT' | 'SALARY' | null
    createdAt: string
    user?: {
        firstName: string
        lastName: string
        dayOffCredit: number
        teamLeaderId?: string | null
    }
}

export default function DayOffRequestsPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const modules = useModules()
    const { data: session, status } = useSession()
    const user = session?.user
    // The manager's view — the company's requests, not one's own — is for
    // those who may see them; deciding one is narrower still.
    const { can, canFor } = useCan()
    const managesRequests = can('dayoff.view')
    const canDecide = can('dayoff.approve')
    const { selectedCompanyId: contextCompanyId } = useCompany()

    const [selectedRequest, setSelectedRequest] = useState<any | null>(null)
    const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false)
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false)
    const [isRequestModalOpen, setIsRequestModalOpen] = useState(false)
    const [daysToDeduct, setDaysToDeduct] = useState('')
    const [chosenDeduction, setDeductionType] = useState<'CREDIT' | 'SALARY'>('CREDIT')
    const [rejectionReason, setRejectionReason] = useState('')

    // New Request Form State
    const [reqDate, setReqDate] = useState('')
    const [reqEndDate, setReqEndDate] = useState('')
    const [reqType, setReqType] = useState<'REGULAR' | 'SICK' | 'CASUAL'>('REGULAR')
    const [reqReason, setReqReason] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

    // Filter State
    const [filters, setFilters] = useState({
        employeeId: '',
        dateFrom: '',
        dateTo: '',
        status: '',
        search: ''
    })

    const [page, setPage] = useState(1)
    const limit = 10
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    // Shown for six seconds after arriving via ?highlight=. See
    // lib/useFadingHighlight.ts for why this is not an effect any more.
    const visualHighlightId = useFadingHighlight(highlightId, 6000)

    // F-25: was two useCallback+useEffect fetch cycles gated on
    // status === 'authenticated'. SWR's key itself is the gate — null
    // until authenticated, so no fetch happens before then, matching the
    // original guard exactly.
    const requestsQuery = (() => {
        if (status !== 'authenticated') return null
        const endpoint = managesRequests ? '/api/admin/day-off-requests' : '/api/day-off-requests'
        const queryParams = new URLSearchParams()
        if (managesRequests && contextCompanyId) {
            queryParams.set('companyId', contextCompanyId)
        }
        queryParams.set('page', page.toString())
        queryParams.set('limit', limit.toString())
        return `${endpoint}?${queryParams.toString()}`
    })()
    const { data: requestsResult, isLoading: loading, mutate: fetchRequests } = useSWR(requestsQuery, fetcher)
    const requests: DayOffRequest[] = requestsResult?.data?.data || requestsResult?.data || []
    const total: number = requestsResult?.data?.total || (Array.isArray(requestsResult?.data) ? requestsResult.data.length : 0)
    const totalPages: number = requestsResult?.data?.totalPages || 1

    // User Credit Info — only ever needed for non-admins viewing their own
    // request history.
    const userCreditQuery = status === 'authenticated' && !managesRequests && user?.id ? `/api/users?id=${user.id}` : null
    const { data: userCreditResult } = useSWR(userCreditQuery, fetcher)
    const foundUser = (() => {
        const data = userCreditResult?.data
        if (!data) return null
        return Array.isArray(data.data) ? data.data[0] : (data?.id ? data : null)
    })()
    const userCredit: number = foundUser?.dayOffCredit || 0
    const baseCredit: number = (foundUser?.baseDayOffCredit !== undefined && foundUser?.baseDayOffCredit !== null) ? foundUser.baseDayOffCredit : (foundUser?.dayOffCredit || 0)

    useEffect(() => {
        setTitle(modules.label('dayOff'))
        setSubtitle(t('day_off_requests_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t, modules])

    // Scroll to highlighted request. Depends on requests.length rather than
    // `requests` itself — the derived array below gets a new reference on
    // every render (a fresh `[]` fallback whenever there's no SWR data
    // yet), which would otherwise re-fire this effect every render instead
    // of only when the highlighted request set actually changes.
    useEffect(() => {
        if (highlightId && !loading && requests.length > 0) {
            const element = document.getElementById(`request-${highlightId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [highlightId, loading, requests.length]);

    // When the credit can't cover the days being deducted, the deduction comes
    // out of salary whatever was picked. Derived on every render rather than
    // written back into state by an effect: the effect version rendered (and
    // could submit) CREDIT for one pass before correcting itself.
    const creditShort = !!selectedRequest && (parseFloat(daysToDeduct) || 0) > (selectedRequest.user?.dayOffCredit || 0)
    const deductionType: 'CREDIT' | 'SALARY' = creditShort ? 'SALARY' : chosenDeduction

    const showAlert = (type: 'success' | 'error', message: string) => {
        setAlert({ type, message })
        setTimeout(() => setAlert(null), 3000)
    }

    const handleSubmitRequest = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            const res = await fetch('/api/day-off-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: reqDate,
                    // undefined, not null — JSON.stringify() drops an undefined
                    // key entirely, satisfying the schema's z.string().optional()
                    // (which accepts undefined but rejects null). CASUAL/SICK/
                    // EMERGENCY/UNPAID requests have no end date at all.
                    endDate: reqType === 'REGULAR' ? reqEndDate : undefined,
                    type: reqType,
                    reason: reqReason
                })
            })
            if (res.ok) {
                showAlert('success', t('request_submitted_success' as any))
                setIsRequestModalOpen(false)
                fetchRequests()
                // Reset form
                setReqDate('')
                setReqEndDate('')
                setReqReason('')
            } else {
                const err = await res.text()
                showAlert('error', err || t('failed_submit_request' as any))
            }
        } catch {
            showAlert('error', t('error_generic'))
        } finally {
            setSubmitting(false)
        }
    }

    const calculateWorkDays = (start: string, end?: string | null) => {
        const startDate = new Date(start)
        startDate.setHours(0, 0, 0, 0)
        const endDate = end ? new Date(end) : new Date(start)
        endDate.setHours(0, 0, 0, 0)

        let count = 0
        const current = new Date(startDate)
        while (current <= endDate) {
            if (current.getDay() !== 5) { // 5 is Friday
                count++
            }
            current.setDate(current.getDate() + 1)
        }
        return count
    }

    const handleAction = async (requestId: string, status: 'APPROVED' | 'REJECTED') => {
        const req = requests.find(r => r.id === requestId)
        setSelectedRequest(req || null)
        setDeductionType('CREDIT')

        if (status === 'APPROVED' && req) {
            const days = calculateWorkDays(req.date, req.endDate)
            setDaysToDeduct(days.toString())
            setIsApprovalModalOpen(true)
        } else if (status === 'REJECTED') {
            setRejectionReason('')
            setIsRejectModalOpen(true)
        }
    }

    const processAction = async (requestId: string, status: 'APPROVED' | 'REJECTED', deduction?: string, type?: 'CREDIT' | 'SALARY') => {
        try {
            const res = await fetch(`/api/admin/day-off-requests/${requestId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status,
                    daysToDeduct: deduction,
                    deductionType: type,
                    // Only sent on a rejection; the schema caps it at 300 chars
                    // and treats an empty string as "no reason given".
                    ...(status === 'REJECTED' ? { rejectionReason: rejectionReason.trim() } : {})
                })
            })
            if (res.ok) {
                showAlert('success', t('request_action_success' as any))
                setIsApprovalModalOpen(false)
                setIsRejectModalOpen(false)
                fetchRequests()
            } else {
                showAlert('error', t('error_generic'))
            }
        } catch {
            showAlert('error', t('error_generic'))
        }
    }

    // Pie Chart Data
    const usedByCredit = Math.max(0, baseCredit - userCredit)

    const formatDays = (days: number) => {
        if (locale === 'ar') {
            if (days === 1) return t('day_singular' as any)
            if (days === 2) return t('day_dual')
            return `${days} ${t('days_label')}`
        }
        return `${days} ${days === 1 ? t('day_singular' as any) : t('days_label')}`
    }

    // Filter Logic
    const filteredRequests = requests.filter(req => {
        const matchesEmployee = !filters.employeeId || req.userId === filters.employeeId
        const matchesStatus = !filters.status || req.status === filters.status
        const matchesSearch = !filters.search ||
            (req.reason || '').toLowerCase().includes(filters.search.toLowerCase())

        let matchesDate = true
        if (filters.dateFrom || filters.dateTo) {
            const rDate = new Date(req.date)
            rDate.setHours(0, 0, 0, 0)
            if (filters.dateFrom) {
                const fDate = new Date(filters.dateFrom)
                fDate.setHours(0, 0, 0, 0)
                if (rDate < fDate) matchesDate = false
            }
            if (filters.dateTo) {
                const tDate = new Date(filters.dateTo)
                tDate.setHours(0, 0, 0, 0)
                if (rDate > tDate) matchesDate = false
            }
        }

        return matchesEmployee && matchesStatus && matchesSearch && matchesDate
    })



    const pieData = [
        { name: t('remaining_credit' as any), value: userCredit },
        { name: t('used_credit' as any), value: usedByCredit }
    ]
    const COLORS = ['var(--ok-solid)', 'var(--danger-solid)']

    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {alert && (
                <div style={{
                    position: 'fixed',
                    top: '2rem',
                    right: locale === 'ar' ? 'auto' : '2rem',
                    left: locale === 'ar' ? '2rem' : 'auto',
                    padding: '0.75rem 1.25rem',
                    borderRadius: '0.5rem',
                    background: alert.type === 'success' ? 'var(--ok-bg)' : 'var(--danger-bg)',
                    color: alert.type === 'success' ? 'var(--ok-fg)' : 'var(--danger-fg)',
                    border: `1px solid ${alert.type === 'success' ? 'var(--ok-border)' : 'var(--danger-border-firm)'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    boxShadow: '0 4px 6px -1px var(--shadow-weak), 0 2px 4px -1px var(--shadow-faint)',
                    zIndex: 1000,
                    width: 'calc(100vw - 3rem)',
                    minWidth: '200px',
                    maxWidth: '350px',
                    animation: 'slideInRight 0.3s ease-out'
                }}>
                    <span style={{ fontSize: '1rem' }}>
                        {alert.type === 'success' ? '✓' : '✕'}
                    </span>
                    {alert.message}
                </div>
            )}
            <EmployeeFilter
                onFilterChange={(newFilters) => setFilters(prev => ({ ...prev, ...newFilters }))}
                selectedEmployeeId={filters.employeeId}
                dateFrom={filters.dateFrom}
                dateTo={filters.dateTo}
                selectedStatus={filters.status}
                searchQuery={filters.search}
                isEmployee={!managesRequests}
                hideSearch={false}
                placeholder={locale === 'ar' ? 'بحث في السبب' : 'Search Reason'}
                totalCount={total}
                allowedStatuses={['PENDING', 'APPROVED', 'REJECTED']}
                primaryAction={
                    !managesRequests ? (
                        <button onClick={() => setIsRequestModalOpen(true)} className="btn btn-primary" style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}>
                            {t('request_day_off' as any)}
                        </button>
                    ) : null
                }
            />

            <div className={managesRequests ? "" : "responsive-sidebar-grid"} style={{ display: managesRequests ? 'grid' : undefined, gridTemplateColumns: managesRequests ? '1fr' : undefined, gap: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* User Credit Stats - Mobile only */}
                    {!managesRequests && (
                        <div className="show-on-mobile" style={{ display: 'none', width: '100%', marginBottom: '0.5rem', marginTop: '-0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', width: '100%' }}>
                                {(() => {
                                    const totalCredit = baseCredit;
                                    const percentage = totalCredit > 0 ? userCredit / totalCredit : 1;

                                    let colors = { bg: 'var(--ok-bg)', text: 'var(--ok-fg)', border: 'var(--ok-bg-strong)' }; // Green
                                    if (percentage < 0.3) {
                                        colors = { bg: 'var(--danger-bg-subtle)', text: 'var(--danger-fg)', border: 'var(--danger-border)' }; // Red
                                    } else if (percentage < 0.6) {
                                        colors = { bg: 'var(--warn-bg-warm-subtle)', text: 'var(--warn-fg-warm)', border: 'var(--warn-border-warm)' }; // Orange
                                    }

                                    return (
                                        <div style={{
                                            background: colors.bg,
                                            border: `1.5px solid ${colors.border}`,
                                            borderRadius: '1rem',
                                            padding: '0.6rem 0.875rem',
                                            textAlign: 'center',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            gap: '0.1rem',
                                            boxShadow: '0 2px 4px -1px var(--shadow-faint)',
                                            width: 'fit-content'
                                        }}>
                                            <span style={{ fontSize: '0.6rem', fontWeight: '800', color: colors.text, opacity: 0.8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                {t('remaining_day_off_credit' as any)}
                                            </span>
                                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.25rem' }}>
                                                <span style={{ fontSize: '1.5rem', fontWeight: '900', color: colors.text, lineHeight: 1 }}>
                                                    {userCredit}
                                                </span>
                                                <span style={{ fontSize: '0.75rem', fontWeight: '700', color: colors.text, opacity: 0.8 }}>
                                                    {t('days_label')}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <LoadingSpinner message={t('loading_requests')} />
                    ) : filteredRequests.length === 0 ? (
                        <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500">
                            <span className="text-5xl mb-4">{modules.icon('dayOff')}</span>
                            <h3 className="text-xl font-bold text-slate-800">{t('no_records_found')}</h3>
                            <p className="max-w-xs mx-auto mt-2 text-slate-500">
                                {(filters.search || filters.status || filters.employeeId) ? (t('no_search_results' as any) || 'No results match your filters') : ''}
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(350px, 100%), 1fr))', gap: '1rem' }}>
                            {filteredRequests.map((req, index) => (
                                <div
                                    key={req.id}
                                    id={`request-${req.id}`}
                                    className={`glass-card hover:bg-white/60 transition-all duration-300 p-5 border border-white/40 shadow-sm relative overflow-hidden flex flex-col gap-4 ${visualHighlightId === req.id ? 'highlight-pulse' : ''}`}
                                    style={{
                                        animation: visualHighlightId === req.id ? 'none' : 'fadeIn 0.4s ease-out forwards',
                                        animationDelay: `${index * 50}ms`,
                                        borderInlineStart: visualHighlightId === req.id ? '4px solid var(--accent-solid)' : '',
                                        background: visualHighlightId === req.id ? 'var(--highlight-tint)' : ''
                                    }}
                                >
                                    {/* Card Header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            {managesRequests && (
                                                <h3 className="text-lg font-bold text-slate-800 leading-tight">
                                                    {req.user?.firstName} {req.user?.lastName}
                                                </h3>
                                            )}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-soft)', fontSize: '0.85rem', fontWeight: '600' }}>
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                                    <line x1="16" y1="2" x2="16" y2="6"></line>
                                                    <line x1="8" y1="2" x2="8" y2="6"></line>
                                                    <line x1="3" y1="10" x2="21" y2="10"></line>
                                                </svg>
                                                {new Date(req.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                                                {req.endDate && new Date(req.endDate).getTime() > new Date(req.date).getTime() + 86400000 && (
                                                    <> - {new Date(req.endDate).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}</>
                                                )}
                                            </div>
                                        </div>
                                        <span style={{
                                            padding: '0.375rem 0.875rem',
                                            borderRadius: '1rem',
                                            fontSize: '0.8rem',
                                            fontWeight: '800',
                                            textTransform: 'uppercase',
                                            letterSpacing: '0.025em',
                                            background: req.status === 'APPROVED' ? 'var(--ok-bg)' : req.status === 'REJECTED' ? 'var(--danger-bg)' : 'var(--warn-bg-yellow)',
                                            color: req.status === 'APPROVED' ? 'var(--ok-fg)' : req.status === 'REJECTED' ? 'var(--danger-fg)' : 'var(--warn-fg-yellow)',
                                            boxShadow: '0 2px 4px var(--shadow-faint)'
                                        }}>
                                            {t(`status_${req.status.toLowerCase()}` as any)}
                                        </span>
                                    </div>

                                    {/* Card Content */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                            <span style={{
                                                padding: '0.25rem 0.625rem',
                                                borderRadius: '0.5rem',
                                                fontSize: '0.75rem',
                                                fontWeight: '700',
                                                background: (DAY_OFF_TYPE_STYLE[req.type] || DAY_OFF_TYPE_STYLE.REGULAR).bg,
                                                color: (DAY_OFF_TYPE_STYLE[req.type] || DAY_OFF_TYPE_STYLE.REGULAR).color
                                            }}>
                                                {t((DAY_OFF_TYPE_STYLE[req.type] || DAY_OFF_TYPE_STYLE.REGULAR).labelKey as any)}
                                            </span>
                                            {/* Applied Days Badge - Always Visible */}
                                            <span style={{
                                                padding: '0.25rem 0.625rem',
                                                borderRadius: '0.5rem',
                                                fontSize: '0.75rem',
                                                fontWeight: '700',
                                                background: 'var(--surface-subtle)',
                                                color: 'var(--text-soft)',
                                                border: '1px solid var(--border)'
                                            }}>
                                                {formatDays(calculateWorkDays(req.date, req.endDate))}
                                            </span>
                                            {req.status === 'APPROVED' && (
                                                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        padding: '0.25rem 0.625rem',
                                                        borderRadius: '0.5rem',
                                                        background: req.deductionType === 'SALARY' ? 'var(--danger-bg)' : 'var(--ok-bg)',
                                                        color: req.deductionType === 'SALARY' ? 'var(--danger-fg)' : 'var(--ok-fg)',
                                                        fontWeight: '700',
                                                        border: `1px solid ${req.deductionType === 'SALARY' ? 'var(--danger-border-firm)' : 'var(--ok-border)'}`
                                                    }}>
                                                        {formatDays(req.daysDeducted || 0)} {t('deduct_from_label' as any)} {req.deductionType === 'SALARY' ? t('deduct_from_salary' as any) : t('deduct_from_credit' as any)}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                        {req.reason ? (
                                            <div style={{
                                                margin: 0,
                                                fontSize: '0.9rem',
                                                color: 'var(--text-muted)',
                                                lineHeight: '1.5',
                                                background: 'var(--hairline)',
                                                padding: '0.75rem',
                                                borderRadius: '0.75rem',
                                                fontStyle: 'italic',
                                                maxHeight: '80px', // Lower threshold
                                                overflowY: 'auto',
                                                overflowWrap: 'anywhere', // Better for long strings while keeping words whole
                                                scrollbarWidth: 'thin',
                                                display: 'block'
                                            }}>
                                                &quot;{req.reason}&quot;
                                            </div>
                                        ) : (
                                            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>
                                                {t('no_reason_provided')}
                                            </p>
                                        )}
                                        {req.status === 'REJECTED' && req.rejectionReason && (
                                            <div style={{
                                                fontSize: '0.85rem',
                                                color: 'var(--danger-fg)',
                                                lineHeight: '1.5',
                                                background: 'var(--danger-bg-subtle)',
                                                border: '1px solid var(--danger-border)',
                                                padding: '0.75rem',
                                                borderRadius: '0.75rem',
                                                maxHeight: '80px',
                                                overflowY: 'auto',
                                                overflowWrap: 'anywhere',
                                                scrollbarWidth: 'thin'
                                            }}>
                                                <strong>{t('rejected_reason_prefix' as any)}:</strong> {req.rejectionReason}
                                            </div>
                                        )}
                                        <div style={{
                                            fontSize: '0.75rem',
                                            color: 'var(--text-faint)',
                                            fontStyle: 'italic',
                                            display: 'flex',
                                            gap: '0.35rem',
                                            marginTop: '0.25rem',
                                            justifyContent: 'flex-start'
                                        }}>
                                            <span>{locale === 'ar' ? 'تم الطلب في:' : 'Requested on:'}</span>
                                            <span>
                                                {new Date(req.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: true })}, {new Date(req.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Card Actions (Admin only) */}
                                    {canDecide && req.status === 'PENDING' && canFor('dayoff.approve', req.userId, req.user?.teamLeaderId) && (
                                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px dashed var(--border)' }}>
                                            <button
                                                onClick={() => handleAction(req.id, 'APPROVED')}
                                                className="btn"
                                                style={{
                                                    flex: 1,
                                                    background: 'var(--ok-solid)',
                                                    color: 'var(--text-on-accent)',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '700',
                                                    height: '40px',
                                                    borderRadius: '0.75rem'
                                                }}
                                            >
                                                {t('approve_button')}
                                            </button>
                                            <button
                                                onClick={() => handleAction(req.id, 'REJECTED')}
                                                className="btn"
                                                style={{
                                                    flex: 1,
                                                    background: 'var(--danger-solid)',
                                                    color: 'var(--text-on-accent)',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '700',
                                                    height: '40px',
                                                    borderRadius: '0.75rem'
                                                }}
                                            >
                                                {t('reject_button')}
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <Pagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={(p) => setPage(p)}
                    />
                </div>

                {!managesRequests && (
                    <div className="hide-on-mobile" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        <div className="card" style={{ height: 'fit-content' }}>
                            <h2 className="text-xl font-semibold mb-4">{t('credit_overview' as any)}</h2>
                            <div style={{ height: '250px' }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                                <p style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--ok-solid)' }}>{formatDays(userCredit)}</p>
                                <p style={{ fontSize: '0.85rem', color: 'var(--text-soft)' }}>{t('remaining_credit' as any)}</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Request Modal */}
            {isRequestModalOpen && (
                <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 'min(calc(100vw - 3rem), 400px)' }}>
                        <h2 className="text-xl font-bold mb-4">{t('request_day_off' as any)}</h2>
                        <form onSubmit={handleSubmitRequest}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('day_off_type' as any)}</label>
                                <select className="input" value={reqType} onChange={e => {
                                    setReqType(e.target.value as any);
                                    setReqDate('');
                                    setReqEndDate('');
                                }}>
                                    <option value="REGULAR">{t('regular_day_off' as any)}</option>
                                    <option value="CASUAL">{t('casual_day_off' as any)}</option>
                                    <option value="SICK">{t('sick_day_off' as any)}</option>
                                </select>
                            </div>
                            {reqType === 'REGULAR' ? (
                                <div style={{ marginBottom: '1rem' }}>
                                    <DateRangePicker
                                        label={locale === 'ar' ? 'تاريخ الإجازة' : 'Date Range'}
                                        dateFrom={reqDate}
                                        dateTo={reqEndDate}
                                        onChange={(from, to) => {
                                            setReqDate(from);
                                            setReqEndDate(to);
                                        }}
                                    />
                                </div>
                            ) : (
                                <div style={{ marginBottom: '1rem' }}>
                                    <DatePickerSingle
                                        label={t('select_date' as any)}
                                        value={reqDate}
                                        onChange={date => {
                                            setReqDate(date);
                                            setReqEndDate(date);
                                        }}
                                    />
                                </div>
                            )}
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('reason_label' as any)}</label>
                                <textarea
                                    className="input"
                                    style={{ height: '80px', resize: 'none' }}
                                    placeholder={t('reason_placeholder' as any)}
                                    value={reqReason}
                                    onChange={e => setReqReason(e.target.value)}
                                    maxLength={100}
                                />
                                <div style={{
                                    fontSize: '0.75rem',
                                    color: reqReason.length >= 100 ? 'var(--danger-solid)' : 'var(--text-faint)',
                                    textAlign: locale === 'ar' ? 'left' : 'right',
                                    marginTop: '0.25rem'
                                }}>
                                    {reqReason.length}/100
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button type="submit" className="btn btn-primary" disabled={submitting}>
                                    {submitting ? t('creating') : t('confirm')}
                                </button>
                                <button type="button" onClick={() => setIsRequestModalOpen(false)} className="btn">
                                    {t('cancel')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Approval Modal (Deduction Popup) */}
            {isApprovalModalOpen && selectedRequest && (
                <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 'min(calc(100vw - 3rem), 400px)' }}>
                        <h2 className="text-xl font-bold mb-4">{t('approve_deduction_title' as any)}</h2>
                        <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--text-soft)' }}>
                            {selectedRequest.user?.firstName} {selectedRequest.user?.lastName} - {t('day_off_credit')}: {selectedRequest.user?.dayOffCredit}
                        </p>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('days_to_deduct_label' as any)}</label>
                            <input
                                type="number"
                                className="input"
                                value={daysToDeduct}
                                onChange={e => setDaysToDeduct(e.target.value)}
                                min="0"
                                step="0.5"
                            />
                        </div>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <label style={{ fontSize: '0.875rem', fontWeight: '500', color: 'var(--text-soft)' }}>{t('deduct_from_label' as any)}</label>
                                {(parseFloat(daysToDeduct) || 0) > (selectedRequest.user?.dayOffCredit || 0) && (
                                    <span style={{ fontSize: '0.7rem', color: 'var(--danger-solid)', fontWeight: 'bold', background: 'var(--danger-bg)', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>
                                        ⚠️ {t('insufficient_credit' as any) || 'Insufficient Credit'}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    onClick={() => setDeductionType('CREDIT')}
                                    disabled={(parseFloat(daysToDeduct) || 0) > (selectedRequest.user?.dayOffCredit || 0)}
                                    style={{
                                        flex: 1,
                                        padding: '0.625rem',
                                        borderRadius: '0.75rem',
                                        border: '1px solid var(--border)',
                                        background: deductionType === 'CREDIT' ? 'var(--info-solid)' : 'var(--surface)',
                                        color: deductionType === 'CREDIT' ? 'var(--text-on-accent)' : 'var(--text-soft)',
                                        cursor: (parseFloat(daysToDeduct) || 0) > (selectedRequest.user?.dayOffCredit || 0) ? 'not-allowed' : 'pointer',
                                        fontWeight: '700',
                                        fontSize: '0.875rem',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        opacity: (parseFloat(daysToDeduct) || 0) > (selectedRequest.user?.dayOffCredit || 0) ? 0.5 : 1
                                    }}
                                >
                                    <span>📅</span> {t('deduct_from_credit' as any)}
                                </button>
                                <button
                                    onClick={() => setDeductionType('SALARY')}
                                    style={{
                                        flex: 1,
                                        padding: '0.625rem',
                                        borderRadius: '0.75rem',
                                        border: '1px solid var(--border)',
                                        background: deductionType === 'SALARY' ? 'var(--info-solid)' : 'var(--surface)',
                                        color: deductionType === 'SALARY' ? 'var(--text-on-accent)' : 'var(--text-soft)',
                                        cursor: 'pointer',
                                        fontWeight: '700',
                                        fontSize: '0.875rem',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem'
                                    }}
                                >
                                    <span>💵</span> {t('deduct_from_salary' as any)}
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => processAction(selectedRequest.id, 'APPROVED', daysToDeduct, deductionType)}
                                className="btn btn-primary"
                            >
                                {t('approve_button')}
                            </button>
                            <button type="button" onClick={() => setIsApprovalModalOpen(false)} className="btn">
                                {t('cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Rejection Confirmation Modal */}
            {isRejectModalOpen && selectedRequest && (
                <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 'min(calc(100vw - 3rem), 400px)' }}>
                        <h2 className="text-xl font-bold mb-4">{t('confirm_rejection_title' as any)}</h2>
                        <p style={{ marginBottom: '1.5rem', color: 'var(--text-soft)' }}>
                            {t('are_you_sure_msg' as any)} {t('reject_button')} {selectedRequest.user?.firstName} {selectedRequest.user?.lastName}?
                        </p>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label htmlFor="rejectionReason" style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>
                                {t('rejection_reason_label' as any)}
                            </label>
                            <textarea
                                id="rejectionReason"
                                value={rejectionReason}
                                onChange={(e) => setRejectionReason(e.target.value)}
                                maxLength={300}
                                placeholder={t('rejection_reason_placeholder' as any)}
                                className="input"
                                // .input pins height to 42px, which clips a
                                // multi-line textarea and makes `rows` a no-op
                                // — the request form's textarea overrides it
                                // the same way.
                                style={{ height: '90px', resize: 'none', lineHeight: '1.4' }}
                            />
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)', textAlign: locale === 'ar' ? 'left' : 'right', marginTop: '0.25rem' }}>
                                {rejectionReason.length}/300
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => processAction(selectedRequest.id, 'REJECTED')}
                                className="btn"
                                style={{ background: 'var(--danger-solid)', color: 'var(--text-on-accent)' }}
                            >
                                {t('reject_button')}
                            </button>
                            <button type="button" onClick={() => setIsRejectModalOpen(false)} className="btn">
                                {t('cancel')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
