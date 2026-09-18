'use client'

import { useState } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { MAX_PAYROLL_DAY } from '@/lib/payday'

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
 */

type Props = {
    companyId: string
    payrollDay: number
    payslipsVisible: boolean
    timezone: string
    onSaved: (next: { payrollDay: number; payslipsVisible: boolean; timezone: string }) => void
}

// Offered rather than free-typed. Every one of these is east of the bound the
// global crons impose, so the list cannot produce a refusal — somebody with a
// zone not on it can still be set through the API, and will get the real
// explanation rather than "invalid".
const ZONES = [
    'Africa/Cairo', 'Africa/Casablanca', 'Africa/Lagos', 'Africa/Nairobi',
    'Asia/Dubai', 'Asia/Riyadh', 'Asia/Amman', 'Asia/Baghdad', 'Asia/Karachi',
    'Asia/Kolkata', 'Asia/Jakarta', 'Asia/Singapore', 'Asia/Tokyo',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Istanbul', 'UTC',
]

export default function CompanyPayrollCard({ companyId, payrollDay, payslipsVisible, timezone, onSaved }: Props) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const isRtl = locale === 'ar'

    const [day, setDay] = useState(payrollDay)
    const [visible, setVisible] = useState(payslipsVisible)
    const [zone, setZone] = useState(timezone)
    const [saving, setSaving] = useState(false)

    const dirty = day !== payrollDay || visible !== payslipsVisible || zone !== timezone

    const save = async () => {
        setSaving(true)
        try {
            const res = await fetch('/api/companies', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: companyId, payrollDay: day, payslipsVisible: visible, timezone: zone }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                // The zone's refusal explains that the scheduled jobs are global
                // and what that costs a company far behind UTC. Surfacing only
                // "Validation Error" would throw away the whole point of
                // validating it here.
                const zoneIssue = body?.details?.timezone?._errors?.[0]
                const dayIssue = body?.details?.payrollDay?._errors?.[0]
                showToast(zoneIssue || dayIssue || body?.error || t('error_generic'), 'error')
                return
            }
            onSaved({ payrollDay: day, payslipsVisible: visible, timezone: zone })
            showToast(t('settings_saved_success') || 'Settings saved', 'success')
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: isRtl ? 'right' : 'left' }}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem' }}>{t('payroll_policy')}</h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: 'var(--text-soft)' }}>
                {t('payroll_policy_hint')}
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                <div>
                    <label htmlFor="company-payroll-day" style={{ display: 'block', fontWeight: 500, marginBottom: '0.3rem' }}>
                        {t('payroll_day_label')}
                    </label>
                    <input
                        id="company-payroll-day"
                        className="input"
                        type="number"
                        min={1}
                        max={MAX_PAYROLL_DAY}
                        value={day}
                        onChange={e => setDay(Number(e.target.value))}
                        style={{ width: '6rem' }}
                    />
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.3rem' }}>
                        {t('payroll_day_hint').replace('{max}', String(MAX_PAYROLL_DAY))}
                    </div>
                </div>

                <div>
                    <label htmlFor="company-timezone" style={{ display: 'block', fontWeight: 500, marginBottom: '0.3rem' }}>
                        {t('company_timezone_label')}
                    </label>
                    <select
                        id="company-timezone"
                        className="input"
                        value={zone}
                        onChange={e => setZone(e.target.value)}
                        style={{ width: 'auto', maxWidth: '100%' }}
                    >
                        {/* A zone already stored but not on the list stays
                            selectable, so opening this page cannot silently
                            change a setting somebody made through the API. */}
                        {!ZONES.includes(zone) && <option value={zone}>{zone}</option>}
                        {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                    </select>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.3rem' }}>
                        {t('company_timezone_hint')}
                    </div>
                </div>

                {/* Only the checkbox is interactive, matching the auto-verify
                    row above it: a label wrapping the description means clicking
                    the explanation toggles who can read a payslip. */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexDirection: isRtl ? 'row-reverse' : 'row' }}>
                    <input
                        id="company-payslips-visible"
                        type="checkbox"
                        checked={visible}
                        onChange={e => setVisible(e.target.checked)}
                        style={{ width: '1.1rem', height: '1.1rem', marginTop: '0.15rem', flexShrink: 0, cursor: 'pointer' }}
                    />
                    <div>
                        <label htmlFor="company-payslips-visible" style={{ fontWeight: 500, cursor: 'pointer' }}>
                            {t('payslips_visible_label')}
                        </label>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.15rem' }}>
                            {t('payslips_visible_hint')}
                        </div>
                    </div>
                </div>

                <button
                    className="btn btn-primary"
                    onClick={save}
                    disabled={saving || !dirty}
                    style={{ alignSelf: isRtl ? 'flex-end' : 'flex-start' }}
                >
                    {saving ? '…' : t('save')}
                </button>
            </div>
        </div>
    )
}
