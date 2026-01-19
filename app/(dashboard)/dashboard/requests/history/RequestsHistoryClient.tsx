'use client'
import { useState, useEffect } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import RequestCard from '@/components/requests/RequestCard'
import ViewRequestModal from '@/components/requests/ViewRequestModal'
import Link from 'next/link'
import { useToast } from '@/context/ToastContext'

export default function RequestsHistoryClient({ userRole }: { userRole: string }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [requests, setRequests] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedRequest, setSelectedRequest] = useState<any>(null)
    const [isViewModalOpen, setIsViewModalOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [filterUserId, setFilterUserId] = useState('')
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

    const fetchHistory = async () => {
        try {
            let url = '/api/requests?history=true'
            if (search) url += `&search=${encodeURIComponent(search)}`
            if (filterUserId) url += `&userId=${filterUserId}`

            const res = await fetch(url)
            if (res.ok) {
                const data = await res.json()
                setRequests(data)
            }
        } catch (error) {
            console.error("Error fetching history:", error)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchHistory()
    }, [search, filterUserId])

    useEffect(() => {
        fetchEmployees()
    }, [])

    const handleDeleteRequest = async (id: string) => {
        try {
            const res = await fetch(`/api/requests/${id}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                showToast(t('item_deleted_success' as any) || 'Request deleted successfully', 'success')
                setIsViewModalOpen(false)
                fetchHistory()
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
        filterUserId ? 1 : 0
    ].reduce((a, b) => a + b, 0)

    return (
        <section style={{ padding: '0', marginBottom: '3rem' }}>
            <style>{`
                @keyframes popIn { 
                    from { opacity: 0; transform: translateY(-8px); } 
                    to { opacity: 1; transform: translateY(0); } 
                }
            `}</style>

            {/* Back Button Row */}
            <div style={{
                display: 'flex',
                justifyContent: locale === 'ar' ? 'flex-end' : 'flex-start',
                marginBottom: '1rem',
                flexDirection: locale === 'ar' ? 'row-reverse' : 'row'
            }}>
                <Link
                    href="/dashboard/requests"
                    className="glass"
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#6366f1',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        border: '1px solid rgba(255, 255, 255, 0.4)',
                        borderRadius: '0.75rem',
                        background: 'rgba(255, 255, 255, 0.4)',
                        backdropFilter: 'blur(8px)',
                        transform: locale === 'ar' ? 'scaleX(-1)' : 'none'
                    }}
                    title={t('back_to_requests' as any) || 'Back to Requests'}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </Link>
            </div>

            {/* Unified Glass Toolbar */}
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

                    {/* Filters Toggle (Only if admin/team leader and has employees) */}
                    {['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole) && (
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

                                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem' }}>
                                            <button
                                                onClick={() => {
                                                    setFilterUserId('')
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
                    )}

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
                        />
                    ))}
                </div>
            )}

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
