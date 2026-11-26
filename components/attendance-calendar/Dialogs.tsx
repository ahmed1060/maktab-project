'use client'

import { useRef, useState, type FormEvent } from 'react'
import DatePickerSingle from '@/components/DatePickerSingle'
import AssigneeChecklist from '@/components/forms/AssigneeChecklist'
import { Button, Dialog, DialogActions, Field, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { addDays } from '@/lib/attendance/calendar'
import { namedInOrder } from '@/lib/names'
import { focusFirstWrong } from './focus'
import { firstOfNextMonth } from './hours-form'
import type { Calendar, Schedule } from './types'

/**
 * The calendar's smaller dialogs (company settings part 3a): making a
 * schedule the default, moving people to a schedule, adding a holiday of
 * the company's own, and turning public holidays off or back on. None closes
 * while it saves: closing then would hide the answer. Each says what's wrong
 * under its field.
 */

/** Everyone not moved elsewhere works this schedule from the date chosen. */
export function DefaultDialog({ schedule, today, busy, onClose, onSubmit }: {
    schedule: Schedule
    today: string
    busy: boolean
    onClose: () => void
    onSubmit: (effectiveFrom: string) => Promise<void>
}) {
    const { t } = useLanguage()
    const form = useRef<HTMLFormElement>(null)
    const [from, setFrom] = useState(firstOfNextMonth(today))
    const [error, setError] = useState('')
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (!from) { setError(t('attendance_date_required')); focusFirstWrong(form.current); return }
        await onSubmit(from)
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('attendance_make_default_title').replace('{name}', schedule.name)}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <p>{t('attendance_default_hint')}</p>
                <DatePickerSingle label={t('attendance_from_when')} value={from} error={error} onChange={day => { setFrom(day); setError('') }} />
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * Moving people to a schedule from a date (ATTENDANCE_PLAN.md §7.3): who,
 * picked from the company's people as a task's assignees are (DESIGN.md
 * §5.3), to which schedule, and from when.
 */
export function MoveDialog({ data, active, busy, onClose, onSubmit }: {
    data: Calendar
    active: Schedule[]
    busy: boolean
    onClose: () => void
    onSubmit: (move: { userIds: string[]; scheduleId: string; effectiveFrom: string }) => Promise<void>
}) {
    const { t, locale } = useLanguage()
    const form = useRef<HTMLFormElement>(null)
    const [userIds, setUserIds] = useState<string[]>([])
    const [scheduleId, setScheduleId] = useState(active[0]?.id ?? '')
    const [from, setFrom] = useState(firstOfNextMonth(data.today))
    const [errors, setErrors] = useState<{ people?: string; from?: string }>({})
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const found = {
            people: userIds.length === 0 ? t('attendance_move_none') : undefined,
            from: !from ? t('attendance_date_required') : undefined,
        }
        setErrors(found)
        if (found.people || found.from) { focusFirstWrong(form.current); return }
        await onSubmit({ userIds, scheduleId, effectiveFrom: from })
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('attendance_move_title')}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <AssigneeChecklist
                    legend={t('attendance_people_label')}
                    // In the page's language and order: on an Arabic page, Arabic names first, in Arabic order (PR 422).
                    people={namedInOrder(data.people, locale).map(p => ({ id: p.id, firstName: p.name, lastName: '', firstNameAr: p.nameAr ?? null, lastNameAr: null, role: p.role }))}
                    value={userIds}
                    onChange={ids => { setUserIds(ids); setErrors(x => ({ ...x, people: undefined })) }}
                    // The people come with the calendar, which has loaded.
                    onRetry={() => {}}
                    disabled={busy}
                    error={errors.people}
                />
                <Field label={t('attendance_move_to')}>{p => (
                    <Select {...p} name="scheduleId" value={scheduleId} disabled={busy} onChange={e => setScheduleId(e.target.value)}
                        options={active.map(s => ({ value: s.id, label: s.name }))} />
                )}</Field>
                <DatePickerSingle label={t('attendance_from')} value={from} error={errors.from} disabled={busy}
                    onChange={day => { setFrom(day); setErrors(x => ({ ...x, from: undefined })) }} />
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('attendance_move_people')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/** A holiday of the company's own: its day, its name, and whether it's paid. */
export function HolidayDialog({ busy, onClose, onSubmit }: {
    busy: boolean
    onClose: () => void
    onSubmit: (holiday: { date: string; name: string; isPaid: boolean }) => Promise<void>
}) {
    const { t } = useLanguage()
    const form = useRef<HTMLFormElement>(null)
    const [date, setDate] = useState('')
    const [name, setName] = useState('')
    const [isPaid, setIsPaid] = useState(true)
    const [errors, setErrors] = useState<{ date?: string; name?: string }>({})
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const found = {
            date: !date ? t('attendance_date_required') : undefined,
            name: !name.trim() ? t('attendance_name_required') : undefined,
        }
        setErrors(found)
        if (found.date || found.name) { focusFirstWrong(form.current); return }
        await onSubmit({ date, name: name.trim(), isPaid })
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('attendance_add_holiday')}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <DatePickerSingle label={t('date')} value={date} error={errors.date} disabled={busy}
                    onChange={day => { setDate(day); setErrors(x => ({ ...x, date: undefined })) }} />
                <Field label={t('name')} error={errors.name}>{p => (
                    <TextInput {...p} name="name" autoComplete="off" maxLength={120} value={name} disabled={busy}
                        onChange={e => { setName(e.target.value); setErrors(x => ({ ...x, name: undefined })) }} />
                )}</Field>
                <label className="ui-choice">
                    <input type="checkbox" className="ui-check" name="isPaid" checked={isPaid} disabled={busy} onChange={e => setIsPaid(e.target.checked)} />
                    {t('attendance_paid')}
                </label>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('attendance_add_holiday')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * Public holidays off for the company, or back on, from a date
 * (FIRST_CHANGES_PLAN.md §6, DESIGN.md §5.5, PR 362): what changes, From
 * when? with today to start with, that attendance is worked out again from
 * then, and the earliest it may be, with why.
 */
export function PublicHolidaysDialog({ apply, today, earliest, lastChange, dateText, busy, onClose, onSubmit }: {
    apply: boolean
    today: string
    earliest: string | null
    /** The date of the company's last change, which the next one follows. */
    lastChange: string | null
    dateText: (date: string) => string
    busy: boolean
    onClose: () => void
    onSubmit: (effectiveFrom: string) => Promise<void>
}) {
    const { t } = useLanguage()
    const form = useRef<HTMLFormElement>(null)
    const [from, setFrom] = useState(earliest && earliest > today ? earliest : today)
    const [error, setError] = useState('')
    // Why the earliest is what it is: the day after the last change, or after an approved payroll month.
    const earliestLine = !earliest ? null : lastChange && earliest === addDays(lastChange, 1)
        ? t('attendance_public_earliest_change').replace('{last}', dateText(lastChange)).replace('{date}', dateText(earliest))
        : t('attendance_public_earliest_payroll').replace('{date}', dateText(earliest))
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const problem = !from ? t('attendance_date_required')
            : earliest && from < earliest ? t('attendance_public_too_early').replace('{date}', dateText(earliest)) : ''
        setError(problem)
        if (problem) { focusFirstWrong(form.current); return }
        await onSubmit(from)
    }
    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t(apply ? 'attendance_public_on_title' : 'attendance_public_off_title')}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <p>{t(apply ? 'attendance_public_on_body' : 'attendance_public_off_body')}</p>
                <DatePickerSingle label={t('attendance_from_when')} value={from} error={error} minDate={earliest ?? undefined} disabled={busy}
                    hint={earliestLine ? `${t('attendance_public_from_hint')} ${earliestLine}` : t('attendance_public_from_hint')}
                    onChange={day => { setFrom(day); setError('') }} />
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t(apply ? 'attendance_public_turn_on' : 'attendance_public_turn_off')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
