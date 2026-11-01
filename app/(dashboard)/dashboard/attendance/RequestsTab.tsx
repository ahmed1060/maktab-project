'use client'

import { useMemo, useState } from 'react'
import { Button, ButtonLink, Card, Dialog, DialogActions, Field, Select, TextInput } from '@/components/ui'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useBusyAction } from '@/lib/useBusyAction'
import DatePickerSingle from '@/components/DatePickerSingle'
import type { TranslationKey } from '@/lib/translations'
import { AskPermission, ReportMissingPunch } from '../requests/AttendanceDialogs'
import { send, json } from './send'

/**
 * Requests (P0.6): one's own phone, and a pointer to the one Requests page
 * (UI_PLAN.md §2.3, parts 3c and 4d), where one's own requests are, and what
 * waits on whoever decides permission hours, missing punches, overtime,
 * check-in phones and flagged check-ins. Approving overtime ahead stays here.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 7, PR 153):
 * a card each, and asking from a day with the Requests page's own forms, in
 * the building blocks' dialog.
 */

type Person = { id: string; name: string; teamLeaderId: string | null }
type Phone = { model: string | null; platform: string }

export default function RequestsTab({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { data: session } = useSession()
    const asks = session?.user?.role !== 'SUPER_ADMIN'
    return (
        <>
            {asks && <MyPhone />}
            {asks && <MyRequests />}
            <ToDecide q={q} companyId={companyId} today={today} />
        </>
    )
}

// --- one's own -----------------------------------------------------------------

/**
 * The phone one checks in from (ATTENDANCE_PLAN.md §9.2, §9.3): registered in
 * the app; seen here, and a new one waiting can be cancelled. Not there for a
 * company without the Mobile App add-on.
 */
function MyPhone() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const [cancelling, setCancelling] = useState(false)
    const { data, error, mutate } = useSWR('/api/attendance/phone', fetcher)
    if (error || !data?.data) return null
    const { active, pending } = data.data as { active: Phone | null; pending: Phone | null }
    const label = (ph: Phone) => ph.model || t(`audit_value_${ph.platform}` as TranslationKey)
    // Not while it works: closing then would hide the answer.
    const close = () => { if (!action.running) setCancelling(false) }
    const withdraw = () => action.run('withdraw-phone', async () => {
        const r = await send('/api/attendance/phone', { method: 'DELETE' }, t('punch_failed'))
        // Refused, it stays open, to try again.
        if (!r.ok) return showToast(r.error, 'error')
        showToast(t('req_my_phone_withdrawn'), 'success')
        setCancelling(false)
        await mutate()
    })
    return (
        <Card title={t('req_my_phone')}>
            {!active && !pending && <p className="ui-card-note">{t('req_my_phone_none')}</p>}
            {active && <p>{t('req_my_phone_in_use').replace('{model}', label(active))}</p>}
            {pending && <p>{t('req_my_phone_waiting').replace('{model}', label(pending))}</p>}
            {pending && <div className="ui-card-actions"><Button onClick={() => setCancelling(true)}>{t('req_my_phone_withdraw')}</Button></div>}
            {/* Cancelling asks first: check-ins from the new phone won't count. Its other button
                keeps the request, not another "Cancel" beside "Cancel the new phone". */}
            <Dialog
                open={cancelling}
                onClose={close}
                title={t('req_my_phone_withdraw')}
                actions={<>
                    <Button onClick={close} disabled={action.running}>{t('req_my_phone_keep')}</Button>
                    <Button variant="danger" onClick={() => { void withdraw() }} disabled={action.running} busy={action.is('withdraw-phone')}>{t('req_my_phone_withdraw')}</Button>
                </>}
            >
                <p>{t('req_my_phone_withdraw_confirm')}</p>
            </Dialog>
        </Card>
    )
}

/**
 * One's own permission hours and missing punches are asked for, followed and
 * withdrawn on the one Requests page (UI_PLAN.md §2.3, part 3c): this points
 * there. Asking from a day on the Days tab opens the forms below.
 */
