'use client'

import { useId, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Button, Card } from '@/components/ui'
import { COMPANY_SETTINGS_TABS } from '@/lib/company-settings-tabs'
import type { TranslationKey } from '@/lib/translations'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'

/**
 * The Super Admin's switch for a company's own people seeing its settings
 * (ATTENDANCE_PLAN.md §5.2), and which tabs they see. A tab that may never be
 * shown has no checkbox. Who among the company's people sees them is their
 * role's settings.view and settings.edit; the built-in Admin role holds both.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 4a).
 */
export default function CompanySettingsAccessCard({ companyId, enabled, tabs, onSaved }: {
    companyId: string
    enabled: boolean
    tabs: readonly string[]
    onSaved: (next: { adminSettingsEnabled: boolean; adminSettingsTabs: string[] }) => void
}) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const hintId = useId()
    const tabsHintId = useId()
    const eligible = COMPANY_SETTINGS_TABS.filter(x => x.adminEligible)

    const [on, setOn] = useState(enabled)
    const [picked, setPicked] = useState<string[]>(eligible.map(x => x.key).filter(key => tabs.includes(key)))
    const [saving, setSaving] = useState(false)
    const dirty = on !== enabled || [...picked].sort().join() !== eligible.map(x => x.key).filter(key => tabs.includes(key)).sort().join()
    useReportUnsaved('access', dirty)

    const toggle = (key: string) => setPicked(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

    const save = async (e: FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const res = await fetch('/api/companies', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: companyId, adminSettingsEnabled: on, adminSettingsTabs: picked }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                showToast(body?.details?.adminSettingsTabs?._errors?.[0] || body?.error || t('error_generic'), 'error')
                return
            }
            onSaved({ adminSettingsEnabled: on, adminSettingsTabs: picked })
            showToast(t('settings_saved_success'), 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title={t('settings_tab_access')}>
            <form className="ui-card-form" noValidate onSubmit={save}>
                {/* Only the box and its label are the control: the line under it explains. */}
                <div className="ui-field">
                    <label className="ui-choice">
                        <input type="checkbox" className="ui-check" aria-describedby={hintId} name="adminSettingsEnabled"
                            checked={on} onChange={e => setOn(e.target.checked)} />
                        {t('admin_settings_label')}
                    </label>
                    <span id={hintId} className="ui-hint ui-choice-hint">{t('admin_settings_hint')}</span>
                </div>

                {/* Kept while the switch is off, greyed, so turning it back on
                    brings back the tabs that were ticked. */}
                <fieldset className="ui-field ui-fieldset" aria-describedby={tabsHintId} disabled={!on}>
                    <legend className="ui-label">{t('admin_settings_tabs_label')}</legend>
                    {eligible.map(x => (
                        <label key={x.key} className="ui-choice">
                            <input type="checkbox" className="ui-check" name={`tab-${x.key}`} checked={picked.includes(x.key)} onChange={() => toggle(x.key)} />
                            {t(x.labelKey as TranslationKey)}
                        </label>
                    ))}
                    <span id={tabsHintId} className="ui-hint">{t('admin_settings_never_shown')}</span>
                </fieldset>

                <div className="ui-card-actions">
                    <Button type="submit" variant="primary" busy={saving} disabled={!dirty}>{t('save')}</Button>
                </div>
            </form>
        </Card>
    )
}
