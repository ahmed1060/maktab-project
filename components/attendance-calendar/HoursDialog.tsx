'use client'

import { useRef, useState, type FormEvent } from 'react'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog, DialogActions, Field, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { rebaseOnDate, startFromStale, type Based } from '@/lib/attendance/rebase'
import { companyWeekOn, versionOn } from '@/lib/attendance/calendar'
import { focusFirstWrong } from './focus'
import { firstOfNextMonth, formFromVersion, hoursFromForm, type HoursField, type HoursForm } from './hours-form'
import type { Editing } from './types'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]

type Errors = Partial<Record<HoursField | 'name' | 'from' | 'startDate' | 'endDate', string>>

/**
 * A schedule's hours (ATTENDANCE_PLAN.md §6.1, §7): a new schedule, a change
 * of a schedule's hours, or seasonal hours such as Ramadan's. Every change of
 * hours asks "from when?" and becomes a new version from that date, so the
 * days before it keep the hours they were worked under.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3a):
 * the building blocks' dialog and fields, each error under its field.
 */
export default function HoursDialog({ editing, today, companyWorkWeeks, weekdayName, busy, onClose, onSubmit }: {
    editing: Editing
    today: string
    companyWorkWeeks: { effectiveFrom: string; workWeek: number[] }[]
    weekdayName: (d: number) => string
    busy: boolean
    onClose: () => void
    onSubmit: (payload: Record<string, unknown>) => Promise<void>
}) {
    const { t } = useLanguage()
    const formRef = useRef<HTMLFormElement>(null)
    const isOverride = editing.kind === 'override'
    // A new version starts from the hours in force on its default date, next
    // month: an upcoming change already planned, not today's (review on #10).
    const base = editing.kind === 'version' ? versionOn(editing.schedule.versions, firstOfNextMonth(today)) ?? editing.schedule.versions.at(-1) ?? null
        : editing.kind === 'override' && editing.override ? { ...editing.override, workWeek: [] } : null

    const [name, setName] = useState(editing.kind === 'override' ? editing.override?.name ?? '' : '')
    const [form, setForm] = useState<HoursForm>(formFromVersion(base))
    // "From when?" (§6.1): the next payroll month unless they say otherwise.
    const [from, setFrom] = useState(editing.kind === 'schedule' ? today : firstOfNextMonth(today))
    // A change of hours follows the version in force on its date as the date
    // moves; edited, it says the date has another (review on #64).
    const [formBase, setFormBase] = useState<HoursForm>(formFromVersion(base))
    const [stale, setStale] = useState<HoursForm | null>(null)
    const rebased = (next: Based<HoursForm>) => { setFormBase(next.base); setForm(next.current); setStale(next.stale) }
    const changeFrom = (date: string) => {
        setFrom(date)
        clear('from')
        if (editing.kind !== 'version' || !date) return
        const based = { base: formBase, current: form, stale }
        const inForce = versionOn(editing.schedule.versions, date)
        rebased(rebaseOnDate(based, inForce ? formFromVersion(inForce) : null))
    }
    const [startDate, setStartDate] = useState(editing.kind === 'override' ? editing.override?.startDate ?? '' : '')
    const [endDate, setEndDate] = useState(editing.kind === 'override' ? editing.override?.endDate ?? '' : '')
    // The company's week on the date these hours start, which is what they inherit.
    const companyWorkWeek = companyWeekOn(companyWorkWeeks, (isOverride ? startDate : from) || from)
    const [errors, setErrors] = useState<Errors>({})
    const clear = (field: keyof Errors) => setErrors(x => ({ ...x, [field]: undefined }))
    const edit = (next: Partial<HoursForm>, field: HoursField) => { setForm(f => ({ ...f, ...next })); clear(field) }

    const title = editing.kind === 'schedule' ? t('attendance_new_schedule')
        : editing.kind === 'version' ? t('attendance_change_hours_title').replace('{name}', editing.schedule.name)
            : editing.override ? t('attendance_override_edit_title').replace('{name}', editing.override.name)
                : t('attendance_override_add_title').replace('{name}', editing.schedule.name)

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const found: Errors = {}
        if ((editing.kind === 'schedule' || isOverride) && !name.trim()) found.name = t('attendance_name_required')
        if (isOverride) {
            if (!startDate) found.startDate = t('attendance_dates_required')
            if (!endDate) found.endDate = t('attendance_dates_required')
        } else if (!from) found.from = t('attendance_date_required')
        const hours = hoursFromForm(form)
        if (!hours.ok) found[hours.field] = t(hours.error)
        setErrors(found)
        if (Object.values(found).some(Boolean) || !hours.ok) { focusFirstWrong(formRef.current); return }
        const h = { startMinutes: hours.startMinutes, endMinutes: hours.endMinutes, breakMinutes: hours.breakMinutes, workWeek: hours.workWeek, days: hours.days }
        if (editing.kind === 'schedule') await onSubmit({ name: name.trim(), version: { ...h, effectiveFrom: from } })
        else if (editing.kind === 'version') await onSubmit({ ...h, effectiveFrom: from })
        else await onSubmit({ name: name.trim(), startDate, endDate, startMinutes: h.startMinutes, endMinutes: h.endMinutes, breakMinutes: h.breakMinutes, days: h.days })
    }

    const toggleDay = (d: number) => edit({ workWeek: form.workWeek.includes(d) ? form.workWeek.filter(x => x !== d) : [...form.workWeek, d].sort() }, 'workWeek')

    return (
        // Not closed while it saves: closing then would hide the answer.
        <Dialog open onClose={() => { if (!busy) onClose() }} title={title}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                {(editing.kind === 'schedule' || isOverride) && (
                    <Field label={isOverride ? t('attendance_override_name') : t('attendance_schedule_name')} error={errors.name}>{p => (
                        <TextInput {...p} name="name" autoComplete="off" maxLength={80} value={name}
                            placeholder={isOverride ? t('attendance_override_placeholder') : t('attendance_schedule_placeholder')}
                            onChange={e => { setName(e.target.value); clear('name') }} />
                    )}</Field>
                )}

                {isOverride ? (
                    <>
                        <DatePickerSingle asField label={t('attendance_first_day')} value={startDate} error={errors.startDate}
                            onChange={day => { setStartDate(day); clear('startDate') }} />
                        <DatePickerSingle asField label={t('attendance_last_day')} value={endDate} minDate={startDate || undefined} error={errors.endDate}
                            onChange={day => { setEndDate(day); clear('endDate') }} />
                    </>
                ) : (
                    <div className="ui-field">
                        <DatePickerSingle asField label={t('attendance_from_when')} value={from} error={errors.from} hint={t('attendance_from_when_hint')} onChange={changeFrom} />
                        <div className="ui-form-actions">
                            <Button size="sm" variant="quiet" onClick={() => changeFrom(today)}>{t('attendance_from_today')}</Button>
                            <Button size="sm" variant="quiet" onClick={() => changeFrom(firstOfNextMonth(today))}>{t('attendance_from_next_month')}</Button>
                        </div>
                        {stale && (
                            <p className="ui-hint" role="status">
                                {t('attendance_base_changed')}{' '}
                                <Button size="sm" variant="quiet" onClick={() => rebased(startFromStale({ base: formBase, current: form, stale }))}>{t('attendance_base_use')}</Button>
                            </p>
                        )}
                    </div>
                )}

                <Field label={t('attendance_starts')} error={errors.start}>{p => (
                    <TextInput {...p} name="start" type="time" value={form.start} onChange={e => edit({ start: e.target.value }, 'start')} />
                )}</Field>
                <Field label={t('attendance_ends')} hint={t('attendance_night_shift_hint')} error={errors.end}>{p => (
                    <TextInput {...p} name="end" type="time" value={form.end} onChange={e => edit({ end: e.target.value }, 'end')} />
                )}</Field>
                <Field label={t('attendance_break_minutes')} error={errors.breakMinutes}>{p => (
                    <TextInput {...p} name="breakMinutes" type="number" inputMode="numeric" autoComplete="off" min={0} step={5} value={form.breakMinutes}
                        onChange={e => edit({ breakMinutes: e.target.value }, 'breakMinutes')} />
                )}</Field>

                {!isOverride && (
                    <fieldset className="ui-field ui-fieldset">
                        <legend className="ui-label">{t('attendance_work_week')}</legend>
                        <label className="ui-choice">
                            <input type="checkbox" className="ui-check" checked={!form.customWeek}
                                onChange={e => edit({ customWeek: !e.target.checked, workWeek: e.target.checked ? [] : [...companyWorkWeek] }, 'workWeek')} />
                            {t('attendance_use_company_week').replace('{days}', companyWorkWeek.map(weekdayName).join(' '))}
                        </label>
                        {form.customWeek && (
                            <div className="ui-weekdays">
                                {WEEKDAYS.map(d => (
                                    <label key={d} className="ui-choice">
                                        <input type="checkbox" className="ui-check" checked={form.workWeek.includes(d)} onChange={() => toggleDay(d)} />
                                        {weekdayName(d)}
                                    </label>
                                ))}
                            </div>
                        )}
                        {errors.workWeek && <span className="ui-error">{errors.workWeek}</span>}
                    </fieldset>
                )}

                <fieldset className="ui-field ui-fieldset">
                    <legend className="ui-label">{t('attendance_day_exceptions')}</legend>
                    <span className="ui-hint">{t('attendance_day_exceptions_hint')}</span>
                    {WEEKDAYS.map(d => {
                        const own = form.days.find(x => x.weekday === d)
                        return (
                            <div key={d} className="ui-day-hours">
                                <label className="ui-choice">
                                    <input type="checkbox" className="ui-check" checked={!!own}
                                        onChange={e => edit({
                                            days: e.target.checked ? [...form.days, { weekday: d, start: form.start, end: form.end }] : form.days.filter(x => x.weekday !== d),
                                        }, 'days')} />
                                    {weekdayName(d)}
                                </label>
                                {own && (
                                    <>
                                        <TextInput type="time" aria-label={t('attendance_day_starts').replace('{day}', weekdayName(d))} value={own.start}
                                            onChange={e => edit({ days: form.days.map(x => x.weekday === d ? { ...x, start: e.target.value } : x) }, 'days')} />
                                        <TextInput type="time" aria-label={t('attendance_day_ends').replace('{day}', weekdayName(d))} value={own.end}
                                            onChange={e => edit({ days: form.days.map(x => x.weekday === d ? { ...x, end: e.target.value } : x) }, 'days')} />
                                    </>
                                )}
                            </div>
                        )
                    })}
                    {errors.days && <span className="ui-error">{errors.days}</span>}
                </fieldset>

                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
