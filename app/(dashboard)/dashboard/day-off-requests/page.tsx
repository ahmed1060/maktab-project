'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import DateRangePicker from '@/components/DateRangePicker'
import DatePickerSingle from '@/components/DatePickerSingle'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import EmployeeFilter from '@/components/EmployeeFilter'
import { useCompany } from '@/context/CompanyContext'
import Pagination from '@/components/Pagination'

interface DayOffRequest {
    id: string
    userId: string
    type: 'CASUAL' | 'REGULAR'
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    reason: string | null
    date: string
    endDate?: string | null
    daysDeducted: number
    deductionType?: 'CREDIT' | 'SALARY' | null
    createdAt: string
    user?: {
        firstName: string
        lastName: string
        dayOffCredit: number
    }
}

export default function DayOffRequestsPage() {
    const { t, locale } = useLanguage()
    const { data: session, status } = useSession()
    const user = session?.user
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '')
    const { selectedCompanyId: contextCompanyId } = useCompany()

    const [requests, setRequests] = useState<DayOffRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedRequest, setSelectedRequest] = useState<any | null>(null)
    const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false)
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false)
    const [isRequestModalOpen, setIsRequestModalOpen] = useState(false)
    const [daysToDeduct, setDaysToDeduct] = useState('')
    const [deductionType, setDeductionType] = useState<'CREDIT' | 'SALARY'>('CREDIT')

    // New Request Form State
    const [reqDate, setReqDate] = useState('')
    const [reqEndDate, setReqEndDate] = useState('')
    const [reqType, setReqType] = useState<'CASUAL' | 'REGULAR'>('REGULAR')
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

    // User Credit Info
    const [userCredit, setUserCredit] = useState(0)
    const [baseCredit, setBaseCredit] = useState(0)

    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(0)
    const limit = 10
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    const [visualHighlightId, setVisualHighlightId] = useState<string | null>(highlightId)

    useEffect(() => {
        if (highlightId) {
            setVisualHighlightId(highlightId)
            const timer = setTimeout(() => {
                setVisualHighlightId(null)
            }, 6000)
            return () => clearTimeout(timer)
        } else {
            setVisualHighlightId(null)
        }
    }, [highlightId])

    const fetchRequests = useCallback(async () => {
        setLoading(true)
        try {
            const endpoint = isAdmin ? '/api/admin/day-off-requests' : '/api/day-off-requests'
            const queryParams = new URLSearchParams()
            if (isAdmin && contextCompanyId) {
                queryParams.set('companyId', contextCompanyId)
            }
            queryParams.set('page', page.toString())
            queryParams.set('limit', limit.toString())

            const res = await fetch(`${endpoint}?${queryParams.toString()}`)
            if (res.ok) {
                const result = await res.json()
                setRequests(result.data)
                setTotal(result.total)
                setTotalPages(result.totalPages)
            }
        } catch (error) {
            console.error('Failed to fetch requests', error)
        } finally {
            setLoading(false)
        }
    }, [isAdmin, contextCompanyId, page, limit])

    const fetchUserCredit = useCallback(async () => {
        if (!user?.id) return
        try {
            const res = await fetch(`/api/users?id=${user.id}`)
            if (res.ok) {
                const data = await res.json()
                const foundUser = Array.isArray(data.data) ? data.data[0] : (data.id ? data : null)
                if (foundUser) {
                    setUserCredit(foundUser.dayOffCredit)
                    setBaseCredit(foundUser.baseDayOffCredit || foundUser.dayOffCredit)
                }
            }
        } catch (error) {
            console.error('Failed to fetch user credit', error)
        }
    }, [user?.id])

    useEffect(() => {
        if (status === 'authenticated') {
            fetchRequests()
            if (!isAdmin && user?.id) {
                fetchUserCredit()
            }
        }
    }, [status, fetchRequests, fetchUserCredit, isAdmin, user?.id])

    // Scroll to highlighted request
    useEffect(() => {
        if (highlightId && !loading && requests.length > 0) {
            const element = document.getElementById(`request-${highlightId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [highlightId, loading, requests]);

    // SECURE: Automatically switch deduction type if credit is insufficient
    useEffect(() => {
        if (isApprovalModalOpen && selectedRequest && deductionType === 'CREDIT') {
            const deduction = parseFloat(daysToDeduct) || 0;
            const credit = selectedRequest.user?.dayOffCredit || 0;
            if (deduction > credit) {
                setDeductionType('SALARY');
            }
        }
    }, [daysToDeduct, selectedRequest, isApprovalModalOpen, deductionType]);

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
                    endDate: reqType === 'REGULAR' ? reqEndDate : null,
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
        } catch (error) {
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
            setIsRejectModalOpen(true)
        }
    }

    const processAction = async (requestId: string, status: 'APPROVED' | 'REJECTED', deduction?: string, type?: 'CREDIT' | 'SALARY') => {
        try {
            const res = await fetch(`/api/admin/day-off-requests/${requestId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, daysToDeduct: deduction, deductionType: type })
            })
            if (res.ok) {
                showAlert('success', t('request_action_success' as any))
                setIsApprovalModalOpen(false)
                setIsRejectModalOpen(false)
                fetchRequests()
            } else {
                showAlert('error', t('error_generic'))
            }
        } catch (error) {
            showAlert('error', t('error_generic'))
        }
    }

    // Pie Chart Data
    const usedByCredit = Math.max(0, baseCredit - userCredit)

    const formatDays = (days: number) => {
        if (locale === 'ar') {
            if (days === 1) return t('day_singular' as any)
            if (days === 2) return t('day_dual' as any)
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
    const COLORS = ['#10b981', '#ef4444']

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
                    background: alert.type === 'success' ? '#dcfce7' : '#fee2e2',
                    color: alert.type === 'success' ? '#166534' : '#991b1b',
                    border: `1px solid ${alert.type === 'success' ? '#86efac' : '#fca5a5'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
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
                isEmployee={!isAdmin}
                hideSearch={false}
                placeholder={locale === 'ar' ? 'بحث في السبب' : 'Search Reason'}
                totalCount={total}
                allowedStatuses={['PENDING', 'APPROVED', 'REJECTED']}
                primaryAction={
                    !isAdmin ? (
                        <button onClick={() => setIsRequestModalOpen(true)} className="btn btn-primary" style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}>
                            {t('request_day_off' as any)}
                        </button>
                    ) : null
                }
            />

            <div className={isAdmin ? "" : "responsive-sidebar-grid"} style={{ display: isAdmin ? 'grid' : undefined, gridTemplateColumns: isAdmin ? '1fr' : undefined, gap: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* User Credit Stats - Mobile only */}
                    {!isAdmin && (
                        <div className="show-on-mobile" style={{ display: 'none', width: '100%', marginBottom: '0.5rem', marginTop: '-0.75rem' }}>
                            <div style={{ display: 'flex', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', width: '100%' }}>
                                {(() => {
                                    const totalCredit = baseCredit;
                                    const percentage = totalCredit > 0 ? userCredit / totalCredit : 1;

                                    let colors = { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' }; // Green
                                    if (percentage < 0.3) {
                                        colors = { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' }; // Red
                                    } else if (percentage < 0.6) {
                                        colors = { bg: '#fff7ed', text: '#9a3412', border: '#fed7aa' }; // Orange
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
                                            boxShadow: '0 2px 4px -1px rgba(0, 0, 0, 0.05)',
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
                            <span className="text-5xl mb-4">🌴</span>
                            <h3 className="text-xl font-bold text-slate-800">{t('no_records_found')}</h3>
                            <p className="max-w-xs mx-auto mt-2 text-slate-500">
                                {(filters.search || filters.status || filters.employeeId) ? (t('no_search_results' as any) || 'No results match your filters') : ''}
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem' }}>
                            {filteredRequests.map((req, index) => (
                                <div
                                    key={req.id}
                                    id={`request-${req.id}`}
                                    className={`glass-card hover:bg-white/60 transition-all duration-300 p-5 border border-white/40 shadow-sm relative overflow-hidden flex flex-col gap-4 ${visualHighlightId === req.id ? 'highlight-pulse' : ''}`}
                                    style={{
                                        animation: visualHighlightId === req.id ? 'none' : 'fadeIn 0.4s ease-out forwards',
                                        animationDelay: `${index * 50}ms`,
                                        borderInlineStart: visualHighlightId === req.id ? '4px solid #a855f7' : '',
                                        background: visualHighlightId === req.id ? 'rgba(168, 85, 247, 0.05)' : ''
                                    }}
                                >
                                    {/* Card Header */}
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                            {isAdmin && (
                                                <h3 className="text-lg font-bold text-slate-800 leading-tight">
                                                    {req.user?.firstName} {req.user?.lastName}
                                                </h3>
                                            )}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#64748b', fontSize: '0.85rem', fontWeight: '600' }}>
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
                                            background: req.status === 'APPROVED' ? '#dcfce7' : req.status === 'REJECTED' ? '#fee2e2' : '#fef9c3',
                                            color: req.status === 'APPROVED' ? '#166534' : req.status === 'REJECTED' ? '#991b1b' : '#854d0e',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
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
                                                background: req.type === 'CASUAL' ? '#ede9fe' : '#e0f2fe',
                                                color: req.type === 'CASUAL' ? '#5b21b6' : '#0369a1'
                                            }}>
                                                {t(req.type === 'CASUAL' ? 'casual_day_off' : 'regular_day_off' as any)}
                                            </span>
                                            {/* Applied Days Badge - Always Visible */}
                                            <span style={{
                                                padding: '0.25rem 0.625rem',
                                                borderRadius: '0.5rem',
                                                fontSize: '0.75rem',
                                                fontWeight: '700',
                                                background: '#f8fafc',
                                                color: '#64748b',
                                                border: '1px solid #e2e8f0'
                                            }}>
                                                {formatDays(calculateWorkDays(req.date, req.endDate))}
                                            </span>
                                            {req.status === 'APPROVED' && (
                                                <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                                                    <span style={{
                                                        fontSize: '0.75rem',
                                                        padding: '0.25rem 0.625rem',
                                                        borderRadius: '0.5rem',
                                                        background: req.deductionType === 'SALARY' ? '#fee2e2' : '#dcfce7',
                                                        color: req.deductionType === 'SALARY' ? '#991b1b' : '#166534',
                                                        fontWeight: '700',
                                                        border: `1px solid ${req.deductionType === 'SALARY' ? '#fca5a5' : '#86efac'}`
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
                                                color: '#475569',
                                                lineHeight: '1.5',
                                                background: 'rgba(0,0,0,0.03)',
                                                padding: '0.75rem',
                                                borderRadius: '0.75rem',
                                                fontStyle: 'italic',
                                                maxHeight: '80px', // Lower threshold
                                                overflowY: 'auto',
                                                wordBreak: 'break-all', // Better for long gibberish
                                                scrollbarWidth: 'thin',
                                                display: 'block'
                                            }}>
                                                &quot;{req.reason}&quot;
                                            </div>
                                        ) : (
                                            <p style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                                {t('no_reason_provided' as any) || 'No reason provided'}
                                            </p>
                                        )}
                                        <div style={{
                                            fontSize: '0.75rem',
                                            color: '#94a3b8',
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
                                    {isAdmin && req.status === 'PENDING' && (
                                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: 'auto', paddingTop: '1rem', borderTop: '1px dashed #e2e8f0' }}>
                                            <button
                                                onClick={() => handleAction(req.id, 'APPROVED')}
                                                className="btn"
                                                style={{
                                                    flex: 1,
                                                    background: '#10b981',
                                                    color: 'white',
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
                                                    background: '#ef4444',
                                                    color: 'white',
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

                {!isAdmin && (
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
                                <p style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#10b981' }}>{formatDays(userCredit)}</p>
                                <p style={{ fontSize: '0.85rem', color: '#64748b' }}>{t('remaining_credit' as any)}</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Request Modal */}
            {isRequestModalOpen && (
                <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
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
                                    color: reqReason.length >= 100 ? '#ef4444' : '#94a3b8',
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
                <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 'min(calc(100vw - 3rem), 400px)' }}>
                        <h2 className="text-xl font-bold mb-4">{t('approve_deduction_title' as any)}</h2>
                        <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: '#64748b' }}>
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
                                <label style={{ fontSize: '0.875rem', fontWeight: '500', color: '#64748b' }}>{t('deduct_from_label' as any)}</label>
                                {(parseFloat(daysToDeduct) || 0) > (selectedRequest.user?.dayOffCredit || 0) && (
                                    <span style={{ fontSize: '0.7rem', color: '#ef4444', fontWeight: 'bold', background: '#fee2e2', padding: '0.1rem 0.4rem', borderRadius: '0.25rem' }}>
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
                                        border: '1px solid #e2e8f0',
                                        background: deductionType === 'CREDIT' ? '#3b82f6' : 'white',
                                        color: deductionType === 'CREDIT' ? 'white' : '#64748b',
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
                                        border: '1px solid #e2e8f0',
                                        background: deductionType === 'SALARY' ? '#3b82f6' : 'white',
                                        color: deductionType === 'SALARY' ? 'white' : '#64748b',
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
                <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                    <div className="card" style={{ width: 'min(calc(100vw - 3rem), 400px)' }}>
                        <h2 className="text-xl font-bold mb-4">{t('confirm_rejection_title' as any)}</h2>
                        <p style={{ marginBottom: '1.5rem', color: '#64748b' }}>
                            {t('are_you_sure_msg' as any)} {t('reject_button')} {selectedRequest.user?.firstName} {selectedRequest.user?.lastName}?
                        </p>
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => processAction(selectedRequest.id, 'REJECTED')}
                                className="btn"
                                style={{ background: '#ef4444', color: 'white' }}
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