function MyRequests() {
    const { t } = useLanguage()
    return (
        <Card title={t('req_mine')}>
            <p>{t('requests_moved_mine')}</p>
            <div className="ui-card-actions"><ButtonLink href="/dashboard/requests?tab=mine">{t('requests_open_mine')}</ButtonLink></div>
        </Card>
    )
}

/**
 * Asks for permission hours from a day on the Days tab, or a late check-in,
 * with its times filled in (§13.3): the Requests page's own form, in the
 * building blocks' dialog.
 */
export function AskPermissionDialog({ today, initial, onClose, onDone }: {
    today: string
    initial?: Parameters<typeof AskPermission>[0]['initial']
    onClose: () => void
    onDone: () => void
}) {
    const { t } = useLanguage()
    return (
        <Dialog open onClose={onClose} title={t('req_ask_permission')}>
            <AskPermission today={today} initial={initial} onCancel={onClose} onAsked={onDone} />
        </Dialog>
    )
}

/** Reports a punch one forgot, from a day on the Days tab, for that day (§13.3): the Requests page's own form. */
export function ReportMissingDialog({ today, initial, onClose, onDone }: {
    today: string
    initial?: Parameters<typeof ReportMissingPunch>[0]['initial']
    onClose: () => void
    onDone: () => void
}) {
    const { t } = useLanguage()
    return (
        <Dialog open onClose={onClose} title={t('req_report_missing')}>
            <ReportMissingPunch today={today} initial={initial} onCancel={onClose} onReported={onDone} />
        </Dialog>
    )
}

// --- to decide -------------------------------------------------------------------

/**
 * What waits on this person is decided on the one Requests page, under To
 * review (UI_PLAN.md §2.3, parts 3c and 4d): permission hours, missing
 * punches, overtime, check-in phones and flagged check-ins. This points
 * there. Approving overtime ahead of its day stays here, in its own card: it
 * isn't a request (decided on 2026-10-31).
 */
function ToDecide({ q, companyId, today }: { q: string; companyId: string | null; today: string }) {
    const { t } = useLanguage()
    const p = useCan()
    const { data: session } = useSession()
    const me = session?.user?.id
    const decidesPermissions = p.can('attendance.approve_permissions')
    const decidesOvertime = p.can('attendance.approve_overtime')
    const decidesMissing = p.can('attendance.correct')
    const decidesPhones = p.can('attendance.approve_devices')
    const [approvingAhead, setApprovingAhead] = useState(false)
    const { data: peopleBody } = useSWR(decidesOvertime ? `/api/attendance/people?${q}` : null, fetcher)
    const people: Person[] = useMemo(() => peopleBody?.data?.people ?? [], [peopleBody])

    if (!decidesPermissions && !decidesOvertime && !decidesMissing && !decidesPhones) return null

    return (
        <>
            <Card title={t('req_to_decide')}>
                <p>{t('requests_moved_review')}</p>
                <div className="ui-card-actions"><ButtonLink href="/dashboard/requests?tab=review">{t('requests_open_review')}</ButtonLink></div>
            </Card>
            {decidesOvertime && (
                <Card title={t('req_overtime_ahead_title')}>
                    <p>{t('requests_overtime_ahead_line')}</p>
                    <div className="ui-card-actions"><Button onClick={() => setApprovingAhead(true)}>{t('req_overtime_ahead')}</Button></div>
                </Card>
            )}
            {approvingAhead && (
                <Dialog open onClose={() => setApprovingAhead(false)} title={t('req_overtime_ahead')}>
                    <OvertimeAheadForm
                        today={today}
                        companyId={companyId}
                        people={people.filter(x => x.id !== me && p.canFor('attendance.approve_overtime', x.id, x.teamLeaderId))}
                        onCancel={() => setApprovingAhead(false)}
                        onDone={() => setApprovingAhead(false)}
                    />
                </Dialog>
            )}
        </>
    )
}

