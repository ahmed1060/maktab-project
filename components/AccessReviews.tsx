'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import ConfirmModal from '@/components/ConfirmModal'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { isPermission } from '@/lib/permissions/catalogue'
import { permissionLabelKey, scopeLabelKey } from '@/lib/permissions/matrix'

/**
 * Periodic access reviews (ROLES_PLAN.md §6.14): each review's lines — who
 * holds a sensitive permission, through which role — with Confirm or Request
 * change on each. For a company's Admins, their company's; for the Super
 * Admin, every company's, open ones first. Nobody answers their own line.
 */

type Person = { firstName: string; lastName: string }
type Line = {
    id: string; userId: string; permission: string; scope: string; roleName: string
    decision: 'CONFIRMED' | 'CHANGE_REQUESTED' | null; note: string | null
    user: Person; answeredBy: Person | null; answeredBySuperAdmin: Person | null
}
type Review = { id: string; status: 'OPEN' | 'COMPLETED'; createdAt: string; company: { name: string }; lines: Line[] }

export default function AccessReviews({ side, highlight }: { side: 'company' | 'superAdmin'; highlight?: string | null }) {
    const { t, locale } = useLanguage()
    const isRtl = locale === 'ar'
    const { showToast } = useToast()
    const { data: session } = useSession()
    const [status, setStatus] = useState<'OPEN' | ''>('OPEN')
    const [changing, setChanging] = useState<Line | null>(null)
    const { data, mutate } = useSWR(`/api/access-reviews${status ? `?status=${status}` : ''}`, fetcher)
    const reviews: Review[] = data?.data ?? []

    const name = (p: Person | null) => p ? `${p.firstName} ${p.lastName}` : ''
    const label = (p: string) => isPermission(p) ? t(permissionLabelKey(p)) : p

    const answer = async (line: Line, decision: 'CONFIRMED' | 'CHANGE_REQUESTED', note?: string) => {
        const res = await fetch(`/api/access-reviews/lines/${line.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision, note }),
        })
        if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
        showToast(t('access_review_answered'), 'success')
        mutate()
    }

    const cell = { padding: '0.55rem 0.6rem', borderTop: '1px solid var(--veil-40)', textAlign: (isRtl ? 'right' : 'left') as 'right' | 'left', verticalAlign: 'top' as const }
    const linkButton = { background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: 0, font: 'inherit', fontSize: '0.85rem' }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', direction: isRtl ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
                {(['OPEN', ''] as const).map(s => (
                    <button key={s || 'all'} type="button" onClick={() => setStatus(s)} className="badge"
                        style={{ cursor: 'pointer', background: status === s ? 'var(--primary)' : undefined, color: status === s ? 'var(--text-on-accent)' : undefined }}>
                        {s ? t('access_review_open') : t('role_requests_filter_all')}
                    </button>
                ))}
            </div>

            {reviews.length === 0 ? (
                <div className="glass" style={{ padding: '1.25rem', borderRadius: '1rem', color: 'var(--text-soft)' }}>{t('access_review_empty')}</div>
            ) : reviews.map(review => {
                const remaining = review.lines.filter(l => !l.decision).length
                return (
                    <div key={review.id} className="glass" style={{ padding: '1rem', borderRadius: '1rem', overflowX: 'auto', outline: review.id === highlight ? '2px solid var(--warn-border)' : undefined }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
                            <strong>
                                {side === 'superAdmin' ? `${review.company.name} · ` : ''}
                                {t('access_review_opened').replace('{date}', new Date(review.createdAt).toLocaleDateString(locale))}
                            </strong>
                            <span className="badge">
                                {review.status === 'COMPLETED' ? t('access_review_completed') : t('access_review_remaining').replace('{count}', String(remaining))}
                            </span>
                        </div>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <tbody>
                                {review.lines.map(line => (
                                    <tr key={line.id}>
                                        <td style={cell}>{name(line.user)}</td>
                                        <td style={cell}>{label(line.permission)}<div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>{t(scopeLabelKey(line.scope as any))}</div></td>
                                        <td style={cell}>{line.roleName}</td>
                                        <td style={{ ...cell, whiteSpace: 'nowrap' }}>
                                            {line.decision ? (
                                                <span style={{ fontSize: '0.85rem' }}>
                                                    {line.decision === 'CONFIRMED' ? t('access_review_confirmed') : t('access_review_change_requested')}
                                                    <span style={{ color: 'var(--text-soft)' }}> · {name(line.answeredBy ?? line.answeredBySuperAdmin)}</span>
                                                    {line.note && <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)', whiteSpace: 'normal' }}>{line.note}</div>}
                                                </span>
                                            ) : side === 'superAdmin' || line.userId !== session?.user?.id ? (
                                                <span style={{ display: 'flex', gap: '0.75rem' }}>
                                                    <button type="button" style={linkButton} onClick={() => answer(line, 'CONFIRMED')}>{t('access_review_confirm')}</button>
                                                    <button type="button" style={{ ...linkButton, color: 'var(--danger-solid)' }} onClick={() => setChanging(line)}>{t('access_review_change')}</button>
                                                </span>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )
            })}

            <ConfirmModal
                isOpen={!!changing}
                title={t('access_review_change')}
                message={changing ? `${name(changing.user)} · ${label(changing.permission)} · ${changing.roleName}` : ''}
                variant="warning"
                reason={{ label: t('access_review_change_reason') }}
                onConfirm={(reason) => { const line = changing; setChanging(null); if (line) answer(line, 'CHANGE_REQUESTED', reason) }}
                onCancel={() => setChanging(null)}
            />
        </div>
    )
}
