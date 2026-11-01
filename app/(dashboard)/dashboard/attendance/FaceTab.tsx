'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSearchParams } from 'next/navigation'
import { CalendarCheckIcon, CheckCircleIcon, ClockIcon, HourglassIcon, IdentificationBadgeIcon, InfoIcon, UsersIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, DataList, Dialog, DialogActions, EmptyState, Field, ItemTitle, ListCard, Row, Section, StatusBadge, TextArea, type Column } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useBusyAction } from '@/lib/useBusyAction'
import type { TranslationKey } from '@/lib/translations'
import { FacePhoto as Photo, useWatermark } from '@/components/FacePhoto'
import { send, json } from './send'
import { useFigures } from './period'

/**
 * Face verification for whoever holds attendance.approve_face
 * (ATTENDANCE_PLAN.md §9.5): the verification photos waiting for a decision,
 * and who it is asked of.
 *
 * A photo is fetched only while its review is open, through the review, and
 * each fetch is audited. It is shown with the viewer's name and the time
 * over it, so a screenshot says who took it.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 7, PR 153):
 * the photos waiting and who it's asked of as lists, a table on computers
 * and a card for each on phones (DESIGN.md §5.4); the overdue in a card that
 * waits on someone (§5.5); and deciding, rejecting and asking to re-verify
 * in the building blocks' dialog.
 */
type Review = { id: string; userId: string; name: string; purpose: 'ENROLMENT' | 'REVERIFY'; createdAt: string; attested: boolean; hasReference: boolean; prototype?: boolean }
type Person = { id: string; name: string; required: boolean; consentedAt: string | null }
type People = { company: { allowed: boolean; reason: string | null }; people: Person[]; overdue: { userId: string; name: string; since: string }[] }

