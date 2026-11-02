'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import { Button, Card, Field, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { MAX_PAYROLL_DAY } from '@/lib/payday'
import { FULL_RECOVERY_PERCENT } from '@/lib/debt-recovery'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
import type { TranslationKey } from '@/lib/translations'

/**
 * The three payroll settings a company actually has.
 *
 * They shipped in P8 as columns with defaults and nothing that could write
 * them, which is how every company ended up on day 25 in Africa/Cairo with
 * payslips switched off and no way out. A default is not a decision until
 * somebody can change it.
 *
 * Saved together rather than one control at a time. They are one policy — when
 * the month is paid, in whose calendar, and who may read the result — and a
 * half-applied policy is harder to reason about than either end of it.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 2):
 * a card of fields, each with its label above and its hint or error below,
 * and Save on the card's end side.
 */

type Props = {
    companyId: string
    payrollDay: number
    payslipsVisible: boolean
    timezone: string
    debtRecoveryPercent: number
    onSaved: (next: { payrollDay: number; payslipsVisible: boolean; timezone: string; debtRecoveryPercent: number }) => void
    /** Shown, not changed: someone who holds settings.view without settings.edit. */
    readOnly?: boolean
    /**
     * Whether this viewer sets the debt recovery cap. Only the Super Admin
     * does (lib/company-settings-tabs.ts); a company's own people see it.
     */
    debtRecoveryEditable?: boolean
}

// A shortlist, not a limit. Any zone the runtime recognises is accepted — the
// offset bound that used to narrow this went with G7, when salary
// initialisation started asking each company what month it is in that
// company's own calendar. Somebody whose zone is not here can still be set
// through the API.
const ZONES = [
    'Africa/Cairo', 'Africa/Casablanca', 'Africa/Lagos', 'Africa/Nairobi',
    'Asia/Dubai', 'Asia/Riyadh', 'Asia/Amman', 'Asia/Baghdad', 'Asia/Karachi',
    'Asia/Kolkata', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Tokyo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Istanbul', 'UTC',
    'America/Sao_Paulo', 'America/New_York', 'America/Chicago', 'America/Los_Angeles',
]

type PayrollField = 'payrollDay' | 'timezone' | 'debtRecoveryPercent'

const WHOLE = /^\d+$/

/**
 * What's wrong with a typed payday or debt cap, said under its field before
 * anything is sent: a whole day the month always has, and a whole percentage.
 */
export function payrollFieldErrors(day: string, cap: string): Partial<Record<'payrollDay' | 'debtRecoveryPercent', TranslationKey>> {
    const errors: Partial<Record<'payrollDay' | 'debtRecoveryPercent', TranslationKey>> = {}
    if (!WHOLE.test(day.trim()) || Number(day) < 1 || Number(day) > MAX_PAYROLL_DAY) errors.payrollDay = 'payroll_day_invalid'
    if (!WHOLE.test(cap.trim()) || Number(cap) > 100) errors.debtRecoveryPercent = 'debt_recovery_invalid'
    return errors
}

/**
 * Whether a typed number is the one saved: "05" is 5. Compared as text, a
 * payday typed with a leading zero stayed a change after it was saved
 * (found by Codex on PR 161).
 */
export function sameWhole(text: string, saved: number): boolean {
    return WHOLE.test(text.trim()) && Number(text) === saved
}

/**
 * What a number field shows once its save is answered: what was saved, as
 * a number, unless it was typed over while the save was on its way. Then
 * the newer text stays, and is still a change to save (found by Codex on
 * PR 161).
 */
export function shownAfterSave(current: string, sent: string, saved: number): string {
    return current === sent ? String(saved) : current
}

/**
 * The server's refusal, each field's reason under that field. The zone's
 * explains that the scheduled jobs are global and what that costs a company
 * far behind UTC: "Validation Error" alone would throw away the whole point
 * of checking it. Anything else is said in a message.
 */
export function refusalsByField(body: unknown): { fields: Partial<Record<PayrollField, string>>; message?: string } {
    const answer = body as { error?: string; details?: Partial<Record<string, { _errors?: string[] }>> } | null
    const fields: Partial<Record<PayrollField, string>> = {}
    for (const field of ['payrollDay', 'timezone', 'debtRecoveryPercent'] as const) {
        const reason = answer?.details?.[field]?._errors?.[0]
        if (reason) fields[field] = reason
    }
    if (Object.keys(fields).length > 0 || !answer?.error) return { fields }
    return { fields, message: answer.error }
}

