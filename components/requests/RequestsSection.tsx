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

    const handleDeleteRequest = async (id: string) => {
        try {
            const res = await fetch(`/api/requests/${id}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                showToast(t('item_deleted_success' as any) || 'Request deleted successfully', 'success')
                setIsViewModalOpen(false)
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

    const activeFilterCount = [
        filterStatus ? 1 : 0,
        filterUserId ? 1 : 0
    ].reduce((a, b) => a + b, 0)

    return (
        <section style={{ marginBottom: '3rem' }}>
            <style>{`
                @keyframes popIn { 
                    from { opacity: 0; transform: translateY(-8px); } 
                    to { opacity: 1; transform: translateY(0); } 
                }
            `}</style>

            {/* History Button Row - Aligned with the unified theme */}
            <div style={{
                display: 'flex',
                justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end',
                marginBottom: '1rem',
                flexDirection: locale === 'ar' ? 'row-reverse' : 'row'
            }}>
                <Link
                    href="/dashboard/requests/history"
                    className="btn"
                    style={{
                        padding: '0 1.5rem',
                        height: '48px',
                        fontSize: '0.95rem',
                        background: 'rgba(254, 243, 199, 0.4)',
                        color: '#b45309',
                        border: '1px solid rgba(251, 191, 36, 0.3)',
                        fontWeight: '800',
                        borderRadius: '1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        backdropFilter: 'blur(10px)',
                        textDecoration: 'none',
                        boxShadow: '0 4px 12px rgba(251, 191, 36, 0.1)'
                    }}
                >
                    📜 {t('history')}
                </Link>
            </div>

            {/* Unified Glass Toolbar - Matches EmployeeFilter style */}
            <div style={{
                marginBottom: '2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
                position: 'relative'
            }}>
                <div style={{
                    display: 'flex',
                    gap: '1rem',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    padding: '0.75rem',
                    position: 'relative',
                    zIndex: 10
                }}>
                    {/* Background Layer */}
                    <div style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(255, 255, 255, 0.4)',
                        backdropFilter: 'blur(8px)',
                        borderRadius: '1.5rem',
                        border: '1px solid rgba(255, 255, 255, 0.5)',
                        zIndex: -1,
                        pointerEvents: 'none'
                    }} />

                    {/* Search */}
                    <div style={{ flex: 1, minWidth: '300px', position: 'relative' }}>
                        <div style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1.25rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="11" cy="11" r="8"></circle>
                                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                            </svg>
                        </div>
                        <input
                            type="text"
                            placeholder={t('search_by_title')}
                            className="input"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            style={{
                                width: '100%',
                                padding: locale === 'ar' ? '0.625rem 3.5rem 0.625rem 1.25rem' : '0.625rem 1.25rem 0.625rem 3.5rem',
                                borderRadius: '1.25rem',
                                fontSize: '0.95rem',
                                border: '1px solid #e2e8f0',
                                textAlign: locale === 'ar' ? 'right' : 'left',
                                background: 'white',
                                height: '48px',
                                minHeight: '48px'
                            }}
                        />
                    </div>

                    {/* Filters Toggle */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                padding: '0 1.5rem',
                                borderRadius: '1.25rem',
                                background: activeFilterCount > 0 ? '#eff6ff' : 'white',
                                border: `2px solid ${activeFilterCount > 0 ? '#3b82f6' : '#e2e8f0'}`,
                                color: activeFilterCount > 0 ? '#2563eb' : '#475569',
                                fontWeight: '700',
                                fontSize: '0.95rem',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                position: 'relative',
                                height: '48px'
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                            </svg>
                            {t('filters')}
                            {activeFilterCount > 0 && (
                                <span style={{
                                    position: 'absolute',
                                    top: '-4px',
                                    [locale === 'ar' ? 'left' : 'right']: '-4px',
                                    background: '#3b82f6',
                                    color: 'white',
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '50%',
                                    fontSize: '0.7rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    border: '2px solid white'
                                }}>
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>

                        {showFilters && (
                            <>
                                <div onClick={() => setShowFilters(false)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                                <div style={{
                                    position: 'absolute',
                                    top: 'calc(100% + 0.75rem)',
                                    [locale === 'ar' ? 'left' : 'right']: 0,
                                    width: '320px',
                                    backgroundColor: '#ffffff',
                                    borderRadius: '1.25rem',
                                    padding: '1.5rem',
                                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                                    border: '1px solid #e2e8f0',
                                    zIndex: 1000,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '1.25rem',
                                    animation: 'popIn 0.2s ease-out'
                                }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: '800', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>{t('status')}</label>
                                        <div style={{ position: 'relative' }}>
                                            <select
                                                className="input"
                                                value={filterStatus}
                                                onChange={(e) => setFilterStatus(e.target.value)}
                                                style={{ width: '100%', padding: '0 1rem', borderRadius: '1.25rem', height: '48px', appearance: 'none', backgroundImage: 'none', background: 'white', border: '1px solid #e2e8f0' }}
                                            >
                                                <option value="">{t('all_statuses' as any)}</option>
                                                <option value="PENDING">{t('status_pending')}</option>
                                                <option value="IN_PROGRESS">{t('status_in_progress')}</option>
                                                <option value="COMPLETED">{t('status_completed')}</option>
                                            </select>
                                            <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>▼</div>
                                        </div>
                                    </div>

                                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
                                        <div>
                                            <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: '800', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>{t('employee')}</label>
                                            <div style={{ position: 'relative' }}>
                                                <select
                                                    className="input"
                                                    value={filterUserId}
                                                    onChange={(e) => setFilterUserId(e.target.value)}
                                                    style={{ width: '100%', padding: '0 1rem', borderRadius: '1.25rem', height: '48px', appearance: 'none', backgroundImage: 'none', background: 'white', border: '1px solid #e2e8f0' }}
                                                >
                                                    <option value="">{t('all_employees')}</option>
                                                    {employees.map(emp => (
                                                        <option key={emp.id} value={emp.id}>{emp.firstName} {emp.lastName}</option>
                                                    ))}
                                                </select>
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>▼</div>
                                            </div>
                                        </div>
                                    )}

                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.75rem', fontWeight: '800', fontSize: '0.75rem', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>{t('sort_by')}</label>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <div style={{ position: 'relative', flex: 1 }}>
                                                <select
                                                    className="input"
                                                    value={sortBy}
                                                    onChange={(e) => setSortBy(e.target.value)}
                                                    style={{ width: '100%', padding: '0 1rem', borderRadius: '1.25rem', height: '48px', appearance: 'none', backgroundImage: 'none', background: 'white', border: '1px solid #e2e8f0' }}
                                                >
                                                    <option value="createdAt">{t('date_created')}</option>
                                                    <option value="status">{t('status')}</option>
                                                </select>
                                                <div style={{ position: 'absolute', [locale === 'ar' ? 'left' : 'right']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }}>▼</div>
                                            </div>
                                            <button
                                                className="btn"
                                                onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
                                                style={{ height: '48px', width: '48px', borderRadius: '1.25rem', border: '1px solid #e2e8f0', background: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            >
                                                {order === 'asc' ? '↑' : '↓'}
                                            </button>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                                        <button
                                            onClick={() => {
                                                setFilterStatus('')
                                                setFilterUserId('')
                                                setSortBy('createdAt')
                                                setOrder('desc')
                                                setSearch('')
                                                setShowFilters(false)
                                            }}
                                            style={{
                                                flex: 1,
                                                height: '48px',
                                                borderRadius: '1.25rem',
                                                border: '1px solid #e2e8f0',
                                                background: 'white',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                fontSize: '0.875rem',
                                                color: '#64748b'
                                            }}
                                        >
                                            {t('reset_filters')}
                                        </button>
                                        <button
                                            onClick={() => setShowFilters(false)}
                                            style={{
                                                flex: 1,
                                                height: '48px',
                                                borderRadius: '1.25rem',
                                                border: 'none',
                                                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                                                color: 'white',
                                                fontWeight: '700',
                                                cursor: 'pointer',
                                                fontSize: '0.875rem',
                                                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.2)'
                                            }}
                                        >
                                            {t('show_results') || 'Apply'}
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Statistics Box */}
                    <div style={{
                        height: '48px',
                        padding: '0 1.25rem',
                        background: '#0f172a',
                        borderRadius: '1.25rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        color: 'white'
                    }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: '800', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('total_label')}</span>
                        <span style={{ fontSize: '1.25rem', fontWeight: '900' }}>{requests.length}</span>
                    </div>

                    {/* Create Request Push-to-end */}
                    <div style={{ marginLeft: locale === 'ar' ? '0' : 'auto', marginRight: locale === 'ar' ? 'auto' : '0' }}>
                        <button
                            onClick={() => setIsCreateModalOpen(true)}
                            className="btn btn-primary"
                            style={{
                                padding: '0 1.5rem',
                                height: '48px',
                                fontSize: '0.95rem',
                                fontWeight: '800',
                                borderRadius: '1.25rem',
                                background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
                                border: 'none',
                                color: 'white',
                                boxShadow: '0 4px 15px rgba(99, 102, 241, 0.3)',
                                whiteSpace: 'nowrap',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                        >
                            {t('make_a_request')}
                        </button>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                    {t('loading_data')}
                </div>
            ) : requests.length === 0 ? (
                <div className="card" style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
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
                userRole={userRole}
                onDelete={handleDeleteRequest}
            />
        </section>
    )
}
