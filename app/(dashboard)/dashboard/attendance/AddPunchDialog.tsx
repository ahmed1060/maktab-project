'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useBusyAction } from '@/lib/useBusyAction'
import type { TranslationKey } from '@/lib/translations'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog, DialogActions, Field, Select, TextArea, TextInput } from '@/components/ui'
import { send, json } from './send'

/**
 * A punch added by hand, for somebody else, with a reason (ATTENDANCE_PLAN.md §14).
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Attendance part 7, PR 153):
 * a form in the building blocks' dialog, which says what's missing under its
 * field, from Punches and from a missing punch on Exceptions.
 */

type Person = { id: string; name: string; teamLeaderId: string | null }
type Props = {
    companyId: string | null
    today: string
    people: Person[]
    /** Where to start: the person and day a missing punch is for. */
    initial?: { userId?: string; date?: string; direction?: 'IN' | 'OUT' }
}
type Errors = { userId?: string; date?: string; time?: string; note?: string }

/** The server's own limit on a reason (lib/validations/attendance-punch.schema.ts). */
const NOTE_MAX = 500

export default function AddPunchDialog({ onClose, onAdded, ...props }: Props & { onClose: () => void; onAdded: () => void }) {
    const { t } = useLanguage()
    // Closing is the form's to allow: not while it works, which would hide the answer.
    const [running, setRunning] = useState(false)
    const close = () => { if (!running) onClose() }
    return (
        <Dialog open onClose={close} title={t('punch_add')}>
            <AddPunchForm {...props} onRunning={setRunning} onCancel={close} onAdded={onAdded} />
        </Dialog>
    )
}

/** What's missing from a punch added by hand, under its field: whose, the day, the time and why. */
export function punchFormErrors(v: { userId: string; date: string; time: string; note: string }, t: (key: TranslationKey) => string): Errors {
    const found: Errors = {
        userId: !v.userId ? t('punch_person_missing') : undefined,
        date: !v.date ? t('punch_date_missing') : undefined,
        time: !v.time ? t('punch_time_missing') : undefined,
        // The punch service refuses one without (REASON_REQUIRED).
        note: !v.note.trim() ? t('punch_reason_required') : undefined,
    }
    return Object.fromEntries(Object.entries(found).filter(([, e]) => e)) as Errors
}

export function AddPunchForm({ companyId, today, people, initial, onRunning, onCancel, onAdded }: Props & {
    onRunning?: (running: boolean) => void
    onCancel: () => void
    onAdded: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const action = useBusyAction()
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const [userId, setUserId] = useState(initial?.userId ?? '')
    const [date, setDate] = useState(initial?.date ?? today)
    const [time, setTime] = useState('')
    const [direction, setDirection] = useState<'' | 'IN' | 'OUT'>(initial?.direction ?? '')
    const [note, setNote] = useState('')
    const [errors, setErrors] = useState<Errors>({})
    const clear = (k: keyof Errors) => setErrors(x => ({ ...x, [k]: undefined }))

    const submit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        const found = punchFormErrors({ userId, date, time, note }, t)
        setErrors(found)
        if (Object.keys(found).length > 0) {
            // To the first field that needs fixing, once it's marked: the day's picker is a button.
            requestAnimationFrame(() => form.querySelector<HTMLElement>(!found.userId && found.date ? '.ui-date-trigger' : '[aria-invalid="true"]')?.focus())
            return
        }
        onRunning?.(true)
        void action.run('add', async () => {
            try {
                const r = await send('/api/attendance/punches', json('POST', {
                    ...(companyId ? { companyId } : {}), userId, at: `${date}T${time}`, direction: direction || null, note: note.trim(),
                }), t('punch_failed'))
                // Refused, it stays open with what's typed, to try again.
                if (!r.ok) return showToast(r.error, 'error')
                showToast(t('punch_added'), 'success')
                onAdded()
            } finally { onRunning?.(false) }
        })
    }

    return (
        <form className="ui-form" noValidate onSubmit={submit}>
            <Field label={t('punch_person')} error={errors.userId}>{f => (
                <Select {...f} name="person" value={userId} disabled={action.running}
                    onChange={e => { setUserId(e.target.value); clear('userId') }}
                    options={[{ value: '', label: t('punch_choose_person') }, ...people.map(x => ({ value: x.id, label: x.name }))]} />
            )}</Field>
            {/* A punch is something that happened: today at the latest, on the company's calendar. */}
            <DatePickerSingle asField label={t('punch_date')} value={date} maxDate={today} error={errors.date} disabled={action.running}
                onChange={day => { setDate(day); clear('date') }} />
            <Field label={t('punch_time')} error={errors.time}>{f => (
                <TextInput {...f} name="time" type="time" autoComplete="off" value={time} disabled={action.running} onChange={e => { setTime(e.target.value); clear('time') }} />
            )}</Field>
            <Field label={t('punch_direction')}>{f => (
                <Select {...f} name="direction" value={direction} disabled={action.running} onChange={e => setDirection(e.target.value as '' | 'IN' | 'OUT')}
                    options={[{ value: '', label: t('punch_direction_unknown') }, { value: 'IN', label: t('punch_in') }, { value: 'OUT', label: t('punch_out') }]} />
            )}</Field>
            <Field label={t('punch_reason')} hint={t('ui_characters_used').replace('{used}', num(note.length)).replace('{max}', num(NOTE_MAX))} error={errors.note}>{f => (
                <TextArea {...f} name="reason" dir="auto" placeholder={t('punch_reason_example')} maxLength={NOTE_MAX} value={note} disabled={action.running}
                    onChange={e => { setNote(e.target.value); clear('note') }} />
            )}</Field>
            <DialogActions>
                <Button onClick={onCancel} disabled={action.running}>{t('cancel')}</Button>
                <Button type="submit" variant="primary" disabled={action.running} busy={action.is('add')}>{t('punch_add')}</Button>
            </DialogActions>
        </form>
    )
}
