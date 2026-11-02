'use client'

import { useId, useState, type FormEvent } from 'react'
import { refusalOf } from '@/components/CompanyRolesCard'
import { Button, Card, Field, Select } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { countOf } from '@/lib/plural'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'

/**
 * The company's periodic access review switch (ROLES_PLAN.md §6.14): off by
 * default, with its interval. On the Super Admin's Roles tab — part of what
 * the contract includes, so not something the company sets.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 4b): a
 * card of its own under the roles.
 */
export type ReviewSetting = { accessReviewEnabled: boolean; accessReviewMonths: number; accessReviewNextAt: string | null }

const INTERVALS = [1, 2, 3, 4, 6, 12]

export default function AccessReviewSetting({ companyId, setting, onSaved }: { companyId: string; setting: ReviewSetting; onSaved: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const hintId = useId()
    const [enabled, setEnabled] = useState(setting.accessReviewEnabled)
    const [months, setMonths] = useState(setting.accessReviewMonths)
    const [saving, setSaving] = useState(false)
    // What the server holds: the setting given, then what was just saved. The
    // card remounts once the new setting arrives, but until then (or if that
    // read fails) a saved edit is not an unsaved one (review on #5).
    const [saved, setSaved] = useState({ enabled: setting.accessReviewEnabled, months: setting.accessReviewMonths })
    const dirty = enabled !== saved.enabled || months !== saved.months
    useReportUnsaved('access-review', dirty)

    const save = async (e: FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await fetch('/api/access-reviews/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, enabled, months }),
            })
            if (!res.ok) return showToast(await refusalOf(res, t('error_generic')), 'error')
            setSaved({ enabled, months })
            showToast(t('access_review_saved'), 'success')
            onSaved()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    // The day of the next review, as the page's language writes a date.
    const day = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

    return (
        <Card title={t('access_review_setting')}>
            <form className="ui-card-form" noValidate onSubmit={save}>
                {/* Only the box and its label are the control: the line under it explains. */}
                <div className="ui-field">
                    <label className="ui-choice">
                        <input type="checkbox" className="ui-check" aria-describedby={hintId} name="accessReviewEnabled"
                            checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                        {t('access_review_on')}
                    </label>
                    <span id={hintId} className="ui-hint ui-choice-hint">{t('access_review_setting_hint')}</span>
                </div>
                <Field label={t('access_review_every')}>{p => (
                    <Select {...p} name="months" value={String(months)} disabled={!enabled} onChange={e => setMonths(Number(e.target.value))}
                        // Counted as the language counts: "1 months" and a Western digit in Arabic before (audit on part 4b).
                        options={INTERVALS.map(m => ({ value: String(m), label: countOf(t, locale, m, 'months') }))} />
                )}</Field>
                {setting.accessReviewEnabled && setting.accessReviewNextAt && (
                    <p className="ui-card-note">{t('access_review_next').replace('{date}', day(setting.accessReviewNextAt))}</p>
                )}
                <div className="ui-card-actions">
                    <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                </div>
            </form>
        </Card>
    )
}
