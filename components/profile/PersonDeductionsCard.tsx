'use client'

import { useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { Button, Card, Choice, Details, Field, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'
import {
    figure, personDeductionErrors,
    type PayrollDeductionBasis, type PersonDeductionDraft, type PersonDeductionErrors, type PersonDeductionMode,
    type PersonDeductionRow, type PersonDeductionsView,
} from '@/lib/payroll-deductions'
import type { TranslationKey } from '@/lib/translations'

/**
 * A person's payroll deductions (LATER_CHANGES_PLAN.md §7.12, step 9b, PR
 * 442; DESIGN.md §5.5, A person's payroll deductions), on their profile,
 * where their salary is (lib/profile-access.ts). Each of the company's
 * deductions as the company takes it, their own figure, or not applied.
 *
 * Seen, a card of details, there only while something's taken from them or
 * set for them. Changed, by whoever may change their salary, a choice of
 * three each, saved as a whole with its own Save, as Contacting clients is.
 */

/** One deduction as the card holds it: what's picked, and their own as typed. */
export type Entry = PersonDeductionDraft

export const entriesOf = (view: PersonDeductionsView): Entry[] =>
    view.deductions.map(d => ({ ref: d.ref, basis: d.basis, mode: d.mode, value: d.value === null ? '' : String(d.value) }))

/** A figure typed as the one saved: "12.50" is 12.5. */
const sameFigure = (text: string, saved: number | null) => saved !== null && figure(text) !== '' && Number(figure(text)) === saved

/** Whether what's on the card is what was saved. */
export function personUnchanged(entries: Entry[], saved: PersonDeductionsView): boolean {
    return entries.length === saved.deductions.length && entries.every((e, i) => {
        const d = saved.deductions[i]
        return e.ref === d.ref && e.mode === d.mode && (e.mode !== 'OWN' || sameFigure(e.value, d.value))
    })
}

/**
 * The card after the company's deductions changed while it was open: them
 * as they are now, each keeping what was picked where it's the same one
 * taken the same way, still to save.
 */
export function entriesAfterChange(entries: Entry[], now: PersonDeductionsView): Entry[] {
    const picked = new Map(entries.map(e => [e.ref, e]))
    return entriesOf(now).map(fresh => {
        const was = picked.get(fresh.ref)
        return was && was.basis === fresh.basis ? { ...was } : fresh
    })
}

/** What's there to say about them: something taken from them, or something set for them. */
export const anythingToSay = (view: PersonDeductionsView) => view.deductions.some(d => d.mode !== 'COMPANY' || d.company > 0)

function useFigures() {
    const { t, locale } = useLanguage()
    const ar = locale === 'ar'
    const percent = (v: number) => `${v.toLocaleString(ar ? 'ar-EG' : 'en-GB', { maximumFractionDigits: 2 })}${ar ? '٪' : '%'}`
    const money = (v: number) => v.toLocaleString(ar ? 'ar-EG' : 'en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const figureOf = (basis: PayrollDeductionBasis, v: number) => basis === 'PERCENT' ? percent(v) : money(v)
    const nameOf = (d: PersonDeductionRow) =>
        d.kind === 'INCOME_TAX' ? t('payslip_line_income_tax') : d.kind === 'SOCIAL_INSURANCE' ? t('payslip_line_social_insurance') : d.name ?? ''
    const said = (key: TranslationKey, v: string) => t(key).replace('{figure}', v)
    return { t, figureOf, nameOf, said }
}

export default function PersonDeductionsCard({ userId, own, change }: { userId: string; own: boolean; change: boolean }) {
    const { t } = useLanguage()
    const { data, error, isValidating, mutate } = useSWR(`/api/users/${encodeURIComponent(userId)}/payroll-deductions`, fetcher)
    const loaded: PersonDeductionsView | null = data?.data ?? null

    if (!loaded) {
        // Seen, nothing's shown until there's something to say; changed, the
        // card says it's loading where its choices will be.
        if (!error && !change) return null
        return (
            <Card title={t('deductions_title')}>
                {error
                    ? <p className="ui-card-note" role="status">{t('deductions_load_failed')} <Button size="sm" busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button></p>
                    : <p className="ui-card-note" role="status">{t('loading')}</p>}
            </Card>
        )
    }
    if (!change) return <DeductionsSeen view={loaded} own={own} />
    return <DeductionsForm key={userId} userId={userId} initial={loaded} onSaved={view => { void mutate({ success: true, data: view }, { revalidate: false }) }} />
}

function DeductionsSeen({ view, own }: { view: PersonDeductionsView; own: boolean }) {
    const { t, figureOf, nameOf, said } = useFigures()
    if (!anythingToSay(view)) return null
    const items = view.deductions.map(d => ({
        label: nameOf(d),
        value: d.mode === 'NONE' ? t('person_deduction_none')
            : d.mode === 'OWN' ? said(own ? 'person_deduction_own_self' : 'person_deduction_own', figureOf(d.basis, d.value ?? 0))
            : said('person_deduction_company', figureOf(d.basis, d.company)),
    }))
    return (
        <Card title={t('deductions_title')}>
            <Details items={items} />
        </Card>
    )
}

function DeductionsForm({ userId, initial, onSaved }: { userId: string; initial: PersonDeductionsView; onSaved: (view: PersonDeductionsView) => void }) {
    const { t, figureOf, nameOf, said } = useFigures()
    const { showToast } = useToast()
    const form = useRef<HTMLFormElement>(null)

    const [saved, setSaved] = useState(initial)
    const [entries, setEntries] = useState<Entry[]>(() => entriesOf(initial))
    const [errors, setErrors] = useState<PersonDeductionErrors>({})
    const [saving, setSaving] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)

    const dirty = !personUnchanged(entries, saved)
    useReportUnsaved('person-deductions', dirty)

    // Read again, a cached copy refreshed: taken up while nothing's typed
    // and nothing's being saved, during this render, as the company's card
    // does (Codex review on PR 440).
    const [seen, setSeen] = useState(initial)
    if (initial !== seen) {
        setSeen(initial)
        if (!dirty && !saving) { setSaved(initial); setEntries(entriesOf(initial)); setErrors({}) }
    }

    const change = (ref: string, patch: Partial<Entry>) => {
        setEntries(list => list.map(e => e.ref === ref ? { ...e, ...patch } : e))
        setErrors(x => Object.fromEntries(Object.entries(x).filter(([k]) => k !== ref)))
    }
    const focusFirstError = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const sent = entries.map(x => ({ ...x }))
        const wrong = personDeductionErrors(sent)
        if (Object.keys(wrong).length > 0) {
            setErrors(wrong)
            focusFirstError()
            return
        }
        setErrors({})
        setNotice(null)
        setSaving(true)
        try {
            const res = await fetch(`/api/users/${encodeURIComponent(userId)}/payroll-deductions`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deductions: sent }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                // The company's changed since this opened: them as they are
                // now, with what was picked kept where it's the same one.
                if (body?.code === 'DEDUCTIONS_CHANGED' && body.current) {
                    const now: PersonDeductionsView = body.current
                    setSaved(now)
                    setSeen(now)
                    setEntries(list => entriesAfterChange(list, now))
                    setNotice(t('person_deductions_changed'))
                    onSaved(now)
                    return
                }
                const refused = body?.details?.errors as PersonDeductionErrors | undefined
                if (refused && Object.keys(refused).length > 0) {
                    setErrors(refused)
                    focusFirstError()
                } else showToast(body?.error || t('error_generic'), 'error')
                return
            }
            // What's on the card stays as it is: anything picked or typed while
            // this was being saved is kept, and still to save.
            const now: PersonDeductionsView = body.data
            setSaved(now)
            setSeen(now)
            onSaved(now)
            showToast(t('person_deductions_saved'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title={t('deductions_title')}>
            <p className="ui-card-note">{t('person_deductions_note')}</p>
            {notice && <p className="ui-card-note" role="status">{notice}</p>}
            <form ref={form} className="ui-card-form" noValidate onSubmit={save}>
                {saved.deductions.map((d, i) => {
                    const entry = entries.find(e => e.ref === d.ref) ?? { ref: d.ref, basis: d.basis, mode: d.mode, value: '' }
                    const name = nameOf(d)
                    return (
                        <div key={d.ref} className="ui-person-deduction">
                            <Choice<PersonDeductionMode>
                                legend={name}
                                name={`person-deduction-${d.ref}`}
                                value={entry.mode}
                                onChange={mode => change(d.ref, { mode })}
                                options={[
                                    { value: 'COMPANY', label: said('person_deduction_company', figureOf(d.basis, d.company)) },
                                    { value: 'OWN', label: t(`person_deduction_choice_own_${d.basis}`) },
                                    { value: 'NONE', label: t('person_deduction_none') },
                                ]}
                            />
                            {entry.mode === 'OWN' && (
                                <Field label={t(`person_deduction_value_${d.basis}`)} error={errors[d.ref] && t(errors[d.ref])} className="ui-person-deduction-value">
                                    {p => (
                                        <TextInput {...p} autoComplete="off" name={`person-deduction-value-${i}`} type="text" inputMode="decimal"
                                            value={entry.value} onChange={e => change(d.ref, { value: e.target.value })} />
                                    )}
                                </Field>
                            )}
                        </div>
                    )
                })}
                <div className="ui-card-actions">
                    <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                </div>
            </form>
        </Card>
    )
}
