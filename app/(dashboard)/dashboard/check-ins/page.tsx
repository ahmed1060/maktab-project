'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import LoadingSpinner from '@/components/LoadingSpinner'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import type { TranslationKey } from '@/lib/translations'

/**
 * The Super Admin's check-in review (ATTENDANCE_PLAN.md §9.6, §13.7).
 *
 * First, the check-ins waiting for them: those our app couldn't prove came
 * from itself, while attestation is in testing. Each shows where it was
 * taken and how it compares to the place, to accept or reject.
 *
 * Then, across every company over the last 30 days, what came in, what was
 * flagged and what was refused, and why. A company with a sudden run of
 * refusals is under attack or has a broken app release.
 */

type Waiting = {
    id: string; companyName: string; name: string; at: string; flagReasons: string[]
    checkIn: { latitude?: number; longitude?: number; distanceMeters?: number; accuracyMeters?: number; ip?: string | null } | null
    workLocation: { name: string } | null; phone: { model: string | null; platform: string } | null
}
type Integrity = { companyId: string; name: string; checkIns: number; accepted: number; flagged: number; refused: number; refusedBy: Record<string, number>; flaggedBy: Record<string, number> }

const soft = { color: 'var(--text-soft)', fontSize: '0.78rem' } as const
const small = { fontSize: '0.78rem', padding: '0.25rem 0.6rem' } as const
const box = { padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '0.75rem' } as const
const mapLink = (lat: number, lng: number) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`

export default function CheckInReviewPage() {
    const { t } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { showToast } = useToast()
    const { data: session } = useSession()
    const superAdmin = session?.user?.role === 'SUPER_ADMIN'
    const { data, error, mutate } = useSWR(superAdmin ? '/api/admin/check-ins' : null, fetcher)
    const [rejecting, setRejecting] = useState<Waiting | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        setTitle(t('chk_title'))
        setSubtitle(t('chk_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (session && !superAdmin) return <AccessDenied />
    if (error) return <p style={{ color: 'var(--danger-fg)' }}>{t('error_generic')}</p>
    if (!data) return <LoadingSpinner />
    const queue: Waiting[] = data.data.queue
    const integrity: Integrity[] = data.data.integrity

    const decide = async (w: Waiting, accept: boolean, reason?: string) => {
        setBusy(true)
        try {
            const res = await fetch(`/api/attendance/flagged/${w.id}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept, reason: reason ?? null }) })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t(accept ? 'chk_accepted_toast' : 'chk_rejected_toast'), 'success')
            mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false) }
    }
    const reasons = (by: Record<string, number>, prefix: 'att_flag_' | 'att_refusal_') =>
        Object.entries(by).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${t(`${prefix}${r}` as TranslationKey)} ${n}`).join(' · ')

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            <section className="glass" style={box}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('chk_queue')}</h2>
                <p style={{ margin: 0, ...soft }}>{t('chk_queue_hint')}</p>
                {queue.length === 0 ? <p style={{ margin: 0, ...soft }}>{t('chk_queue_none')}</p> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('chk_company')}</th><th>{t('punch_person')}</th><th>{t('punch_time')}</th><th>{t('req_flagged_why')}</th><th /></tr></thead>
                            <tbody>
                                {queue.map(w => (
                                    <tr key={w.id}>
                                        <td>{w.companyName}</td>
                                        <td>{w.name}<div style={soft}>{w.phone?.model || (w.phone && t(`audit_value_${w.phone.platform}` as TranslationKey))}</div></td>
                                        <td style={{ whiteSpace: 'nowrap' }}><bdi>{w.at.slice(0, 10)} {w.at.slice(11, 16)}</bdi><div style={soft}>{w.workLocation?.name ?? '—'}</div></td>
                                        <td>
                                            {w.flagReasons.map(r => t(`att_flag_${r}` as TranslationKey)).join(', ')}
                                            <div style={soft}>
                                                {[
                                                    w.checkIn?.distanceMeters !== undefined && t('req_flagged_distance').replace('{n}', String(w.checkIn.distanceMeters)),
                                                    w.checkIn?.accuracyMeters !== undefined && t('req_flagged_accuracy').replace('{n}', String(Math.round(w.checkIn.accuracyMeters))),
                                                    w.checkIn?.ip,
                                                ].filter(Boolean).join(' · ')}
                                                {w.checkIn?.latitude !== undefined && w.checkIn?.longitude !== undefined && (
                                                    <> · <a href={mapLink(w.checkIn.latitude, w.checkIn.longitude)} target="_blank" rel="noopener noreferrer">{t('att_loc_map')}</a></>
                                                )}
                                            </div>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                                <button className="btn btn-primary" style={small} disabled={busy} onClick={() => decide(w, true)}>{t('chk_accept')}</button>
                                                <button className="btn btn-secondary" style={small} disabled={busy} onClick={() => setRejecting(w)}>{t('chk_reject')}</button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <section className="glass" style={box}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('chk_integrity')}</h2>
                <p style={{ margin: 0, ...soft }}>{t('chk_integrity_hint').replace('{n}', String(data.data.days))}</p>
                {integrity.length === 0 ? <p style={{ margin: 0, ...soft }}>{t('chk_integrity_none')}</p> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table" style={{ width: '100%', fontSize: '0.84rem' }}>
                            <thead><tr><th>{t('chk_company')}</th><th>{t('chk_checkins')}</th><th>{t('chk_flagged')}</th><th>{t('chk_refused')}</th></tr></thead>
                            <tbody>
                                {integrity.map(r => (
                                    <tr key={r.companyId}>
                                        <td>{r.name}</td>
                                        <td>{r.checkIns}<div style={soft}>{t('chk_accepted_n').replace('{n}', String(r.accepted))}</div></td>
                                        <td>{r.flagged}<div style={soft}>{reasons(r.flaggedBy, 'att_flag_')}</div></td>
                                        <td style={{ color: r.refused > 0 ? 'var(--danger-fg)' : undefined }}>{r.refused}<div style={soft}>{reasons(r.refusedBy, 'att_refusal_')}</div></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            <ConfirmModal
                isOpen={!!rejecting}
                title={t('chk_reject')}
                message={t('chk_reject_hint')}
                confirmText={t('chk_reject')}
                variant="danger"
                reason={{ label: t('punch_reason'), minLength: 0 }}
                onConfirm={(reason?: string) => { const w = rejecting; setRejecting(null); if (w) decide(w, false, reason) }}
                onCancel={() => setRejecting(null)}
            />
        </div>
    )
}
