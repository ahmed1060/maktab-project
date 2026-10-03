'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from '@/components/LoadingSpinner'
import Pagination from '@/components/Pagination'
import { useHeader } from '@/context/HeaderContext'
import { useCan } from '@/lib/useCan'

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

// One empty list for every render with no data, so effects that depend on
// the list do not re-run just because a new [] was made.
const NO_REQUESTS: Request[] = []

export default function ProfileRequestsPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { data: session } = useSession()
    const { showToast } = useToast()
    const router = useRouter()
    const [processingId, setProcessingId] = useState<string | null>(null)

    const [page, setPage] = useState(1)
    const limit = 10
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')

    const permissions = useCan()
    const canReview = permissions.can('profile_requests.review')
    const { data: result, isLoading, mutate: fetchRequests } = useSWR(
        canReview ? `/api/profile-requests?${new URLSearchParams({ status: 'PENDING', page: String(page), limit: String(limit) })}` : null,
        fetcher,
        { onError: () => showToast(t('failed_fetch_data'), 'error') },
    )
    const requests: Request[] = result?.data?.data || NO_REQUESTS
    const totalPages: number = result?.data?.totalPages || 0
    // Before the session arrives nothing has been asked yet; that is still
    // loading, not an empty queue.
    const loading = !session || isLoading

    useEffect(() => {
        setTitle(t('profile_name_requests'))
        setSubtitle(t('profile_requests_subtitle' as any))
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    // Scroll to highlighted request
    useEffect(() => {
        if (highlightId && !loading && requests.length > 0) {
            const element = document.getElementById(`request-${highlightId}`);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [highlightId, loading, requests]);

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
        } catch {
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

    if (!session || !canReview) {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                    aria-label={t('go_back' as any)}
                    onClick={() => router.back()}
                    style={{
                        background: 'var(--veil-50)',
                        border: '1px solid var(--panel-80)',
                        width: '40px',
                        height: '40px',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        color: 'var(--text-soft)'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--panel-80)'
                        e.currentTarget.style.color = 'var(--text-main)'
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'var(--veil-50)'
                        e.currentTarget.style.color = 'var(--text-soft)'
                    }}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: locale === 'ar' ? 'rotate(180deg)' : 'none' }}>
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
            </div>

            {loading ? <LoadingSpinner message={t('loading_requests')} /> : (
                <div style={{ background: 'var(--surface)', borderRadius: '12px', overflowX: 'auto', boxShadow: '0 1px 3px var(--shadow-weak)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                        <thead style={{ background: 'var(--surface-subtle)', borderBottom: '1px solid var(--border)' }}>
                            <tr>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('role_employee')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('current_name_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('requested_name_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('today')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1rem', fontSize: '0.875rem', color: 'var(--text-soft)' }}>{t('system')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-faint)' }}>{t('no_pending_requests')}</td>
                                </tr>
                            ) : requests.map(req => (
                                <tr key={req.id} id={`request-${req.id}`} className={highlightId === req.id ? 'highlight-shading' : ''} style={{ borderBottom: '1px solid var(--surface-sunk)' }}>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontWeight: '600' }}>{req.user.firstName} {req.user.lastName}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>{req.user.email} • {t(getRoleKey(req.user.role) as any)}</div>
                                        {req.user.company && <div style={{ fontSize: '0.75rem', color: 'var(--brand-primary-text)' }}>{req.user.company.name}</div>}
                                    </td>
                                    <td style={{ padding: '1rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.oldFirstName} {req.oldLastName}</td>
                                    <td style={{ padding: '1rem', fontWeight: 'bold', color: 'var(--ok-fg)', textAlign: locale === 'ar' ? 'right' : 'left' }}>{req.newFirstName} {req.newLastName}</td>
                                    <td style={{ padding: '1rem', fontSize: '0.8rem', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }}>{new Date(req.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-EG')}</td>
                                    <td style={{ padding: '1rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                        {/* Not one's own name change (ROLES_PLAN.md §4.2, rule 5). */}
                                        {permissions.canFor('profile_requests.review', req.userId) && (
                                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end' }}>
                                                <button
                                                    disabled={processingId === req.id}
                                                    onClick={() => handleAction(req.id, 'approve')}
                                                    style={{
                                                        background: 'var(--ok-bg)',
                                                        color: 'var(--ok-fg)',
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
                                                        background: 'var(--danger-bg)',
                                                        color: 'var(--danger-fg)',
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
                                        )}
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