export default function FaceTab({ q }: { q: string }) {
    const { t } = useLanguage()
    const { digits, date } = useFigures()
    const { showToast } = useToast()
    const params = useSearchParams()
    const reviewsList = useSWR(`/api/attendance/face/reviews?${q}`, fetcher)
    const peopleList = useSWR(`/api/attendance/face/people?${q}`, fetcher)
    const [openId, setOpenId] = useState<string | null>(params.get('review'))
    const [askingReverify, setAskingReverify] = useState<Person | null>(null)
    const action = useBusyAction()

    const failed = reviewsList.error ?? peopleList.error
    if (failed && (!reviewsList.data || !peopleList.data)) return (
        <div className="ui-panel">
            <EmptyState icon={WarningCircleIcon} title={t('face_load_failed')} detail={(failed as SWRError).info?.error}
                action={<Button busy={reviewsList.isValidating || peopleList.isValidating} onClick={() => { void reviewsList.mutate(); void peopleList.mutate() }}>{t('try_again')}</Button>} />
        </div>
    )
    if (!reviewsList.data || !peopleList.data) return <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>

    const reviews: Review[] = reviewsList.data.data
    const { company, people, overdue }: People = peopleList.data.data
    const open = reviews.find(r => r.id === openId) ?? null

    const setRequired = (person: Person, required: boolean) => action.run(`required-${person.id}`, async () => {
        const r = await send('/api/attendance/face/people', json('PUT', { userId: person.id, required }), t('error_generic'))
        if (!r.ok) return showToast(r.error, 'error')
        await peopleList.mutate()
    })
    // Not while it works: closing then would hide the answer.
    const closeReverify = () => { if (!action.running) setAskingReverify(null) }
    const reverify = () => action.run('reverify', async () => {
        if (!askingReverify) return
        const r = await send('/api/attendance/face/reverify', json('POST', { userId: askingReverify.id }), t('error_generic'))
        // Refused, it stays open, to try again.
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('face_reverify_sent'), 'success')
        setAskingReverify(null)
    })

    // When it was sent, on the viewer's clock, in the page's language.
    const sent = (r: Review) => new Date(r.createdAt).toLocaleString(digits, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const purpose = (r: Review) => t(r.purpose === 'ENROLMENT' ? 'audit_value_ENROLMENT' : 'audit_value_REVERIFY')
    // What to know before deciding: a phone the app couldn't vouch for, a photo from the test version.
    const notes = (r: Review) => [
        !r.attested ? t('att_flag_ATTESTATION_UNVERIFIED') : null,
        r.prototype ? t('face_review_prototype') : null,
    ].filter((n): n is string => !!n)
    const reviewButton = (r: Review) => <Button variant="primary" size="sm" onClick={() => setOpenId(r.id)}>{t('face_review_open')}</Button>
    const queueColumns: Column<Review>[] = [
        { key: 'person', header: t('punch_person'), cell: r => <><ItemTitle title={r.name} />{notes(r).map(n => <div key={n} className="ui-item-detail">{n}</div>)}</> },
        { key: 'purpose', header: t('face_purpose'), cell: purpose },
        { key: 'sent', header: t('face_sent'), cell: sent },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: reviewButton },
    ]

    const consented = (x: Person) => x.consentedAt
        ? new Date(x.consentedAt).toLocaleDateString(digits, { day: 'numeric', month: 'short', year: 'numeric' })
        : t('face_consent_none')
    // Not asked of anyone new while the company can't offer it; whoever is asked can still be let off.
    const asked = (x: Person) => (
        <label className="ui-check-target">
            <input type="checkbox" className="ui-check" aria-label={t('face_ask_of').replace('{name}', x.name)} checked={x.required}
                disabled={action.running || (!company.allowed && !x.required)} onChange={e => { void setRequired(x, e.target.checked) }} />
        </label>
    )
    // Only once it's asked of them and they consented.
    const reverifyButton = (x: Person) => x.required && x.consentedAt
        ? <Button size="sm" disabled={action.running} onClick={() => setAskingReverify(x)}>{t('face_reverify')}</Button>
        : null
    const peopleColumns: Column<Person>[] = [
        { key: 'person', header: t('punch_person'), cell: x => x.name },
        { key: 'asked', header: t('face_asked'), cell: asked },
        { key: 'consent', header: t('face_consent'), cell: consented },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: reverifyButton },
    ]

    return (
        <>
            {!company.allowed && <Card tone="waiting"><p>{t(`face_unavailable_${company.reason}` as TranslationKey)}</p></Card>}

            <Section title={t('face_queue')}>
                <p className="ui-hint">{t('face_queue_hint')}</p>
                <DataList caption={t('face_queue')} columns={queueColumns} rows={reviews} rowKey={r => r.id}
                    card={r => <ListCard title={r.name} details={[
                        { icon: IdentificationBadgeIcon, text: purpose(r) },
                        { icon: ClockIcon, text: sent(r) },
                        ...notes(r).map(n => ({ icon: InfoIcon, text: n })),
                    ]} foot={reviewButton(r)} />}
                    empty={<EmptyState icon={CheckCircleIcon} title={t('face_queue_none')} />} />
            </Section>

            {overdue.length > 0 && (
                <Card tone="waiting" title={t('face_overdue')}>
                    <p className="ui-card-note">{t('face_overdue_hint')}</p>
                    <ul className="ui-rows" aria-label={t('face_overdue')}>
                        {overdue.map(o => <Row key={o.userId} title={o.name} detail={t('face_overdue_since').replace('{date}', date(o.since))} />)}
                    </ul>
                </Card>
            )}

            <Section title={t('face_people')}>
                <p className="ui-hint">{t('face_people_hint')}</p>
                <DataList caption={t('face_people')} columns={peopleColumns} rows={people} rowKey={x => x.id}
                    card={x => <ListCard title={x.name} details={[{ icon: CalendarCheckIcon, text: `${t('face_consent')}: ${consented(x)}` }]}
                        foot={<span className="ui-row-actions">{asked(x)}{reverifyButton(x)}</span>} />}
                    empty={<EmptyState icon={UsersIcon} title={t('face_people_none')} />} />
            </Section>

            {open && <ReviewDialog review={open} onClose={() => setOpenId(null)} onDecided={() => { setOpenId(null); void reviewsList.mutate() }} />}

            {/* Asking to re-verify asks first: they'll be asked before their next check-in. */}
            <Dialog
                open={askingReverify !== null}
                onClose={closeReverify}
                title={t('face_reverify')}
                actions={<>
                    <Button onClick={closeReverify} disabled={action.running}>{t('cancel')}</Button>
                    <Button variant="primary" onClick={() => { void reverify() }} disabled={action.running} busy={action.is('reverify')}>{t('face_reverify')}</Button>
                </>}
            >
                <p>{t('face_reverify_confirm').replace('{name}', askingReverify?.name ?? '')}</p>
            </Dialog>
        </>
    )
}

