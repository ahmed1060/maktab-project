import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import Pagination from '@/components/Pagination'

type Request = {
    id: string
    userId: string
    oldFirstName: string
    oldLastName: string
    newFirstName: string
    newLastName: string
    status: string
    createdAt: string
    user: {
        firstName: string
        lastName: string
        email: string
        role: string
        company?: { name: string }
    }
}

export default function ProfileRequestsPage() {
    const { t, locale } = useLanguage()
    const { data: session } = useSession()
    const [requests, setRequests] = useState<Request[]>([])
    const [loading, setLoading] = useState(true)
    const { showToast } = useToast()
    const router = useRouter()
    const [processingId, setProcessingId] = useState<string | null>(null)

    const [page, setPage] = useState(1)
    const [total, setTotal] = useState(0)
    const [totalPages, setTotalPages] = useState(0)
    const limit = 10

    const fetchRequests = async () => {
        setLoading(true)
        try {
            const queryParams = new URLSearchParams()
            queryParams.set('status', 'PENDING')
            queryParams.set('page', page.toString())
            queryParams.set('limit', limit.toString())

            const res = await fetch(`/api/profile-requests?${queryParams.toString()}`)
            if (res.ok) {
                const data = await res.json()
                setRequests(data.data || [])
                setTotal(data.total || 0)
                setTotalPages(data.totalPages || 0)
            }
        } catch (e) {
            console.error('Failed to fetch requests', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN') {
            fetchRequests()
        }
    }, [session, page])

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        setProcessingId(id)
        try {
            const res = await fetch(`/api/profile-requests/${id}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminNote: '' })
            })

            if (res.ok) {
                showToast(action === 'approve' ? t('request_approved_success') : t('request_rejected_success'), 'success')
                fetchRequests()
                router.refresh()
            } else {
                showToast(action === 'approve' ? t('request_approval_failed') : t('request_rejection_failed'), 'error')
            }
        } catch (e) {
            showToast(t('error_generic'), 'error')
        } finally {
            setProcessingId(null)
        }
    }

    const getRoleKey = (role: string) => {
        switch (role) {
            case 'EMPLOYEE': return 'role_employee'
            case 'TEAM_LEADER': return 'role_team_leader'
            case 'ADMIN': return 'role_admin'
            case 'SUPER_ADMIN': return 'super_admins'
            default: return 'role_employee'
        }
    }

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        background: 'rgba(255, 255, 255, 0.5)',
                        border: '1px solid rgba(255, 255, 255, 0.8)',
                        width: '40px',
                        height: '40px',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        color: '#64748b'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)'
                        e.currentTarget.style.color = '#1e293b'
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
                        e.currentTarget.style.color = '#64748b'
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: locale === 'ar' ? 'rotate(180deg)' : 'none' }}>
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: 0 }}>{t('profile_name_requests')}</h1>
                    <p style={{ color: '#64748b', margin: 0 }}>{t('profile_requests_subtitle')}</p>
                </div>
            </div>

            {loading ? <p style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('loading_filters')}</p> : (
                <div style={{ background: 'white', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <tr>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('role_employee')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('current_name_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('requested_name_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('today')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>{t('system')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>{t('no_pending_requests')}</td>
                                </tr>
                            ) : requests.map(req => (
                                <tr key={req.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontWeight: '600' }}>{req.user.firstName} {req.user.lastName}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{req.user.email} • {t(getRoleKey(req.user.role) as any)}</div>
                                        {req.user.company && <div style={{ fontSize: '0.75rem', color: '#6366f1' }}>{req.user.company.name}</div>}
                                    </td>
                                    <td style={{ padding: '1rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.oldFirstName} {req.oldLastName}</td>
                                    <td style={{ padding: '1rem', fontWeight: 'bold', color: '#166534', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.newFirstName} {req.newLastName}</td>
                                    <td style={{ padding: '1rem', fontSize: '0.8rem', color: '#64748b', textAlign: locale === 'ar' ? 'right' : 'left' }}>{new Date(req.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-EG')}</td>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end' }}>
                                            <button
                                                disabled={processingId === req.id}
                                                onClick={() => handleAction(req.id, 'approve')}
                                                style={{
                                                    background: '#dcfce7',
                                                    color: '#166534',
                                                    border: 'none',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '0.5rem',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '600',
                                                    cursor: processingId === req.id ? 'not-allowed' : 'pointer',
                                                    opacity: processingId === req.id ? 0.6 : 1
                                                }}
                                            >
                                                {t('approve_button')}
                                            </button>
                                            <button
                                                disabled={processingId === req.id}
                                                onClick={() => handleAction(req.id, 'reject')}
                                                style={{
                                                    background: '#fee2e2',
                                                    color: '#991b1b',
                                                    border: 'none',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '0.5rem',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '600',
                                                    cursor: processingId === req.id ? 'not-allowed' : 'pointer',
                                                    opacity: processingId === req.id ? 0.6 : 1
                                                }}
                                            >
                                                {t('reject_button')}
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={(p) => setPage(p)}
            />
        </div>
    )
}
