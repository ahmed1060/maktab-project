'use client'

import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import DatePickerSingle from '@/components/DatePickerSingle'
import { Button, Dialog, DialogActions, Field, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { countOf } from '@/lib/plural'
import { PERMISSION_TYPES, type PolicyBody } from '@/lib/attendance/policy'
import { rebaseOnDate, startFromStale, type Based } from '@/lib/attendance/rebase'
import { firstOfNextMonth } from '@/components/attendance-calendar/hours-form'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { bodyFromForm, formFromBody, type FieldError, type FormErrors, type PolicyForm } from './policy-form'
import RuleFields from './RuleFields'
import FaceFields from './FaceFields'
import Simulation from './Simulation'

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const ABSENCE_MULTIPLIERS = [0, 1, 1.5, 2]
const RATES = { workday: 'attendance_rate_workday', restDay: 'attendance_rate_restDay', holiday: 'attendance_rate_holiday' } as const
const KINDS = { LATE_ARRIVAL: 'attendance_permission_type_LATE_ARRIVAL', EARLY_LEAVE: 'attendance_permission_type_EARLY_LEAVE', MIDDAY: 'attendance_permission_type_MIDDAY' } as const

/**
 * The attendance policy's rules, changed (ATTENDANCE_PLAN.md §6). For a
 * company it asks "from when?" (§6.1) and can preview the draft on last month
 * (§6.7); for a template (§6.8) it has neither, a template being a starting
 * point, and shows the template's own fields above the rules.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 3b):
 * the building blocks' dialog and fields, each number checked under its field
 * before anything is sent, and the focus on the first that's wrong.
 */
export default function PolicyDialog({ title, start, startOn, defaultFrom, today, companyId, weekdayName, header, checkHeader, onClose, onSave }: {
    title: string
    start: PolicyBody
    /** The policy in force on a date, which the draft follows when its date moves; none from a template. */
    startOn?: (date: string) => PolicyBody | null
    /** "From when?": left out for a template, which has no date. */
    defaultFrom?: string
    today?: string
    /** The company whose days a draft is replayed over; none for a template. */
    companyId?: string
    weekdayName: (d: number) => string
    /** A template's own fields. */
    header?: ReactNode
    /** Whether the template's own fields are right; they say what's wrong under them. */
    checkHeader?: () => boolean
    onClose: () => void
    onSave: (effectiveFrom: string, policy: PolicyBody) => Promise<void>
}) {
    const { t, locale } = useLanguage()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const formRef = useRef<HTMLFormElement>(null)
    const [form, setForm] = useState<PolicyForm>(() => formFromBody(start))
    const [from, setFrom] = useState(defaultFrom ?? '')
    const [errors, setErrors] = useState<FormErrors>({})
    const [saving, setSaving] = useState(false)

    // What the draft started from, and the policy in force on a date it was moved to after editing (review on #64).
    const [base, setBase] = useState<PolicyForm>(() => formFromBody(start))
    const [stale, setStale] = useState<PolicyForm | null>(null)
    const rebased = (next: Based<PolicyForm>) => { setBase(next.base); setForm(next.current); setStale(next.stale) }

    /** Clears the errors a change answers: a field's, and those of the fields within it. */
    const clear = (paths: string[]) => setErrors(e => {
        const left = Object.fromEntries(Object.entries(e).filter(([key]) => !paths.some(p => key === p || key.startsWith(`${p}.`))))
        return Object.keys(left).length === Object.keys(e).length ? e : left
    })
    const edit = (change: (f: PolicyForm) => PolicyForm, ...paths: string[]) => { setForm(f => change(f)); clear(paths) }

    const changeFrom = (date: string) => {
        setFrom(date)
        clear(['from'])
        const based = { base, current: form, stale }
        if (!startOn || !date) return
        const inForce = startOn(date)
        rebased(rebaseOnDate(based, inForce ? formFromBody(inForce) : null))
    }

    const number = (n: number) => n.toLocaleString(intl, { maximumFractionDigits: 2 })
    const message = (e?: FieldError) => e && t(e.key).replace('{min}', number(e.min ?? 0)).replace('{max}', number(e.max ?? 0))
    const errorOf = (path: string) => message(errors[path])
    const fraction = (f: number) => f === 1 ? t('attendance_day_1') : f === 0.5 ? t('attendance_day_half') : f === 0.25 ? t('attendance_day_quarter') : f === 0.75 ? t('attendance_day_three_quarters') : number(f)

    /**
     * The policy, or null having said under each field what's wrong and moved
     * the focus to the first. The preview needs no date; saving does.
     */
    const check = (needsDate: boolean): PolicyBody | null => {
        const found: FormErrors = {}
        if (needsDate && defaultFrom !== undefined && !from) found.from = { key: 'attendance_date_required' }
        const result = bodyFromForm(form, start)
        if (!result.ok) Object.assign(found, result.errors)
        const headerRight = checkHeader ? checkHeader() : true
        setErrors(found)
        if (!result.ok || !headerRight || Object.keys(found).length > 0) {
            focusFirstWrong(formRef.current)
            return null
        }
        return result.body
    }

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        const body = check(true)
        if (!body) return
        setSaving(true)
        try {
            await onSave(from, body)
        } finally {
            setSaving(false)
        }
    }

    const o = form.overtime
    const ph = form.permissionHours
    const absences = [...new Set([...ABSENCE_MULTIPLIERS, form.absence.multiplier])].sort((a, b) => a - b)

    return (
        // Not closed while it saves: closing then would hide the answer.
        <Dialog open onClose={() => { if (!saving) onClose() }} title={title}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={submit}>
                {header}

                {defaultFrom !== undefined && (
                    <div className="ui-field">
                        <DatePickerSingle asField label={t('attendance_from_when')} value={from} error={message(errors.from)} hint={t('attendance_policy_from_hint')} onChange={changeFrom} />
                        {today && (
                            <div className="ui-form-actions">
                                <Button size="sm" variant="quiet" onClick={() => changeFrom(today)}>{t('attendance_from_today')}</Button>
                                <Button size="sm" variant="quiet" onClick={() => changeFrom(firstOfNextMonth(today))}>{t('attendance_from_next_month')}</Button>
                            </div>
                        )}
                        {stale && (
                            <p className="ui-hint" role="status">
                                {t('attendance_base_changed')}{' '}
                                <Button size="sm" variant="quiet" onClick={() => rebased(startFromStale({ base, current: form, stale }))}>{t('attendance_base_use')}</Button>
                            </p>
                        )}
                    </div>
                )}

                <fieldset className="ui-field ui-fieldset">
                    <legend className="ui-label">{t('attendance_work_week')}</legend>
                    <div className="ui-weekdays">
                        {WEEKDAYS.map(d => (
                            <label key={d} className="ui-choice">
                                <input type="checkbox" className="ui-check" checked={form.workWeek.includes(d)}
                                    onChange={e => edit(f => ({ ...f, workWeek: e.target.checked ? [...f.workWeek, d].sort() : f.workWeek.filter(x => x !== d) }), 'workWeek')} />
                                {weekdayName(d)}
                            </label>
                        ))}
                    </div>
                    {errors.workWeek && <span className="ui-error">{message(errors.workWeek)}</span>}
                </fieldset>

                {(['lateness', 'earlyLeave'] as const).map(name => (
                    <RuleFields key={name} name={name} rule={form[name]} errorOf={errorOf} fraction={fraction} number={number}
                        onChange={(rule, paths) => edit(f => ({ ...f, [name]: rule }), ...paths)} />
                ))}

                <fieldset className="ui-fieldset">
                    <legend className="ui-subsection-title">{t('attendance_overtime')}</legend>
                    <div className="ui-field-group">
                        <label className="ui-choice">
                            <input type="checkbox" className="ui-check" checked={o.enabled} onChange={e => edit(f => ({ ...f, overtime: { ...f.overtime, enabled: e.target.checked } }), 'overtime')} />
                            {t('attendance_overtime_on')}
                        </label>
                        {o.enabled && (
                            <>
                                <div className="ui-field-row">
                                    <Field label={t('attendance_overtime_minimum')} error={errorOf('overtime.minimumMinutes')}>{p => (
                                        <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={0} max={240} value={o.minimumMinutes}
                                            onChange={e => edit(f => ({ ...f, overtime: { ...f.overtime, minimumMinutes: e.target.value } }), 'overtime.minimumMinutes')} />
                                    )}</Field>
                                    {(['workday', 'restDay', 'holiday'] as const).map(kind => (
                                        <Field key={kind} label={t(RATES[kind])} error={errorOf(`overtime.multipliers.${kind}`)}>{p => (
                                            <TextInput {...p} type="number" inputMode="decimal" autoComplete="off" min={1} max={5} step={0.05} value={o.multipliers[kind]}
                                                onChange={e => edit(f => ({ ...f, overtime: { ...f.overtime, multipliers: { ...f.overtime.multipliers, [kind]: e.target.value } } }), `overtime.multipliers.${kind}`)} />
                                        )}</Field>
                                    ))}
                                </div>
                                <label className="ui-choice">
                                    <input type="checkbox" className="ui-check" checked={o.requiresApproval}
                                        onChange={e => edit(f => ({ ...f, overtime: { ...f.overtime, requiresApproval: e.target.checked } }))} />
                                    {t('attendance_overtime_approval')}
                                </label>
                            </>
                        )}
                    </div>
                </fieldset>

                <Field label={t('attendance_absence_label')}>{p => (
                    <Select {...p} value={String(form.absence.multiplier)}
                        options={absences.map(m => ({ value: String(m), label: m === 0 ? t('attendance_absence_none') : countOf(t, locale, m, 'days') }))}
                        onChange={e => edit(f => ({ ...f, absence: { multiplier: Number(e.target.value) } }))} />
                )}</Field>

                <fieldset className="ui-fieldset">
                    <legend className="ui-subsection-title">{t('attendance_permission_hours')}</legend>
                    <div className="ui-field-group">
                        <label className="ui-choice">
                            <input type="checkbox" className="ui-check" checked={ph.enabled}
                                onChange={e => edit(f => ({ ...f, permissionHours: { ...f.permissionHours, enabled: e.target.checked } }), 'permissionHours')} />
                            {t('attendance_permission_on')}
                        </label>
                        {ph.enabled && (
                            <>
                                <div className="ui-field-row">
                                    <Field label={t('attendance_permission_allowance')} error={errorOf('permissionHours.allowanceHours')}>{p => (
                                        <TextInput {...p} type="number" inputMode="decimal" autoComplete="off" min={0} max={60} step={0.5} value={ph.allowanceHours}
                                            // The longest permission is checked against the month's hours.
                                            onChange={e => edit(f => ({ ...f, permissionHours: { ...f.permissionHours, allowanceHours: e.target.value } }), 'permissionHours.allowanceHours', 'permissionHours.maxPerRequestMinutes')} />
                                    )}</Field>
                                    <Field label={t('attendance_permission_min')} error={errorOf('permissionHours.minPerRequestMinutes')}>{p => (
                                        <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={1} max={24 * 60} value={ph.minPerRequestMinutes}
                                            onChange={e => edit(f => ({ ...f, permissionHours: { ...f.permissionHours, minPerRequestMinutes: e.target.value } }), 'permissionHours.minPerRequestMinutes', 'permissionHours.maxPerRequestMinutes')} />
                                    )}</Field>
                                    <Field label={t('attendance_permission_max')} error={errorOf('permissionHours.maxPerRequestMinutes')}>{p => (
                                        <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={1} max={24 * 60} value={ph.maxPerRequestMinutes}
                                            onChange={e => edit(f => ({ ...f, permissionHours: { ...f.permissionHours, maxPerRequestMinutes: e.target.value } }), 'permissionHours.maxPerRequestMinutes')} />
                                    )}</Field>
                                    <Field label={t('attendance_permission_max_requests')} hint={t('attendance_no_cap_hint')} error={errorOf('permissionHours.maxRequestsPerMonth')}>{p => (
                                        <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={1} max={31} value={ph.maxRequestsPerMonth}
                                            onChange={e => edit(f => ({ ...f, permissionHours: { ...f.permissionHours, maxRequestsPerMonth: e.target.value } }), 'permissionHours.maxRequestsPerMonth')} />
                                    )}</Field>
                                    <Field label={t('attendance_permission_after')} hint={t('attendance_permission_after_hint')} error={errorOf('permissionHours.afterTheFactHours')}>{p => (
                                        <TextInput {...p} type="number" inputMode="numeric" autoComplete="off" min={0} max={24 * 7} value={ph.afterTheFactHours}
                                            onChange={e => edit(f => ({ ...f, permissionHours: { ...f.permissionHours, afterTheFactHours: e.target.value } }), 'permissionHours.afterTheFactHours')} />
                                    )}</Field>
                                </div>
                                <Field label={t('attendance_permission_carry')}>{p => (
                                    <Select {...p} value={ph.carryOver}
                                        options={[{ value: 'LAPSE', label: t('attendance_carry_lapse') }, { value: 'CARRY_ONCE', label: t('attendance_carry_once') }]}
                                        onChange={e => edit(f => ({ ...f, permissionHours: { ...f.permissionHours, carryOver: e.target.value as PolicyForm['permissionHours']['carryOver'] } }))} />
                                )}</Field>
                                <fieldset className="ui-field ui-fieldset">
                                    <legend className="ui-label">{t('attendance_permission_types')}</legend>
                                    <div className="ui-weekdays">
                                        {PERMISSION_TYPES.map(type => (
                                            <label key={type} className="ui-choice">
                                                <input type="checkbox" className="ui-check" checked={ph.types.includes(type)}
                                                    onChange={e => edit(f => ({
                                                        ...f,
                                                        permissionHours: { ...f.permissionHours, types: e.target.checked ? [...f.permissionHours.types, type] : f.permissionHours.types.filter(x => x !== type) },
                                                    }), 'permissionHours.types')} />
                                                {t(KINDS[type])}
                                            </label>
                                        ))}
                                    </div>
                                    {errors['permissionHours.types'] && <span className="ui-error">{errorOf('permissionHours.types')}</span>}
                                </fieldset>
                            </>
                        )}
                    </div>
                </fieldset>

                {companyId && (
                    <FaceFields companyId={companyId} available={form.faceVerificationAvailable} months={form.faceReverifyMonths} error={errorOf('faceReverifyMonths')}
                        onChange={change => edit(f => ({ ...f, ...change }), 'faceReverifyMonths')} />
                )}

                {companyId && <Simulation companyId={companyId} formKey={JSON.stringify(form)} draft={() => check(false)} />}

                <DialogActions>
                    <Button onClick={onClose} disabled={saving}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={saving}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