type AheadErrors = { userId?: string; date?: string; hours?: string }

/** What's missing from overtime approved ahead, under its field: whose, the day, and from half an hour to 24 hours. */
export function overtimeAheadErrors(v: { userId: string; date: string; hours: string }, t: (key: TranslationKey) => string): AheadErrors {
    const minutes = Math.round(Number(v.hours) * 60)
    const found: AheadErrors = {
        userId: !v.userId ? t('req_overtime_person_missing') : undefined,
        date: !v.date ? t('req_overtime_date_missing') : undefined,
        // The server's own bounds (lib/validations/attendance-request.schema.ts), from the half hours the field steps in.
        hours: v.hours.trim() === '' || !(minutes >= 30 && minutes <= 1440) ? t('req_overtime_hours_invalid') : undefined,
    }
    return Object.fromEntries(Object.entries(found).filter(([, e]) => e)) as AheadErrors
}

/** Overtime approved before its day: whose, the day, how many hours at most, and a note. */
export function OvertimeAheadForm({ today, companyId, people, onCancel, onDone }: {
    today: string
    companyId: string | null
    people: Person[]
    onCancel: () => void
    onDone: () => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const [userId, setUserId] = useState('')
    const [date, setDate] = useState(today)
    const [hours, setHours] = useState('')
    const [note, setNote] = useState('')
    const [errors, setErrors] = useState<AheadErrors>({})

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        const found = overtimeAheadErrors({ userId, date, hours }, t)
        setErrors(found)
        if (Object.keys(found).length > 0) {
            // To the first field that needs fixing, once it's marked: the day's picker is a button.
            requestAnimationFrame(() => form.querySelector<HTMLElement>(!found.userId && found.date ? '.ui-date-trigger' : '[aria-invalid="true"]')?.focus())
            return
        }
        void action.run('approve', async () => {
            const minutes = Math.round(Number(hours) * 60)
            const r = await send('/api/attendance/overtime', json('POST', { ...(companyId ? { companyId } : {}), userId, date, status: 'APPROVED', minutes, note: note.trim() || null }), t('punch_failed'))
            // Refused, it stays open with what's typed, to try again.
            if (!r.ok) return showToast(r.error, 'error')
            showToast(t('req_approved'), 'success')
            onDone()
        })
    }

    return (
        <form className="ui-form" noValidate onSubmit={submit}>
            <p className="ui-hint">{t('req_overtime_ahead_hint')}</p>
            <Field label={t('punch_person')} error={errors.userId}>{f => (
                <Select {...f} name="person" value={userId} disabled={action.running}
                    onChange={e => { setUserId(e.target.value); setErrors(x => ({ ...x, userId: undefined })) }}
                    options={[{ value: '', label: t('punch_choose_person') }, ...people.map(x => ({ value: x.id, label: x.name }))]} />
            )}</Field>
            <DatePickerSingle asField label={t('punch_date')} value={date} error={errors.date} disabled={action.running}
                onChange={day => { setDate(day); setErrors(x => ({ ...x, date: undefined })) }} />
            <Field label={t('req_hours')} error={errors.hours}>{f => (
                <TextInput {...f} name="hours" type="number" inputMode="decimal" min="0.5" max="24" step="0.5" autoComplete="off" value={hours} disabled={action.running}
                    onChange={e => { setHours(e.target.value); setErrors(x => ({ ...x, hours: undefined })) }} />
            )}</Field>
            <Field label={t('req_note')}>{f => (
                <TextInput {...f} name="note" dir="auto" autoComplete="off" maxLength={500} value={note} disabled={action.running} onChange={e => setNote(e.target.value)} />
            )}</Field>
            <DialogActions>
                <Button onClick={onCancel} disabled={action.running}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" disabled={action.running} busy={action.is('approve')}>{t('req_approve')}</Button>
            </DialogActions>
        </form>
    )
}