export default function CompanyPayrollCard({ companyId, payrollDay, payslipsVisible, timezone, debtRecoveryPercent, onSaved, readOnly = false, debtRecoveryEditable = true }: Props) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const hintId = useId()
    const form = useRef<HTMLFormElement>(null)

    // The numbers as typed, so a field can be emptied on the way to another
    // number, and said to be wrong rather than quietly sent as 0.
    const [dayText, setDayText] = useState(String(payrollDay))
    const [visible, setVisible] = useState(payslipsVisible)
    const [zone, setZone] = useState(timezone)
    const [capText, setCapText] = useState(String(debtRecoveryPercent))
    const [errors, setErrors] = useState<Partial<Record<PayrollField, string>>>({})
    const [saving, setSaving] = useState(false)

    // A field's error goes once the field is changed, as the other forms'
    // do (found in the browser on company settings part 2).
    const clear = (field: PayrollField) => setErrors(x => ({ ...x, [field]: undefined }))

    const dirty = !sameWhole(dayText, payrollDay) || visible !== payslipsVisible || zone !== timezone || !sameWhole(capText, debtRecoveryPercent)
    useReportUnsaved('payroll', dirty)

    // Focus the first field said to be wrong, once it says so.
    const focusFirstError = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const wrong = payrollFieldErrors(dayText, debtRecoveryEditable ? capText : String(debtRecoveryPercent))
        if (Object.keys(wrong).length > 0) {
            setErrors(Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key).replace('{max}', String(MAX_PAYROLL_DAY))])))
            focusFirstError()
            return
        }
        setErrors({})
        const sentDay = dayText
        const sentCap = capText
        const day = Number(sentDay)
        const cap = Number(sentCap)
        setSaving(true)
        try {
            const res = await fetch('/api/company-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    companyId, tab: 'payroll', payrollDay: day, payslipsVisible: visible, timezone: zone,
                    ...(debtRecoveryEditable ? { debtRecoveryPercent: cap } : {}),
                }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                const refused = refusalsByField(body)
                setErrors(refused.fields)
                if (Object.keys(refused.fields).length > 0) focusFirstError()
                else showToast(refused.message || t('error_generic'), 'error')
                return
            }
            onSaved({ payrollDay: day, payslipsVisible: visible, timezone: zone, debtRecoveryPercent: debtRecoveryEditable ? cap : debtRecoveryPercent })
            // The fields show what was saved: 5, where "05" was typed.
            setDayText(text => shownAfterSave(text, sentDay, day))
            if (debtRecoveryEditable) setCapText(text => shownAfterSave(text, sentCap, cap))
            showToast(t('settings_saved_success'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const cap = Number(capText)
    const capHint = !WHOLE.test(capText.trim()) ? undefined
        : cap === FULL_RECOVERY_PERCENT ? t('debt_recovery_hint_full')
            : cap === 0 ? t('debt_recovery_hint_off')
                : t('debt_recovery_hint_capped').replace('{n}', String(cap))
    const zones = [
        // A zone already stored but not on the list stays selectable, so
        // opening this page cannot silently change a setting somebody made
        // through the API.
        ...(ZONES.includes(zone) ? [] : [zone]),
        ...ZONES,
    ].map(z => ({ value: z, label: z }))

    return (
        <Card title={t('payroll_policy')}>
            <p className="ui-card-note">{t('payroll_policy_hint')}</p>
            <form ref={form} className="ui-card-form" noValidate onSubmit={save}>
                <Field label={t('payroll_day_label')} hint={t('payroll_day_hint').replace('{max}', String(MAX_PAYROLL_DAY))} error={errors.payrollDay}>
                    {p => (
                        <TextInput {...p} autoComplete="off" name="payrollDay" type="number" inputMode="numeric" min={1} max={MAX_PAYROLL_DAY}
                            value={dayText} onChange={e => { setDayText(e.target.value); clear('payrollDay') }} disabled={readOnly} />
                    )}
                </Field>

                <Field label={t('company_timezone_label')} hint={t('company_timezone_hint')} error={errors.timezone}>
                    {/* Zone names are identifiers, not words: a page translator
                        leaves them as they are. They read the same in either
                        direction, so the select keeps the page's: set left to
                        right, it started its text under its arrow in Arabic. */}
                    {p => <Select {...p} name="timezone" translate="no" options={zones} value={zone} onChange={e => { setZone(e.target.value); clear('timezone') }} disabled={readOnly} />}
                </Field>

                {/* Only the box and its label are the control: the line under
                    it explains, and clicking an explanation shouldn't change
                    who can read a payslip. */}
                <div className="ui-field">
                    <label className="ui-choice">
                        <input type="checkbox" className="ui-check" aria-describedby={hintId} name="payslipsVisible"
                            checked={visible} onChange={e => setVisible(e.target.checked)} disabled={readOnly} />
                        {t('payslips_visible_label')}
                    </label>
                    <span id={hintId} className="ui-hint ui-choice-hint">{t('payslips_visible_hint')}</span>
                </div>

                <Field
                    label={t('debt_recovery_percent_label')}
                    hint={<>{capHint}{!debtRecoveryEditable && <>{capHint && ' '}{t('settings_set_by_super_admin')}</>}</>}
                    error={errors.debtRecoveryPercent}
                >
                    {p => (
                        <TextInput {...p} autoComplete="off" name="debtRecoveryPercent" type="number" inputMode="numeric" min={0} max={100}
                            value={capText} onChange={e => { setCapText(e.target.value); clear('debtRecoveryPercent') }} disabled={readOnly || !debtRecoveryEditable} />
                    )}
                </Field>

                {!readOnly && (
                    <div className="ui-card-actions">
                        <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                    </div>
                )}
            </form>
        </Card>
    )
}
