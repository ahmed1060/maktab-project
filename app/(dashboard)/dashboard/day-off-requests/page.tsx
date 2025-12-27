'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'

interface DayOffRequest {
    id: string
    userId: string
    type: 'CASUAL' | 'REGULAR'
    status: 'PENDING' | 'APPROVED' | 'REJECTED'
    reason: string | null
    date: string
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
    const [reqType, setReqType] = useState<'CASUAL' | 'REGULAR'>('REGULAR')
    const [reqReason, setReqReason] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false)

    // User Credit Info
    const [userCredit, setUserCredit] = useState(0)

    useEffect(() => {
        fetchRequests()
        if (!isAdmin) {
            fetchUserCredit()
        }
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

    const handleAction = async (requestId: string, status: 'APPROVED' | 'REJECTED') => {
        const req = requests.find(r => r.id === requestId)
        setSelectedRequest(req || null)

        if (status === 'APPROVED') {
            setIsApprovalModalOpen(true)
        } else {
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
                    minWidth: '250px',
                    maxWidth: '350px',
                    animation: 'slideInRight 0.3s ease-out'
                }}>
                    <span style={{ fontSize: '1rem' }}>
                        {alert.type === 'success' ? '✓' : '✕'}
                    </span>
                    {alert.message}
                </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <h1 className="text-3xl font-bold text-slate-800">{t('day_off_requests' as any)}</h1>
                {!isAdmin && (
                    <button onClick={() => setIsRequestModalOpen(true)} className="btn btn-primary">
                        {t('request_day_off' as any)}
                    </button>
                )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isAdmin ? '1fr' : '1fr 350px', gap: '2rem' }}>
                <div className="card">
                    <h2 className="text-xl font-semibold mb-4">{isAdmin ? t('all_users' as any) : t('requests_history' as any)}</h2>
                    {loading ? (
                        <p>{t('loading_filters')}</p>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #e2e8f0', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {isAdmin && <th style={{ padding: '1rem' }}>{t('name_label')}</th>}
                                        <th style={{ padding: '1rem' }}>{t('select_date' as any)}</th>
                                        <th style={{ padding: '1rem' }}>{t('day_off_type' as any)}</th>
                                        <th style={{ padding: '1rem' }}>{t('status_label')}</th>
                                        <th style={{ padding: '1rem' }}>{t('reason_label' as any)}</th>
                                        {isAdmin && <th style={{ padding: '1rem' }}>{t('edit')}</th>}
                                    </tr>
                                </thead>
                                <tbody>
                                    {requests.map(req => (
                                        <tr key={req.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                            {isAdmin && <td style={{ padding: '1rem' }}>{req.user?.firstName} {req.user?.lastName}</td>}
                                            <td style={{ padding: '1rem' }}>{new Date(req.date).toLocaleDateString(locale)}</td>
                                            <td style={{ padding: '1rem' }}>{t(req.type === 'CASUAL' ? 'casual_day_off' : 'regular_day_off' as any)}</td>
                                            <td style={{ padding: '1rem' }}>
                                                <span style={{
                                                    padding: '0.25rem 0.75rem',
                                                    borderRadius: '1rem',
                                                    fontSize: '0.85rem',
                                                    background: req.status === 'APPROVED' ? '#dcfce7' : req.status === 'REJECTED' ? '#fee2e2' : '#fef9c3',
                                                    color: req.status === 'APPROVED' ? '#166534' : req.status === 'REJECTED' ? '#991b1b' : '#854d0e'
                                                }}>
                                                    {t(`status_${req.status.toLowerCase()}` as any)}
                                                </span>
                                            </td>
                                            <td style={{ padding: '1rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={req.reason || ''}>
                                                {req.reason || '-'}
                                            </td>
                                            {isAdmin && (
                                                <td style={{ padding: '1rem' }}>
                                                    {req.status === 'PENDING' && (
                                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                            <button onClick={() => handleAction(req.id, 'APPROVED')} className="btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: '#10b981', color: 'white' }}>{t('approve_button')}</button>
                                                            <button onClick={() => handleAction(req.id, 'REJECTED')} className="btn" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem', background: '#ef4444', color: 'white' }}>{t('reject_button')}</button>
                                                        </div>
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {requests.length === 0 && (
                                        <tr>
                                            <td colSpan={isAdmin ? 6 : 4} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                                                {t('no_records_found')}
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
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
                    <div className="card" style={{ width: '400px', maxWidth: '90%' }}>
                        <h2 className="text-xl font-bold mb-4">{t('request_day_off' as any)}</h2>
                        <form onSubmit={handleSubmitRequest}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('select_date' as any)}</label>
                                <input
                                    type="date"
                                    className="input"
                                    required
                                    value={reqDate}
                                    onChange={e => setReqDate(e.target.value)}
                                    min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                                />
                            </div>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem' }}>{t('day_off_type' as any)}</label>
                                <select className="input" value={reqType} onChange={e => setReqType(e.target.value as any)}>
                                    <option value="REGULAR">{t('regular_day_off' as any)}</option>
                                    <option value="CASUAL">{t('casual_day_off' as any)}</option>
                                </select>
                            </div>
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
                    <div className="card" style={{ width: '400px', maxWidth: '90%' }}>
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
                    <div className="card" style={{ width: '400px', maxWidth: '90%' }}>
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
