'use client'

import { useState } from 'react'
import useSWR from 'swr'
import SafeDate from '@/components/SafeDate'
import ConfirmModal from '@/components/ConfirmModal'
import RoleSelect from '@/components/RoleSelect'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useLanguage } from '@/context/LanguageContext'
import { roleLabel } from '@/lib/role-label'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'

/**
 * Role change requests (ROLES_PLAN.md §6.9), both sides of one channel: a
 * company's Admins ask and follow their requests; the Super Admin answers
 * them, having made the change in the company's settings.
 */
type ChangeRequest = {
    id: string
    description: string
    status: 'OPEN' | 'DONE' | 'DECLINED'
    response: string | null
    createdAt: string
    company: { name: string }
    role: { id: string; name: string } | null
    requestedBy: { firstName: string; lastName: string }
    respondedBy: { firstName: string; lastName: string } | null
}

export default function RoleChangeRequests({ side, highlight }: { side: 'company' | 'superAdmin'; highlight?: string | null }) {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { showToast } = useToast()
    const [status, setStatus] = useState(side === 'superAdmin' ? 'OPEN' : '')
    const { data, mutate } = useSWR(`/api/role-change-requests${status ? `?status=${status}` : ''}`, fetcher)
    const requests: ChangeRequest[] = data?.data ?? []

    const [roleId, setRoleId] = useState('')
    const [description, setDescription] = useState('')
    const [sending, setSending] = useState(false)
    const [declining, setDeclining] = useState<ChangeRequest | null>(null)

    const ask = async () => {
        setSending(true)
        try {
            const res = await fetch('/api/role-change-requests', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roleId: roleId || null, description }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            showToast(t('role_changes_sent'), 'success')
            setDescription('')
            setRoleId('')
            mutate()
        } finally {
            setSending(false)
        }
    }

    const answer = async (request: ChangeRequest, next: 'DONE' | 'DECLINED', response?: string) => {
        const res = await fetch(`/api/role-change-requests/${request.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: next, response }),
        })
        if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
        showToast(t('role_changes_answered'), 'success')
        mutate()
    }

    const name = (p: { firstName: string; lastName: string } | null) => p ? `${p.firstName} ${p.lastName}` : ''

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', direction: isRtl ? 'rtl' : 'ltr' }}>
            {side === 'company' && (
                <div className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    <strong>{t('role_changes_ask')}</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>{t('role_changes_ask_hint')}</span>
                    <label style={{ fontSize: '0.85rem' }}>{t('role_changes_role')}</label>
                    <RoleSelect value={roleId} allowDefault emptyLabel={t('role_changes_new_role')} onChange={id => setRoleId(id)} />
                    <label style={{ fontSize: '0.85rem' }}>{t('role_changes_description')}</label>
                    <textarea className="input" rows={3} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} />
                    <div>
                        <button type="button" className="btn btn-primary" onClick={ask} disabled={sending || description.trim().length < 5}>{t('role_changes_send')}</button>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {(['OPEN', 'DONE', 'DECLINED', ''] as const).map(s => (
                    <button key={s || 'all'} type="button" onClick={() => setStatus(s)} className="badge"
                        style={{ cursor: 'pointer', background: status === s ? 'var(--primary)' : undefined, color: status === s ? 'var(--text-on-accent)' : undefined }}>
                        {s ? t(`role_change_${s}` as any) : t('role_requests_filter_all')}
                    </button>
                ))}
            </div>

            <div className="glass" style={{ padding: '1rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {requests.length === 0 ? <p style={{ margin: 0, color: 'var(--text-soft)' }}>{t('role_changes_empty')}</p> : requests.map(r => (
                    <div key={r.id} style={{ padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid var(--veil-40)', background: r.id === highlight ? 'var(--warn-bg-yellow-subtle)' : undefined }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                            <strong>{side === 'superAdmin' ? `${r.company.name} · ` : ''}{roleLabel(r.role, t, t('role_changes_new_role'))}</strong>
                            <span className="badge">{t(`role_change_${r.status}` as any)}</span>
                        </div>
                        <p style={{ margin: '0.4rem 0', whiteSpace: 'pre-wrap' }}>{r.description}</p>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{name(r.requestedBy)} · <SafeDate date={r.createdAt} /></div>
                        {r.response && (
                            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}><strong>{t('role_changes_response')}:</strong> {r.response}</p>
                        )}
                        {side === 'superAdmin' && r.status === 'OPEN' && (
                            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                                <button type="button" onClick={() => answer(r, 'DONE')} style={{ background: 'none', border: 'none', color: 'var(--brand-primary-text)', cursor: 'pointer', padding: 0 }}>{t('role_changes_done')}</button>
                                <button type="button" onClick={() => setDeclining(r)} style={{ background: 'none', border: 'none', color: 'var(--danger-solid)', cursor: 'pointer', padding: 0 }}>{t('role_changes_decline')}</button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <ConfirmModal
                isOpen={!!declining}
                title={t('role_changes_decline')}
                message={declining?.description ?? ''}
                variant="danger"
                reason={{ label: t('role_changes_response') }}
                onConfirm={(reason) => { const r = declining; setDeclining(null); if (r) answer(r, 'DECLINED', reason) }}
                onCancel={() => setDeclining(null)}
            />
        </div>
    )
}
