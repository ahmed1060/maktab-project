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
        <section style={{ marginTop: '3rem', marginBottom: '3rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', color: '#1e293b', margin: 0 }}>
                            🤝 {t('requests')}
                        </h2>
                        {!loading && (
                            <span style={{
                                background: '#6366f1',
                                color: 'white',
                                padding: '0.2rem 0.6rem',
                                borderRadius: '1rem',
                                fontSize: '0.85rem',
                                fontWeight: '700'
                            }}>
                                {requests.length}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                        <Link
                            href="/dashboard/requests/history"
                            className="btn"
                            style={{
                                padding: '0.6rem 1rem',
                                fontSize: '0.9rem',
                                background: 'rgba(255,255,255,0.4)',
                                color: '#64748b',
                                border: '1px solid rgba(0,0,0,0.1)',
                                fontWeight: '600'
                            }}
                        >
                            {t('history')}
                        </Link>
                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="btn btn-primary"
                            style={{
                                padding: '0.6rem 1.25rem',
                                fontSize: '0.9rem',
                                fontWeight: '700'
                            }}
                        >
                            + {t('make_a_request')}
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                    <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
                        <input
                            type="text"
                            placeholder={t('search_by_title' as any) || "Search by title..."}
                            className="input"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{ paddingInlineStart: '2.5rem' }}
                        />
                        <span style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', opacity: 0.5 }}>🔍</span>
                    </div>

                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className="btn"
                            style={{ background: 'white', border: '1px solid #e2e8f0' }}
                        >
                            <span>⚙️</span>
                            <span>{t('filters')}</span>
                        </button>

                        {showFilters && (
                            <div className="glass-card" style={{
                                position: 'absolute',
                                top: '100%',
                                [locale === 'ar' ? 'left' : 'right']: 0,
                                transform: 'translateY(10px)',
                                zIndex: 50,
                                width: '300px',
                                padding: '1.5rem',
                                boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
                                border: '1px solid #e2e8f0'
                            }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#64748b', marginBottom: '0.4rem', display: 'block' }}>{t('status')}</label>
                                        <select
                                            className="input"
                                            value={filterStatus}
                                            onChange={(e) => setFilterStatus(e.target.value)}
                                        >
                                            <option value="">{t('all_statuses' as any)}</option>
                                            <option value="PENDING">{t('status_pending')}</option>
                                            <option value="IN_PROGRESS">{t('status_in_progress')}</option>
                                            <option value="COMPLETED">{t('status_completed')}</option>
                                        </select>
                                    </div>

                                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
                                        <div>
                                            <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#64748b', marginBottom: '0.4rem', display: 'block' }}>{t('employee')}</label>
                                            <select
                                                className="input"
                                                value={filterUserId}
                                                onChange={(e) => setFilterUserId(e.target.value)}
                                            >
                                                <option value="">{t('all_employees' as any)}</option>
                                                {employees.map(emp => (
                                                    <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}

                                    <div>
                                        <label style={{ fontSize: '0.8rem', fontWeight: '700', color: '#64748b', marginBottom: '0.4rem', display: 'block' }}>{t('sort_by')}</label>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <select
                                                className="input"
                                                value={sortBy}
                                                onChange={(e) => setSortBy(e.target.value)}
                                                style={{ flex: 1 }}
                                            >
                                                <option value="createdAt">{t('date_created' as any)}</option>
                                                <option value="status">{t('status')}</option>
                                            </select>
                                            <button
                                                className="btn"
                                                onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
                                                style={{ padding: '0.5rem', width: '42px', height: '42px', minWidth: 'unset' }}
                                            >
                                                {order === 'asc' ? '↑' : '↓'}
                                            </button>
                                        </div>
                                    </div>

                                    <button
                                        onClick={() => {
                                            setFilterStatus('')
                                            setFilterUserId('')
                                            setSortBy('createdAt')
                                            setOrder('desc')
                                            setSearch('')
                                        }}
                                        style={{ color: '#ef4444', fontSize: '0.85rem', fontWeight: '600', background: 'none', border: 'none', cursor: 'pointer', marginTop: '0.5rem' }}
                                    >
                                        {t('reset_filters' as any) || "Reset Filters"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
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
