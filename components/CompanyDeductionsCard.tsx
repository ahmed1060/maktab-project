'use client'

import { useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, Choice, Field, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
import {
    deductionErrors, figure, DEDUCTION_NAME_MAX, MAX_MORE_DEDUCTIONS,
    type DeductionErrors, type DeductionsDraft, type PayrollDeductionBasis,
} from '@/lib/payroll-deductions'
import type { TranslationKey } from '@/lib/translations'

/**
 * Payroll deductions (LATER_CHANGES_PLAN.md §7.12, PR 440; DESIGN.md §5.5):
 * the Payroll tab's second card, under Payroll settings. Income tax and
 * social insurance, a percentage each, then the company's own, each a
 * percentage of the month's pay before them or a fixed amount.
 *
 * Saved together, as Payroll settings is, so a half-saved list can't be
 * what next month's payroll takes. What's typed wrong is said under its
 * field before anything is sent, by the same rules the server refuses by.
 */

type Saved = { incomeTax: number; socialInsurance: number; more: { id: string; name: string; basis: PayrollDeductionBasis; value: number }[] }
/** One of the company's own as the card holds it: `key` keeps React's place while it has no id yet. */
type Own = { key: string; id?: string; name: string; basis: PayrollDeductionBasis; value: string }

let next = 0
const newKey = () => `new-${++next}`

const draftOf = (saved: Saved) => ({
    incomeTax: String(saved.incomeTax),
    socialInsurance: String(saved.socialInsurance),
    more: saved.more.map((m): Own => ({ key: m.id, id: m.id, name: m.name, basis: m.basis, value: String(m.value) })),
})

/** A figure typed as the one saved: "10.0" is 10. */
const sameFigure = (text: string, saved: number) => figure(text) !== '' && Number(figure(text)) === saved

/** Whether what's on the card is what was saved. */
export function deductionsUnchanged(draft: { incomeTax: string; socialInsurance: string; more: Own[] }, saved: Saved): boolean {
    return sameFigure(draft.incomeTax, saved.incomeTax)
        && sameFigure(draft.socialInsurance, saved.socialInsurance)
        && draft.more.length === saved.more.length
        && draft.more.every((d, i) => d.id === saved.more[i].id && d.name.trim() === saved.more[i].name
            && d.basis === saved.more[i].basis && sameFigure(d.value, saved.more[i].value))
}

export default function CompanyDeductionsCard({ companyId, readOnly = false }: { companyId: string; readOnly?: boolean }) {
    const { t } = useLanguage()
    const { data, error, isValidating, mutate } = useSWR(`/api/company-deductions?companyId=${encodeURIComponent(companyId)}`, fetcher)
    const loaded: Saved | null = data?.data ?? null

    // Not read yet: the card says so where its fields will be, and, failing
    // that, why, with a way to read it again.
    if (!loaded) {
        return (
            <Card title={t('deductions_title')}>
                <p className="ui-card-note">{t('deductions_note')}</p>
                {error
                    ? <p className="ui-card-note" role="status">{t('deductions_load_failed')} <Button size="sm" busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button></p>
                    : <p className="ui-card-note ui-deductions-loading" role="status">{t('loading')}</p>}
            </Card>
        )
    }
    // Opened with what was read; read again later, it's not put back over what's being typed.
    return <DeductionsForm key={companyId} companyId={companyId} readOnly={readOnly} initial={loaded} onSaved={body => { void mutate(body, { revalidate: false }) }} />
}

function DeductionsForm({ companyId, readOnly, initial, onSaved }: { companyId: string; readOnly: boolean; initial: Saved; onSaved: (body: unknown) => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const form = useRef<HTMLFormElement>(null)
    const addRow = useRef<HTMLDivElement>(null)
    // A deduction just added has its name focused, as its field mounts.
    const focusNext = useRef<string | null>(null)

    const [saved, setSaved] = useState<Saved>(initial)
    const [incomeTax, setIncomeTax] = useState(() => draftOf(initial).incomeTax)
    const [socialInsurance, setSocialInsurance] = useState(() => draftOf(initial).socialInsurance)
    const [more, setMore] = useState<Own[]>(() => draftOf(initial).more)
    const [errors, setErrors] = useState<DeductionErrors>({})
    const [saving, setSaving] = useState(false)

    const draft = { incomeTax, socialInsurance, more }
    const dirty = !deductionsUnchanged(draft, saved)
    useReportUnsaved('deductions', dirty)

    const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const n = (value: number) => value.toLocaleString(digits)
    const said = (k: TranslationKey | undefined) => k && t(k).replace('{max}', n(DEDUCTION_NAME_MAX)).replace('{n}', n(MAX_MORE_DEDUCTIONS))
    const change = (k: string, patch: Partial<Own>) => {
        setMore(list => list.map(d => d.key === k ? { ...d, ...patch } : d))
        setErrors(x => ({ ...x, more: undefined }))
    }
    const focusFirstError = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

    const add = () => {
        if (more.length >= MAX_MORE_DEDUCTIONS) return
        const k = newKey()
        setMore(list => [...list, { key: k, name: '', basis: 'AMOUNT', value: '' }])
        focusNext.current = k
    }
    const remove = (k: string) => {
        setMore(list => list.filter(d => d.key !== k))
        setErrors(x => ({ ...x, more: undefined, moreCount: undefined }))
        // The focus goes somewhere that stays: Add a deduction.
        requestAnimationFrame(() => addRow.current?.querySelector('button')?.focus())
    }

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const sent: DeductionsDraft = { incomeTax, socialInsurance, more: more.map(({ id, name, basis, value }) => ({ id, name, basis, value })) }
        const wrong = deductionErrors(sent)
        if (Object.keys(wrong).length > 0) {
            setErrors(wrong)
            focusFirstError()
            return
        }
        setErrors({})
        setSaving(true)
        try {
            const res = await fetch('/api/company-deductions', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, ...sent }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                const refused = body?.details?.errors as DeductionErrors | undefined
                if (refused && Object.keys(refused).length > 0) {
                    setErrors(refused)
                    focusFirstError()
                } else showToast(body?.error || t('error_generic'), 'error')
                return
            }
            const now: Saved = body.data
            const d = draftOf(now)
            setSaved(now); setIncomeTax(d.incomeTax); setSocialInsurance(d.socialInsurance); setMore(d.more)
            onSaved(body)
            showToast(t('settings_saved_success'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    const atMost = more.length >= MAX_MORE_DEDUCTIONS
    return (
        <Card title={t('deductions_title')}>
            <p className="ui-card-note">{t('deductions_note')}</p>
            <form ref={form} className="ui-card-form" noValidate onSubmit={save}>
                <div className="ui-field-row ui-field-row-top">
                    <Field label={t('deduction_income_tax')} error={said(errors.incomeTax)}>
                        {p => (
                            <TextInput {...p} autoComplete="off" name="incomeTax" type="text" inputMode="decimal"
                                value={incomeTax} disabled={readOnly}
                                onChange={e => { setIncomeTax(e.target.value); setErrors(x => ({ ...x, incomeTax: undefined })) }} />
                        )}
                    </Field>
                    <Field label={t('deduction_social_insurance')} error={said(errors.socialInsurance)}>
                        {p => (
                            <TextInput {...p} autoComplete="off" name="socialInsurance" type="text" inputMode="decimal"
                                value={socialInsurance} disabled={readOnly}
                                onChange={e => { setSocialInsurance(e.target.value); setErrors(x => ({ ...x, socialInsurance: undefined })) }} />
                        )}
                    </Field>
                </div>

                <section className="ui-deductions" aria-labelledby={`${companyId}-more-deductions`}>
                    <h3 id={`${companyId}-more-deductions`} className="ui-subsection-title">{t('deductions_more_title')}</h3>
                    {more.length === 0 && <p className="ui-card-note">{t('deductions_none')}</p>}
                    {more.map((d, i) => {
                        const wrong = errors.more?.[i] ?? {}
                        return (
                            <div key={d.key} className="ui-deduction">
                                <Field label={t('deduction_name')} error={said(wrong.name)} className="ui-deduction-name">
                                    {p => (
                                        <TextInput {...p} ref={el => { if (el && focusNext.current === d.key) { focusNext.current = null; el.focus() } }} autoComplete="off" name={`deduction-name-${i}`}
                                            maxLength={DEDUCTION_NAME_MAX} value={d.name} disabled={readOnly}
                                            onChange={e => change(d.key, { name: e.target.value })} />
                                    )}
                                </Field>
                                <Choice
                                    legend={t('deduction_basis')}
                                    name={`deduction-basis-${d.key}`}
                                    value={d.basis}
                                    onChange={basis => change(d.key, { basis })}
                                    options={(['PERCENT', 'AMOUNT'] as const).map(b => ({ value: b, label: t(`deduction_basis_${b}`), disabled: readOnly }))}
                                />
                                <Field label={t(`deduction_value_${d.basis}`)} error={said(wrong.value)} className="ui-deduction-value">
                                    {p => (
                                        <TextInput {...p} autoComplete="off" name={`deduction-value-${i}`} type="text" inputMode="decimal"
                                            value={d.value} disabled={readOnly}
                                            onChange={e => change(d.key, { value: e.target.value })} />
                                    )}
                                </Field>
                                {!readOnly && (
                                    <Button variant="quiet" icon={TrashIcon} className="ui-deduction-remove" onClick={() => remove(d.key)}
                                        aria-label={d.name.trim() ? t('deduction_remove').replace('{name}', d.name.trim()) : t('deduction_remove_unnamed')}>
                                        {t('remove')}
                                    </Button>
                                )}
                            </div>
                        )
                    })}
                    {!readOnly && (
                        <div ref={addRow} className="ui-deductions-add">
                            {/* At the most, it stays where it is, greyed, with why beside it (DESIGN.md §5.2). */}
                            <Button variant="quiet" icon={PlusIcon} aria-disabled={atMost || undefined}
                                aria-describedby={atMost ? `${companyId}-deductions-most` : undefined}
                                onClick={add}>{t('deduction_add')}</Button>
                            {atMost && <span id={`${companyId}-deductions-most`} className="ui-hint">{said('deductions_at_most')}</span>}
                            {errors.moreCount && <span className="ui-error" role="alert">{said(errors.moreCount)}</span>}
                        </div>
                    )}
                </section>

                {!readOnly && (
                    <div className="ui-card-actions">
                        <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                    </div>
                )}
            </form>
        </Card>
    )
}
