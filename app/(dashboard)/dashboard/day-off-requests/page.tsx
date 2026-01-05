'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import DateRangePicker from '@/components/DateRangePicker'
import DatePickerSingle from '@/components/DatePickerSingle'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import EmployeeFilter from '@/components/EmployeeFilter'

interface DayOffRequest {
    id: string
    userId: string
    type: 'CASUAL' | 'REGULAR'
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    reason: string | null
    date: string
    endDate?: string | null
    daysDeducted: number
    createdAt: string
    user?: {
        firstName: string
        lastName: string
        dayOffCredit: number
    }
}

export default function DayOffRequestsPage() {
    const { t, locale } = useLanguage()
    const { data: session } = useSession()
    const user = session?.user
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user?.role || '')

    const [requests, setRequests] = useState<DayOffRequest[]>([])
    const [loading, setLoading] = useState(true)
    const [isRequestModalOpen, setIsRequestModalOpen] = useState(false)
    const [isApprovalModalOpen, setIsApprovalModalOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<DayOffRequest | null>(null)
    const [daysToDeduct, setDaysToDeduct] = useState('1')

    // New Request Form State
    const [reqDate, setReqDate] = useState('')
    const [reqEndDate, setReqEndDate] = useState('')
    const [reqType, setReqType] = useState<'CASUAL' | 'REGULAR'>('REGULAR')
    const [reqReason, setReqReason] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [serverToday, setServerToday] = useState<string>('')
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false)

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

    useEffect(() => {
        fetchRequests()
        if (!isAdmin) {
            fetchUserCredit()
        }
        // Sync with Egypt server time
        fetch('/api/time').then(res => res.json()).then(data => {
            setServerToday(data.today);
        }).catch(err => {
            console.error('Failed to sync time:', err);
            setServerToday(new Date().toISOString().split('T')[0]);
        });
    }, [isAdmin])

    const fetchRequests = async () => {
        setLoading(true)
        try {
            const endpoint = isAdmin ? '/api/admin/day-off-requests' : '/api/day-off-requests'
            const res = await fetch(endpoint)
            if (res.ok) {
                const data = await res.json()
                setRequests(data)
            }
        } catch (error) {
            console.error('Failed to fetch requests', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchUserCredit = async () => {
        try {
            const res = await fetch(`/api/users?id=${user?.id}`)
            if (res.ok) {
                const data = await res.json()
                setUserCredit(data.dayOffCredit || 0)
            }
        } catch (error) {
            console.error('Failed to fetch user credit', error)
        }
    }

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

        if (status === 'APPROVED' && req) {
            const days = calculateWorkDays(req.date, req.endDate)
            setDaysToDeduct(days.toString())
            setIsApprovalModalOpen(true)
        } else if (status === 'REJECTED') {
            setIsRejectModalOpen(true)
        }
    }

    const processAction = async (requestId: string, status: 'APPROVED' | 'REJECTED', deduction?: string) => {
        try {
            const res = await fetch(`/api/admin/day-off-requests/${requestId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status, daysToDeduct: deduction })
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
    const usedCredits = requests.filter(r => r.status === 'APPROVED').reduce((acc, r) => acc + (r.daysDeducted || 0), 0)

    // Filter Logic
    const filteredRequests = requests.filter(req => {
        const matchesEmployee = !filters.employeeId || req.userId === filters.employeeId
        const matchesStatus = !filters.status || req.status === filters.status
        const matchesSearch = !filters.search ||
            (req.user?.firstName + ' ' + req.user?.lastName).toLowerCase().includes(filters.search.toLowerCase()) ||
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
        { name: t('used_credit' as any), value: usedCredits }
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
                hideSearch={true}
                totalCount={filteredRequests.length}
                allowedStatuses={['PENDING', 'APPROVED', 'REJECTED']}
                primaryAction={
                    !isAdmin ? (
                        <button onClick={() => setIsRequestModalOpen(true)} className="btn btn-primary" style={{ height: '48px', display: 'flex', alignItems: 'center', borderRadius: '1.25rem' }}>
                            {t('request_day_off' as any)}
                        </button>
                    ) : null
                }
            />

            <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr' : '1fr 320px', gap: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {loading ? (
                        <div className="glass-card p-12 flex flex-col items-center justify-center animate-pulse">
                            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                            <p className="text-slate-500 font-medium">{t('loading_filters')}</p>
                        </div>
                    ) : filteredRequests.length === 0 ? (
                        <div className="glass-card flex flex-col items-center justify-center py-16 text-center text-slate-500">
                            <span className="text-5xl mb-4">🌴</span>
                            <h3 className="text-xl font-bold text-slate-800">{t('no_records_found')}</h3>
                            <p className="max-w-xs mx-auto mt-2 text-slate-500">
                                {filters.search || filters.status || filters.employeeId ? t('no_search_results' as any) || 'No results match your filters' : t('get_started_day_off' as any) || 'No day off requests yet.'}
                            </p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1rem' }}>
                            {filteredRequests.map((req, index) => (
                                <div
                                    key={req.id}
                                    className="glass-card hover:bg-white/60 transition-all duration-300 p-5 border border-white/40 shadow-sm relative overflow-hidden flex flex-col gap-4"
                                    style={{
                                        animation: 'fadeIn 0.4s ease-out forwards',
                                        animationDelay: `${index * 50}ms`
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
                                            <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', display: 'flex', gap: '0.35rem' }}>
                                                <span>{locale === 'ar' ? 'تم الطلب في:' : 'Requested on:'}</span>
                                                <span>
                                                    {new Date(req.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: true })}, {new Date(req.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </span>
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
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
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
                                            {req.status === 'APPROVED' && (
                                                <span style={{
                                                    padding: '0.25rem 0.625rem',
                                                    borderRadius: '0.5rem',
                                                    fontSize: '0.75rem',
                                                    fontWeight: '700',
                                                    background: '#f8fafc',
                                                    color: '#64748b',
                                                    border: '1px solid #e2e8f0'
                                                }}>
                                                    {req.daysDeducted} {t('days_label')}
                                                </span>
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
                </div>

                {!isAdmin && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
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
                                <p style={{ fontSize: '1.25rem', fontWeight: 'bold', color: '#10b981' }}>{userCredit} {t('days_label')}</p>
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
                                        minDate={serverToday ? new Date(new Date(serverToday).getTime() + 86400000).toISOString().split('T')[0] : ''}
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
                                        minDate={serverToday ? new Date(new Date(serverToday).getTime() - 86400000).toISOString().split('T')[0] : ''}
                                        maxDate={serverToday ? new Date(new Date(serverToday).getTime() + 86400000).toISOString().split('T')[0] : ''}
                                    />
                                </div>
                            )}
                            <div style={{ marginBottom: '1.5rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('reason_label' as any)}</label>
                                <textarea
                                    className="input"
                                    style={{ height: '100px', resize: 'none' }}
                                    placeholder={t('reason_placeholder' as any)}
                                    value={reqReason}
                                    onChange={e => setReqReason(e.target.value)}
                                />
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
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button
                                onClick={() => processAction(selectedRequest.id, 'APPROVED', daysToDeduct)}
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
