'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'

/** The company's general settings: whether submitted task locations are checked automatically. */
export default function CompanyGeneralCard({ companyId, autoVerifyLocation, onSaved, readOnly = false }: {
    companyId: string
    autoVerifyLocation: boolean
    onSaved: (next: { autoVerifyLocation: boolean }) => void
    /** Shown, not changed: someone who holds settings.view without settings.edit. */
    readOnly?: boolean
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const [saving, setSaving] = useState(false)

    const handleToggleAutoVerify = async () => {
        const next = !autoVerifyLocation
        setSaving(true)
        try {
            const res = await fetch('/api/company-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ companyId, tab: 'general', autoVerifyLocation: next })
            })
            if (res.ok) {
                onSaved({ autoVerifyLocation: next })
                showToast(t('settings_saved_success') || 'Settings saved', 'success')
            } else {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
            {/* Not a <label> wrapping the whole row on purpose — a label
                wrapping the description text means clicking anywhere in
                the row toggles a live setting, which is too easy to hit
                by accident. Only the checkbox itself is interactive. */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                <input
                    type="checkbox"
                    checked={autoVerifyLocation}
                    disabled={saving || readOnly}
                    onChange={handleToggleAutoVerify}
                    style={{ width: '1.1rem', height: '1.1rem', marginTop: '0.15rem', cursor: saving ? 'not-allowed' : readOnly ? 'default' : 'pointer', flexShrink: 0 }}
                />
                <div>
                    <div style={{ fontWeight: 500 }}>{t('auto_verify_location_label') || 'Auto-verify submitted task locations'}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.15rem' }}>
                        {t('auto_verify_location_hint') || 'When on, a location submitted within the system’s distance setting is marked correct automatically. When off, every submitted location needs manual review.'}
                    </div>
                </div>
            </div>
        </div>
    )
}
