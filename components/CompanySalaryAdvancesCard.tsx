'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { Button, Card, Choice, Field, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
import {
    draftOfPolicy, policyUnchanged, salaryAdvancePolicyErrors, SALARY_ADVANCE_OVER_LIMIT,
    type SalaryAdvancePolicy, type SalaryAdvancePolicyDraft, type SalaryAdvancePolicyErrors,
} from '@/lib/salary-advance-policy'

/**
 * Salary advances (LATER_CHANGES_PLAN.md §7.5, step 2; DESIGN.md §5.5): the
 * Payroll tab's third card, under Payroll deductions. The rules a salary
 * advance follows, before anyone can ask for one: how much, after how long,
 * one at a time or not, the most an installment and all debts together may
 * take of a month's net pay, and what happens over a limit.
 *
 * Saved together, as Payroll deductions is. What's typed wrong is said under
 * its field before anything is sent, by the same rules the server refuses by.
 */

/**
 * Whether a copy read again replaces what's on the card, as Payroll
 * deductions decides it (Codex review on PR 440): only while nothing's typed
 * and nothing's being saved, so a card opened from a cached copy shows what
 * another person has saved since, and typing is never lost to it.
 */
export function takesRefreshed(refreshed: SalaryAdvancePolicy, saved: SalaryAdvancePolicy, unchanged: boolean, saving: boolean): boolean {
    return refreshed !== saved && unchanged && !saving
}

export default function CompanySalaryAdvancesCard({ companyId, readOnly = false }: { companyId: string; readOnly?: boolean }) {
    const { t } = useLanguage()
    const { data, error, isValidating, mutate } = useSWR(`/api/company-salary-advances?companyId=${encodeURIComponent(companyId)}`, fetcher)
    const loaded: SalaryAdvancePolicy | null = data?.data ?? null

    // Not read yet: the card says so where its fields will be, and, failing
    // that, why, with a way to read it again.
    if (!loaded) {
        return (
            <Card title={t('salary_advances_title')}>
                <p className="ui-card-note">{t('salary_advances_note')}</p>
                {error
                    ? <p className="ui-card-note" role="status">{t('salary_advances_load_failed')} <Button size="sm" busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button></p>
                    : <p className="ui-card-note" role="status">{t('loading')}</p>}
            </Card>
        )
    }
    // Opened with what was read; read again later, it's not put back over what's being typed.
    return <PolicyForm key={companyId} companyId={companyId} readOnly={readOnly} initial={loaded} onSaved={body => { void mutate(body, { revalidate: false }) }} />
}

type Figure = 'maxMonths' | 'minServiceMonths' | 'installmentPercent' | 'debtsPercent'

function PolicyForm({ companyId, readOnly, initial, onSaved }: { companyId: string; readOnly: boolean; initial: SalaryAdvancePolicy; onSaved: (body: unknown) => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const form = useRef<HTMLFormElement>(null)
    const oneOpenHint = useId()

    const [saved, setSaved] = useState<SalaryAdvancePolicy>(initial)
    const [draft, setDraft] = useState<SalaryAdvancePolicyDraft>(() => draftOfPolicy(initial))
    const [errors, setErrors] = useState<SalaryAdvancePolicyErrors>({})
    const [saving, setSaving] = useState(false)

    const dirty = !policyUnchanged(draft, saved)
    useReportUnsaved('salary-advances', dirty)

    // Read again, a cached copy refreshed or another tab's save: taken up
    // while nothing's typed, during this render, as React advises for state
    // that follows a prop.
    const [seen, setSeen] = useState(initial)
    if (initial !== seen) {
        setSeen(initial)
        if (takesRefreshed(initial, saved, !dirty, saving)) {
            setSaved(initial)
            setDraft(draftOfPolicy(initial))
            setErrors({})
        }
    }

    const said = (field: Figure) => errors[field] && t(errors[field]!)
    const type = (field: Figure, text: string) => {
        setDraft(d => ({ ...d, [field]: text }))
        // All debts together is checked against the installment, so either
        // changed clears what was said of it.
        setErrors(x => ({ ...x, [field]: undefined, ...(field === 'installmentPercent' ? { debtsPercent: undefined } : {}) }))
    }
    const focusFirstError = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const sent = draft
        const wrong = salaryAdvancePolicyErrors(sent)
        if (Object.keys(wrong).length > 0) {
            setErrors(wrong)
            focusFirstError()
            return
        }
        setErrors({})
        setSaving(true)
        try {
            const res = await fetch('/api/company-salary-advances', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, ...sent }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                const refused = body?.details?.errors as SalaryAdvancePolicyErrors | undefined
                if (refused && Object.keys(refused).length > 0) {
                    setErrors(refused)
                    focusFirstError()
                } else showToast(body?.error || t('error_generic'), 'error')
                return
            }
            // What's on the card stays as it is: anything typed while this was
            // being saved is kept, and still to save.
            const now: SalaryAdvancePolicy = body.data
            setSaved(now)
            setSeen(now)
            onSaved(body)
            showToast(t('settings_saved_success'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const figure = (field: Figure, label: string, hint: string, inputMode: 'decimal' | 'numeric') => (
        <Field label={label} hint={hint} error={said(field)}>
            {p => (
                <TextInput {...p} autoComplete="off" name={field} type="text" inputMode={inputMode}
                    value={draft[field]} disabled={readOnly} onChange={e => type(field, e.target.value)} />
            )}
        </Field>
    )

    return (
        <Card title={t('salary_advances_title')}>
            <p className="ui-card-note">{t('salary_advances_note')}</p>
            <form ref={form} className="ui-card-form" noValidate onSubmit={save}>
                <div className="ui-field-row ui-field-row-top">
                    {figure('maxMonths', t('salary_advance_max_months'), t('salary_advance_max_months_hint'), 'decimal')}
                    {figure('minServiceMonths', t('salary_advance_min_service'), t('salary_advance_min_service_hint'), 'numeric')}
                </div>

                {/* Only the box and its label are the control: the line under
                    it explains. */}
                <div className="ui-field">
                    <label className="ui-choice">
                        <input type="checkbox" className="ui-check" aria-describedby={oneOpenHint} name="oneOpen"
                            checked={draft.oneOpen} disabled={readOnly}
                            onChange={e => { const oneOpen = e.target.checked; setDraft(d => ({ ...d, oneOpen })) }} />
                        {t('salary_advance_one_open')}
                    </label>
                    <span id={oneOpenHint} className="ui-hint ui-choice-hint">{t('salary_advance_one_open_hint')}</span>
                </div>

                <div className="ui-field-row ui-field-row-top">
                    {figure('installmentPercent', t('salary_advance_installment'), t('salary_advance_installment_hint'), 'decimal')}
                    {figure('debtsPercent', t('salary_advance_debts'), t('salary_advance_debts_hint'), 'decimal')}
                </div>

                {/* With a line under it for what the one picked does (DESIGN.md §5.5, Salary advances). */}
                <Choice
                    legend={t('salary_advance_over_limit')}
                    name="overLimit"
                    value={draft.overLimit}
                    onChange={overLimit => setDraft(d => ({ ...d, overLimit }))}
                    options={SALARY_ADVANCE_OVER_LIMIT.map(o => ({ value: o, label: t(`salary_advance_over_limit_${o}`), disabled: readOnly }))}
                    hint={t(`salary_advance_over_limit_${draft.overLimit}_hint`)}
                />

                {!readOnly && (
                    <div className="ui-card-actions">
                        <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                    </div>
                )}
            </form>
        </Card>
    )
}
