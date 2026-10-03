'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { COMPANY_SETTINGS_TABS } from '@/lib/company-settings-tabs'
import { useReportUnsaved } from '@/lib/useUnsavedChanges'

/**
 * The Super Admin's switch for a company's own people seeing its settings
 * (ATTENDANCE_PLAN.md §5.2), and which tabs they see. A tab that may never be
 * shown has no checkbox. Who among the company's people sees them is their
 * role's settings.view and settings.edit; the built-in Admin role holds both.
 */
export default function CompanySettingsAccessCard({ companyId, enabled, tabs, onSaved }: {
    companyId: string
    enabled: boolean
    tabs: readonly string[]
    onSaved: (next: { adminSettingsEnabled: boolean; adminSettingsTabs: string[] }) => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'
    const eligible = COMPANY_SETTINGS_TABS.filter(x => x.adminEligible)

    const [on, setOn] = useState(enabled)
    const [picked, setPicked] = useState<string[]>(eligible.map(x => x.key).filter(key => tabs.includes(key)))
    const [saving, setSaving] = useState(false)
    const dirty = on !== enabled || [...picked].sort().join() !== eligible.map(x => x.key).filter(key => tabs.includes(key)).sort().join()
    useReportUnsaved('access', dirty)

    const toggle = (key: string) => setPicked(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

    const save = async () => {
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

    const row = { display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexDirection: (isRtl ? 'row-reverse' : 'row') as 'row' | 'row-reverse' }
    const box = { width: '1.1rem', height: '1.1rem', marginTop: '0.15rem', flexShrink: 0, cursor: 'pointer' }

    return (
        <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: isRtl ? 'right' : 'left' }}>
            <div style={row}>
                <input id="company-admin-settings" type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} style={box} />
                <div>
                    <label htmlFor="company-admin-settings" style={{ fontWeight: 500, cursor: 'pointer' }}>{t('admin_settings_label')}</label>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.15rem' }}>{t('admin_settings_hint')}</div>
                </div>
            </div>

            <div style={{ marginTop: '1.1rem', opacity: on ? 1 : 0.55 }}>
                <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>{t('admin_settings_tabs_label')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {eligible.map(x => (
                        <div key={x.key} style={row}>
                            <input id={`company-admin-settings-${x.key}`} type="checkbox" checked={picked.includes(x.key)} disabled={!on} onChange={() => toggle(x.key)} style={{ ...box, cursor: on ? 'pointer' : 'not-allowed' }} />
                            <label htmlFor={`company-admin-settings-${x.key}`} style={{ cursor: on ? 'pointer' : 'default' }}>{t(x.labelKey as any)}</label>
                        </div>
                    ))}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.6rem' }}>{t('admin_settings_never_shown')}</div>
            </div>

            <button className="btn btn-primary" onClick={save} disabled={saving || !dirty} style={{ marginTop: '1.25rem' }}>
                {saving ? '…' : t('save')}
            </button>
        </div>
    )
}
