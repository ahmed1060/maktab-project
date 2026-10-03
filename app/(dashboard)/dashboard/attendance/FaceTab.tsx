'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import LoadingSpinner from '@/components/LoadingSpinner'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import type { TranslationKey } from '@/lib/translations'
import { FacePhoto as Photo, useWatermark } from '@/components/FacePhoto'

/**
 * Face verification for whoever holds attendance.approve_face
 * (ATTENDANCE_PLAN.md §9.5): the verification photos waiting for a decision,
 * and who it is asked of.
 *
 * A photo is fetched only while its review is open, through the review, and
 * each fetch is audited. It is shown with the viewer's name and the time
 * over it, so a screenshot says who took it.
 */
type Review = { id: string; userId: string; name: string; purpose: 'ENROLMENT' | 'REVERIFY'; createdAt: string; attested: boolean; hasReference: boolean }
type Person = { id: string; name: string; required: boolean; consentedAt: string | null }
type People = { company: { allowed: boolean; reason: string | null }; people: Person[]; overdue: { userId: string; name: string; since: string }[] }

const box = { padding: '1.25rem', borderRadius: '1rem', display: 'grid', gap: '0.75rem' } as const
const soft = { color: 'var(--text-soft)', fontSize: '0.78rem' } as const

export default function FaceTab({ q }: { q: string }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const params = useSearchParams()
    const { data: reviewsBody, mutate: reloadReviews } = useSWR(`/api/attendance/face/reviews?${q}`, fetcher)
    const { data: peopleBody, mutate: reloadPeople } = useSWR(`/api/attendance/face/people?${q}`, fetcher)
    const [openId, setOpenId] = useState<string | null>(params.get('review'))
    const [busy, setBusy] = useState<string | null>(null)
    const [askingReverify, setAskingReverify] = useState<Person | null>(null)

    if (!reviewsBody || !peopleBody) return <LoadingSpinner />
    const reviews: Review[] = reviewsBody.data
    const { company, people, overdue }: People = peopleBody.data
    const open = reviews.find(r => r.id === openId) ?? null

    const send = async (url: string, body: unknown, method = 'POST') => {
        const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const text = await res.text()
        if (!res.ok) { showToast(apiErrorText(text, t('error_generic')), 'error'); return false }
        return true
    }
    const setRequired = async (person: Person, required: boolean) => {
        setBusy(person.id)
        try {
            if (await send('/api/attendance/face/people', { userId: person.id, required }, 'PUT')) reloadPeople()
        } catch { showToast(t('error_generic'), 'error') } finally { setBusy(null) }
    }
    const reverify = async (person: Person) => {
        setBusy(person.id)
        try {
            if (await send('/api/attendance/face/reverify', { userId: person.id })) showToast(t('face_reverify_sent'), 'success')
        } catch { showToast(t('error_generic'), 'error') } finally { setBusy(null); setAskingReverify(null) }
    }

    return (
        <div style={{ display: 'grid', gap: '1rem' }}>
            {!company.allowed && (
                <p className="glass" style={{ ...box, margin: 0, color: 'var(--warn-fg)' }}>{t(`face_unavailable_${company.reason}` as TranslationKey)}</p>
            )}

            <section className="glass" style={box}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('face_queue')}</h2>
                <p style={{ ...soft, margin: 0 }}>{t('face_queue_hint')}</p>
                {reviews.length === 0 ? <p style={{ ...soft, margin: 0 }}>{t('face_queue_none')}</p> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="table">
                            <thead><tr><th>{t('punch_person')}</th><th>{t('face_purpose')}</th><th>{t('face_sent')}</th><th /></tr></thead>
                            <tbody>
                                {reviews.map(r => (
                                    <tr key={r.id}>
                                        <td>{r.name}{!r.attested && <div style={{ ...soft, color: 'var(--warn-fg)' }}>{t('att_flag_ATTESTATION_UNVERIFIED')}</div>}</td>
                                        <td>{t(r.purpose === 'ENROLMENT' ? 'audit_value_ENROLMENT' : 'audit_value_REVERIFY')}</td>
                                        <td style={{ whiteSpace: 'nowrap' }}><bdi>{r.createdAt.slice(0, 10)} {r.createdAt.slice(11, 16)}</bdi></td>
                                        <td><button className="btn btn-primary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} onClick={() => setOpenId(r.id)}>{t('face_review_open')}</button></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {overdue.length > 0 && (
                <section className="glass" style={{ ...box, borderInlineStart: '4px solid var(--warn-solid)' }}>
                    <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('face_overdue')}</h2>
                    <p style={{ ...soft, margin: 0 }}>{t('face_overdue_hint')}</p>
                    <ul style={{ margin: 0, paddingInlineStart: '1.1rem', display: 'grid', gap: '0.25rem' }}>
                        {overdue.map(o => <li key={o.userId}>{o.name} <span style={soft}>· {t('face_overdue_since').replace('{date}', o.since)}</span></li>)}
                    </ul>
                </section>
            )}

            <section className="glass" style={box}>
                <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{t('face_people')}</h2>
                <p style={{ ...soft, margin: 0 }}>{t('face_people_hint')}</p>
                <div style={{ overflowX: 'auto' }}>
                    <table className="table">
                        <thead><tr><th>{t('punch_person')}</th><th>{t('face_asked')}</th><th>{t('face_consent')}</th><th /></tr></thead>
                        <tbody>
                            {people.map(person => (
                                <tr key={person.id}>
                                    <td>{person.name}</td>
                                    <td>
                                        <input type="checkbox" aria-label={t('face_asked')} checked={person.required} disabled={busy === person.id || (!company.allowed && !person.required)}
                                            onChange={e => setRequired(person, e.target.checked)} />
                                    </td>
                                    <td style={soft}>{person.consentedAt ? <bdi>{person.consentedAt.slice(0, 10)}</bdi> : t('face_consent_none')}</td>
                                    <td>{person.required && person.consentedAt && (
                                        <button className="btn btn-secondary" style={{ fontSize: '0.78rem', padding: '0.25rem 0.6rem' }} disabled={busy === person.id} onClick={() => setAskingReverify(person)}>{t('face_reverify')}</button>
                                    )}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>

            {open && <ReviewModal review={open} onClose={() => setOpenId(null)} onDecided={() => { setOpenId(null); reloadReviews() }} />}
            <ConfirmModal
                isOpen={!!askingReverify}
                title={t('face_reverify')}
                message={t('face_reverify_confirm').replace('{name}', askingReverify?.name ?? '')}
                onConfirm={() => askingReverify && reverify(askingReverify)}
                onCancel={() => setAskingReverify(null)}
            />
        </div>
    )
}

/** The new photo beside the current reference, to compare and decide. */
function ReviewModal({ review, onClose, onDecided }: { review: Review; onClose: () => void; onDecided: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const [rejecting, setRejecting] = useState(false)
    const [busy, setBusy] = useState(false)
    // Fixed when the photos open: the time a screenshot would show.
    const mark = useWatermark()

    const decide = async (approve: boolean, reason?: string) => {
        setBusy(true)
        try {
            const res = await fetch(`/api/attendance/face/reviews/${review.id}/decide`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approve, reason: reason ?? null }) })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t(approve ? 'face_approved_toast' : 'face_rejected_toast'), 'success')
            onDecided()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false); setRejecting(false) }
    }

    return (
        <Modal isOpen onClose={onClose} title={t('face_review_title').replace('{name}', review.name)}>
            <div style={{ display: 'grid', gap: '1rem' }}>
                <p style={{ ...soft, margin: 0 }}>{t(review.hasReference ? 'face_review_compare' : 'face_review_first')}</p>
                <div style={{ display: 'grid', gridTemplateColumns: review.hasReference ? 'repeat(auto-fit, minmax(12rem, 1fr))' : '1fr', gap: '0.75rem' }}>
                    <Photo src={`/api/attendance/face/reviews/${review.id}/photo?which=new`} label={t('face_photo_new')} mark={mark} />
                    {review.hasReference && <Photo src={`/api/attendance/face/reviews/${review.id}/photo?which=reference`} label={t('face_photo_reference')} mark={mark} />}
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button className="btn btn-secondary" disabled={busy} onClick={() => setRejecting(true)}>{t('chk_reject')}</button>
                    <button className="btn btn-primary" disabled={busy} onClick={() => decide(true)}>{t('face_approve')}</button>
                </div>
            </div>
            <ConfirmModal
                isOpen={rejecting}
                title={t('face_reject_title')}
                message={t('face_reject_hint')}
                variant="danger"
                reason={{ label: t('face_reject_reason'), minLength: 0 }}
                onConfirm={reason => decide(false, reason)}
                onCancel={() => setRejecting(false)}
            />
        </Modal>
    )
}
