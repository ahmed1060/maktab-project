'use client'

import { useState } from 'react'
import { refusalOf } from '@/components/CompanyRolesCard'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'

/**
 * The company's periodic access review switch (ROLES_PLAN.md §6.14): off by
 * default, with its interval. On the Super Admin's Roles card — part of what
 * the contract includes, so not something the company sets.
 */
export type ReviewSetting = { accessReviewEnabled: boolean; accessReviewMonths: number; accessReviewNextAt: string | null }

export default function AccessReviewSetting({ companyId, setting, onSaved }: { companyId: string; setting: ReviewSetting; onSaved: () => void }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [enabled, setEnabled] = useState(setting.accessReviewEnabled)
    const [months, setMonths] = useState(setting.accessReviewMonths)
    const [saving, setSaving] = useState(false)
    // What the server holds: the setting given, then what was just saved. The
    // card remounts once the new setting arrives, but until then (or if that
    // read fails) a saved edit is not an unsaved one (review on #5).
    const [saved, setSaved] = useState({ enabled: setting.accessReviewEnabled, months: setting.accessReviewMonths })
    const dirty = enabled !== saved.enabled || months !== saved.months
    useReportUnsaved('access-review', dirty)

    const save = async () => {
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
        } finally {
            setSaving(false)
        }
    }

    return (
        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--veil-40)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer', fontWeight: 500 }}>
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} style={{ width: '1.05rem', height: '1.05rem' }} />
                {t('access_review_setting')}
            </label>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0.35rem 0 0.75rem' }}>{t('access_review_setting_hint')}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span>{t('access_review_every')}</span>
                <select aria-label={`${t('access_review_setting')}: ${t('access_review_every')}`} className="input" value={months} disabled={!enabled} onChange={e => setMonths(Number(e.target.value))} style={{ maxWidth: '10rem' }}>
                    {[1, 2, 3, 4, 6, 12].map(m => <option key={m} value={m}>{t('access_review_months').replace('{count}', String(m))}</option>)}
                </select>
                <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || saving}>{t('roles_save')}</button>
            </div>
            {setting.accessReviewEnabled && setting.accessReviewNextAt && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0.5rem 0 0' }}>
                    {t('access_review_next').replace('{date}', new Date(setting.accessReviewNextAt).toLocaleDateString(locale))}
                </p>
            )}
        </div>
    )
}
