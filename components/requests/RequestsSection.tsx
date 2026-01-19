'use client'
import { useState, useEffect } from 'react'
import RequestCard from './RequestCard'
import CreateRequestModal from './CreateRequestModal'
import ViewRequestModal from './ViewRequestModal'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import Link from 'next/link'

interface RequestsSectionProps {
    userRole: string
    companyId?: string
}

export default function RequestsSection({ userRole, companyId }: RequestsSectionProps) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [requests, setRequests] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
    const [selectedRequest, setSelectedRequest] = useState<any>(null)
    const [isViewModalOpen, setIsViewModalOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [filterStatus, setFilterStatus] = useState('')
    const [filterUserId, setFilterUserId] = useState('')
    const [sortBy, setSortBy] = useState('createdAt')
    const [order, setOrder] = useState('desc')
    const [showFilters, setShowFilters] = useState(false)
    const [employees, setEmployees] = useState<any[]>([])

    const fetchEmployees = async () => {
        if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole)) return
        try {
            const res = await fetch('/api/users?limit=100')
            if (res.ok) {
                const data = await res.json()
                setEmployees(data.data || [])
            }
        } catch (error) {
            console.error("Error fetching employees:", error)
        }
    }

    const fetchRequests = async () => {
        try {
            let url = `/api/requests?sortBy=${sortBy}&order=${order}`
            if (companyId) url += `&companyId=${companyId}`
            if (search) url += `&search=${encodeURIComponent(search)}`
            if (filterStatus) url += `&status=${filterStatus}`
            if (filterUserId) url += `&userId=${filterUserId}`

            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setRequests(data)
            }
        } catch (error) {
            console.error("Error fetching requests:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchRequests()
    }, [companyId, search, filterStatus, filterUserId, sortBy, order])

    useEffect(() => {
        fetchEmployees()
    }, [companyId])

    const handleCreateRequest = async (title: string, details: string) => {
        try {
            const res = await fetch('/api/requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, details })
            })
            if (res.ok) {
                showToast(t('request_submitted_success') || 'Request submitted successfully', 'success')
                fetchRequests()
            } else {
                showToast(t('failed_submit_request') || 'Failed to submit request', 'error')
            }
        } catch (error) {
            showToast(t('error_generic'), 'error')
        }
    }

    const handleStatusUpdate = async (id: string, status: string) => {
        try {
            const res = await fetch(`/api/requests/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            })
            if (res.ok) {
                showToast(t('request_action_success') || 'Status updated', 'success')
                fetchRequests()
            } else {
                showToast(t('error_generic'), 'error')
            }
        } catch (error) {
            showToast(t('error_generic'), 'error')
        }
    }

    const handleViewRequest = (request: any) => {
        setSelectedRequest(request)
        setIsViewModalOpen(true)
    }

    return (
        <section style={{ marginTop: '2rem', marginBottom: '3rem' }}>
            {/* Unified Glass Toolbar */}
            <div style={{
                background: 'rgba(255, 255, 255, 0.4)',
                backdropFilter: 'blur(16px)',
                padding: '0.75rem',
                borderRadius: '2rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                flexWrap: 'wrap',
                boxShadow: '0 8px 32px rgba(0,0,0,0.05)',
                flexDirection: locale === 'ar' ? 'row-reverse' : 'row',
                marginBottom: '2.5rem'
            }}>
                {/* Search */}
                <div style={{ position: 'relative', flex: 1, minWidth: '200px' }}>
                    <input
                        type="text"
                        placeholder={t('search_by_title')}
                        className="input"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{
                            borderRadius: '1.5rem',
                            border: '1px solid rgba(0,0,0,0.1)',
                            padding: '0.65rem 1rem 0.65rem 2.8rem',
                            background: 'white',
                            width: '100%',
                            boxSizing: 'border-box'
                        }}
                    />
                    <span style={{
                        position: 'absolute',
                        [locale === 'ar' ? 'right' : 'left']: '1rem',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        opacity: 0.4,
                        fontSize: '1.2rem'
                    }}>🔍</span>
                </div>

                {/* Filters Toggle */}
                <div style={{ position: 'relative' }}>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="btn"
                        style={{
                            borderRadius: '1.5rem',
                            background: 'white',
                            border: '1px solid rgba(0,0,0,0.1)',
                            padding: '0.65rem 1.25rem',
                            color: '#475569',
                            fontWeight: '600',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                        </svg>
                        {t('filters')}
                    </button>

                    {showFilters && (
                        <div className="glass-card" style={{
                            position: 'absolute',
                            top: 'calc(100% + 12px)',
                            [locale === 'ar' ? 'left' : 'right']: 0,
                            zIndex: 100,
                            width: '300px',
                            padding: '1.5rem',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.15)',
                            border: '1px solid rgba(255,255,255,0.8)',
                            borderRadius: '1.5rem',
                            background: 'rgba(255,255,255,0.9)',
                            backdropFilter: 'blur(20px)'
                        }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                <div>
                                    <label style={{ fontSize: '0.75rem', fontWeight: '800', color: '#64748b', marginBottom: '0.5rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('status')}</label>
                                    <select
                                        className="input"
                                        value={filterStatus}
                                        onChange={(e) => setFilterStatus(e.target.value)}
                                        style={{ borderRadius: '0.75rem' }}
                                    >
                                        <option value="">{t('all_statuses' as any)}</option>
                                        <option value="PENDING">{t('status_pending')}</option>
                                        <option value="IN_PROGRESS">{t('status_in_progress')}</option>
                                        <option value="COMPLETED">{t('status_completed')}</option>
                                    </select>
                                </div>

                                {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
                                    <div>
                                        <label style={{ fontSize: '0.75rem', fontWeight: '800', color: '#64748b', marginBottom: '0.5rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('employee')}</label>
                                        <select
                                            className="input"
                                            value={filterUserId}
                                            onChange={(e) => setFilterUserId(e.target.value)}
                                            style={{ borderRadius: '0.75rem' }}
                                        >
                                            <option value="">{t('all_employees')}</option>
                                            {employees.map(emp => (
                                                <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label style={{ fontSize: '0.75rem', fontWeight: '800', color: '#64748b', marginBottom: '0.5rem', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('sort_by')}</label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <select
                                            className="input"
                                            value={sortBy}
                                            onChange={(e) => setSortBy(e.target.value)}
                                            style={{ flex: 1, borderRadius: '0.75rem' }}
                                        >
                                            <option value="createdAt">{t('date_created')}</option>
                                            <option value="status">{t('status')}</option>
                                        </select>
                                        <button
                                            className="btn"
                                            onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
                                            style={{ padding: '0', width: '42px', height: '42px', minWidth: 'unset', borderRadius: '0.75rem', background: 'white', border: '1px solid rgba(0,0,0,0.1)' }}
                                        >
                                            {order === 'asc' ? '↑' : '↓'}
                                        </button>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
                                    <Link
                                        href="/dashboard/requests/history"
                                        className="btn"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem',
                                            fontSize: '0.85rem',
                                            background: 'rgba(0,0,0,0.05)',
                                            color: '#64748b',
                                            border: '1px solid rgba(0,0,0,0.05)',
                                            fontWeight: '700',
                                            borderRadius: '0.75rem'
                                        }}
                                    >
                                        📜 {t('history')}
                                    </Link>
                                    <button
                                        onClick={() => {
                                            setFilterStatus('')
                                            setFilterUserId('')
                                            setSortBy('createdAt')
                                            setOrder('desc')
                                            setSearch('')
                                            setShowFilters(false)
                                        }}
                                        style={{ color: '#ef4444', fontSize: '0.75rem', fontWeight: '700', background: 'none', border: 'none', cursor: 'pointer', padding: '0.5rem' }}
                                    >
                                        {t('reset_filters')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Total Counter Badge */}
                <div style={{
                    background: '#0f172a',
                    color: 'white',
                    padding: '0.65rem 1.25rem',
                    borderRadius: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.8rem',
                    fontWeight: '800',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                }}>
                    <span style={{ opacity: 0.6, fontSize: '0.7rem' }}>TOTAL</span>
                    <span>{requests.length}</span>
                </div>

                {/* Create Request Button */}
                <button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="btn btn-primary"
                    style={{
                        padding: '0.65rem 1.5rem',
                        fontSize: '0.9rem',
                        fontWeight: '800',
                        borderRadius: '1.5rem',
                        background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                        border: 'none',
                        color: 'white',
                        boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
                        whiteSpace: 'nowrap'
                    }}
                >
                    {t('make_a_request')}
                </button>
            </div>

            {loading ? (
                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                    {t('loading_data')}
                </div>
            ) : requests.length === 0 ? (
                <div className="glass-card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                    {t('no_requests_found')}
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '1.25rem' }}>
                    {requests.map(req => (
                        <RequestCard
                            key={req.id}
                            request={req}
                            userRole={userRole}
                            onView={handleViewRequest}
                            onStatusUpdate={handleStatusUpdate}
                        />
                    ))}
                </div>
            )}

            <CreateRequestModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
                onSubmit={handleCreateRequest}
            />

            <ViewRequestModal
                isOpen={isViewModalOpen}
                onClose={() => setIsViewModalOpen(false)}
                request={selectedRequest}
            />
        </section>
    )
}