/**
 * The new photo beside the current reference, to compare and decide. Rejecting
 * asks why in the same dialog, so the photos stay open: closed and opened
 * again, they'd be fetched, and recorded, again.
 */
function ReviewDialog({ review, onClose, onDecided }: { review: Review; onClose: () => void; onDecided: () => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const [rejecting, setRejecting] = useState(false)
    const [reason, setReason] = useState('')
    // Fixed when the photos open: the time a screenshot would show.
    const mark = useWatermark()

    const decide = (approve: boolean) => action.run(approve ? 'approve' : 'reject', async () => {
        const r = await send(`/api/attendance/face/reviews/${review.id}/decide`, json('POST', { approve, reason: approve ? null : reason.trim() || null }), t('error_generic'))
        // Refused, it stays open, to try again.
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t(approve ? 'face_approved_toast' : 'face_rejected_toast'), 'success')
        onDecided()
    })
    // Not while it works: closing then would hide the answer.
    const close = () => { if (!action.running) onClose() }

    return (
        <Dialog
            open
            onClose={close}
            title={rejecting ? t('face_reject_title') : t('face_review_title').replace('{name}', review.name)}
            actions={rejecting ? undefined : <>
                <Button onClick={() => setRejecting(true)} disabled={action.running}>{t('chk_reject')}</Button>
                <Button variant="primary" onClick={() => { void decide(true) }} disabled={action.running} busy={action.is('approve')}>{t('face_approve')}</Button>
            </>}
        >
            {/* Where the decision is made, not only in the list behind it (review on #28). */}
            {review.prototype && <p role="alert"><StatusBadge tone="waiting">{t('face_review_prototype')}</StatusBadge></p>}
            <p>{t(review.hasReference ? 'face_review_compare' : 'face_review_first')}</p>
            <div className="ui-face-photos">
                <Photo src={`/api/attendance/face/reviews/${review.id}/photo?which=new`} label={t('face_photo_new')} mark={mark} />
                {review.hasReference && <Photo src={`/api/attendance/face/reviews/${review.id}/photo?which=reference`} label={t('face_photo_reference')} mark={mark} />}
            </div>
            {rejecting && (
                <form className="ui-form" noValidate onSubmit={e => { e.preventDefault(); void decide(false) }}>
                    <p>{t('face_reject_hint')}</p>
                    <Field label={t('face_reject_reason')}>{f => (
                        <TextArea {...f} name="reason" dir="auto" maxLength={500} value={reason} disabled={action.running} onChange={e => setReason(e.target.value)} />
                    )}</Field>
                    <DialogActions>
                        <Button onClick={() => setRejecting(false)} disabled={action.running}>{t('go_back')}</Button>
                        <Button variant="danger" type="submit" disabled={action.running} busy={action.is('reject')}>{t('chk_reject')}</Button>
                    </DialogActions>
                </form>
            )}
        </Dialog>
    )
}
