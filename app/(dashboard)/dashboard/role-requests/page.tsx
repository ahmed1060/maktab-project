'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import SafeDate from '@/components/SafeDate'
import { refusalOf } from '@/components/CompanyRolesCard'
import RoleChangeRequests from '@/components/RoleChangeRequests'
import AccessReviews from '@/components/AccessReviews'
import SegmentedToggle from '@/components/SegmentedToggle'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { useCan } from '@/lib/useCan'
import { fetcher } from '@/lib/swr-fetcher'

/**
 * Role requests (ROLES_PLAN.md §6.12): the queue for whoever decides them, and
 * the list of their own for whoever makes them. The server decides who may do
 * what with each; the buttons here only save a refusal.
 */

type Person = { id: string; firstName: string; lastName: string }
type RoleRequest = {
    id: string
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
    note: string | null
    actingUntil: string | null
    decisionNote: string | null
    createdAt: string
    user: Person & { assignedRole: { id: string; name: string } | null }
    role: { id: string; name: string }
    requestedBy: Person
    decidedBy: Person | null
}

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const
const nameOf = (p: Person | null) => p ? `${p.firstName} ${p.lastName}` : ''

export default function RoleRequestsPage() {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const { can } = useCan()
    const searchParams = useSearchParams()
    const highlight = searchParams.get('highlight')
    // Asking the Super Admin to change a role (§6.9) is for whoever gives
    // roles here; the second tab is theirs.
    const [tab, setTab] = useState<'assign' | 'changes' | 'reviews'>(
        searchParams.get('tab') === 'changes' ? 'changes' : searchParams.get('tab') === 'reviews' ? 'reviews' : 'assign',
    )
    const mayDecide = can('employees.assign_role')
    const maySee = mayDecide || can('employees.request_role')

    const [status, setStatus] = useState<string>('PENDING')
    const [declining, setDeclining] = useState<RoleRequest | null>(null)
    const [busy, setBusy] = useState<string | null>(null)
    const { data, isLoading, mutate } = useSWR(maySee ? `/api/role-requests${status ? `?status=${status}` : ''}` : null, fetcher)
    const requests: RoleRequest[] = data?.data ?? []

    useEffect(() => {
        setTitle(t('role_requests_title'))
        setSubtitle(t('role_requests_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (session?.user && !maySee) return <AccessDenied />

    const act = async (request: RoleRequest, action: 'APPROVE' | 'REJECT' | 'CANCEL', note?: string) => {
        setBusy(request.id)
        try {
            const res = await fetch(`/api/role-requests/${request.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, note }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('role_requests_decided'), 'success')
            mutate()
        } finally {
            setBusy(null)
        }
    }

    const cell = { padding: '0.75rem', borderTop: '1px solid var(--veil-40)', textAlign: (isRtl ? 'right' : 'left') as 'right' | 'left', verticalAlign: 'top' as const }
    const linkButton = { background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: '0.85rem' }

    const tabs = mayDecide && (
        <SegmentedToggle
            value={tab}
            onChange={(next: 'assign' | 'changes' | 'reviews') => setTab(next)}
            ariaLabel={t('role_requests_title')}
            options={[
                { value: 'assign', label: t('role_changes_tab_assign') },
                { value: 'changes', label: t('role_changes_tab_changes') },
                // Periodic access review (§6.14), when the company has it.
                { value: 'reviews', label: t('access_review_tab') },
            ]}
        />
    )
    if (tab === 'reviews' && mayDecide) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {tabs}
                <AccessReviews side="company" highlight={highlight} />
            </div>
        )
    }
    if (tab === 'changes' && mayDecide) {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {tabs}
                <RoleChangeRequests side="company" highlight={highlight} />
            </div>
        )
    }

    return (
        <div style={{ direction: isRtl ? 'rtl' : 'ltr', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {tabs}
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[...STATUSES, ''].map(s => (
                    <button key={s || 'all'} type="button" onClick={() => setStatus(s)} className="badge"
                        style={{ cursor: 'pointer', background: status === s ? 'var(--primary)' : undefined, color: status === s ? 'var(--text-on-accent)' : undefined }}>
                        {s ? t(`role_request_${s}` as any) : t('role_requests_filter_all')}
                    </button>
                ))}
            </div>

            <div className="glass" style={{ padding: '1rem', borderRadius: '1rem', overflowX: 'auto' }}>
                {isLoading ? <LoadingSpinner /> : requests.length === 0 ? (
                    <p style={{ margin: 0, color: 'var(--text-soft)' }}>{t('role_requests_empty')}</p>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={cell}>{t('role_requests_person')}</th>
                                <th style={cell}>{t('role_requests_change')}</th>
                                <th style={cell}>{t('role_requests_by')}</th>
                                <th style={cell}>{t('role_requests_status')}</th>
                                <th style={cell}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.map(r => {
                                const mine = r.requestedBy.id === session?.user?.id
                                return (
                                    <tr key={r.id} style={r.id === highlight ? { background: 'var(--warn-bg-yellow-subtle)' } : undefined}>
                                        <td style={cell}>{nameOf(r.user)}</td>
                                        <td style={cell}>
                                            {r.user.assignedRole?.name ?? '—'} → <strong>{r.role.name}</strong>
                                            {r.actingUntil && (
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>
                                                    {t('acting_now').replace('{date}', new Date(r.actingUntil).toLocaleDateString(locale)).replace('{role}', r.user.assignedRole?.name ?? '—')}
                                                </div>
                                            )}
                                            {r.note && <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>{r.note}</div>}
                                        </td>
                                        <td style={cell}>
                                            {nameOf(r.requestedBy)}
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}><SafeDate date={r.createdAt} /></div>
                                        </td>
                                        <td style={cell}>
                                            {t(`role_request_${r.status}` as any)}
                                            {r.decidedBy && <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{nameOf(r.decidedBy)}</div>}
                                            {r.decisionNote && <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>{r.decisionNote}</div>}
                                        </td>
                                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                                            {r.status === 'PENDING' && (
                                                <div style={{ display: 'flex', gap: '0.75rem' }}>
                                                    {mayDecide && !mine && (
                                                        <>
                                                            <button type="button" style={linkButton} disabled={busy === r.id} onClick={() => act(r, 'APPROVE')}>{t('role_requests_approve')}</button>
                                                            <button type="button" style={{ ...linkButton, color: 'var(--danger-solid)' }} disabled={busy === r.id} onClick={() => setDeclining(r)}>{t('role_requests_reject')}</button>
                                                        </>
                                                    )}
                                                    {mine && (
                                                        <button type="button" style={linkButton} disabled={busy === r.id} onClick={() => act(r, 'CANCEL')}>{t('role_requests_cancel')}</button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            <ConfirmModal
                isOpen={!!declining}
                title={t('role_requests_reject')}
                message={declining ? `${nameOf(declining.user)} → ${declining.role.name}` : ''}
                variant="danger"
                reason={{ label: t('role_requests_reason') }}
                onConfirm={(reason) => { const r = declining; setDeclining(null); if (r) act(r, 'REJECT', reason) }}
                onCancel={() => setDeclining(null)}
            />
        </div>
    )
}
