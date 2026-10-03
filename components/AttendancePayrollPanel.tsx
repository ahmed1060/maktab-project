'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import ConfirmModal from '@/components/ConfirmModal'
import { apiErrorText } from '@/lib/api-error-text'

/**
 * Whether attendance reaches payroll, and from which month (ATTENDANCE_PLAN.md
 * §12, §20 Phase 1). Until a month is chosen, attendance is measured and
 * priced, and the payroll register shows what it would cost, but nobody's pay
 * changes — the dry run. The month can be set only after the last approved
 * payroll, so no month already paid changes sides.
 */
export default function AttendancePayrollPanel({ companyId, readOnly }: { companyId: string; readOnly: boolean }) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { data: body, mutate } = useSWR(`/api/attendance/payroll-from?companyId=${companyId}`, fetcher)
    const data: { from: string | null; earliest: string | null } | undefined = body?.data
    const [month, setMonth] = useState('')
    const [confirming, setConfirming] = useState<string | null | undefined>(undefined)
    const [busy, setBusy] = useState(false)

    if (!data) return null
    const monthText = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

    const save = async (from: string | null) => {
        setBusy(true)
        try {
            const res = await fetch('/api/attendance/payroll-from', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyId, from }) })
            if (!res.ok) return showToast(apiErrorText(await res.text(), t('error_generic')), 'error')
            showToast(t('attpay_saved'), 'success')
            setMonth('')
            mutate()
        } finally { setBusy(false); setConfirming(undefined) }
    }

    return (
        <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', display: 'grid', gap: '0.75rem' }} aria-labelledby="attendance-payroll">
            <h3 id="attendance-payroll" style={{ margin: 0, fontSize: '1rem' }}>{t('attpay_title')}</h3>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600, color: data.from ? 'var(--ok-fg)' : 'var(--text-strong)' }}>
                {data.from ? t('attpay_on').replace('{month}', monthText(data.from)) : t('attpay_off')}
            </p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-soft)' }}>{t('attpay_hint')}</p>
            {!readOnly && (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'grid', gap: '0.25rem' }}>
                        <span className="label">{t('attpay_from')}</span>
                        <input className="input" type="month" value={month} min={data.earliest ?? undefined} onChange={e => setMonth(e.target.value)} />
                    </label>
                    <button className="btn btn-primary" disabled={busy || !month || (!!data.earliest && month < data.earliest)} onClick={() => setConfirming(month)}>{t('attpay_set')}</button>
                    {data.from && <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(null)}>{t('attpay_stop')}</button>}
                </div>
            )}
            {!readOnly && data.earliest && <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-soft)' }}>{t('attpay_earliest').replace('{month}', monthText(data.earliest))}</p>}
            <ConfirmModal
                isOpen={confirming !== undefined}
                title={t('attpay_title')}
                message={confirming ? t('attpay_confirm_on').replace('{month}', monthText(confirming)) : t('attpay_confirm_off')}
                confirmText={confirming ? t('attpay_set') : t('attpay_stop')}
                variant={confirming ? 'danger' : undefined}
                onConfirm={() => save(confirming ?? null)}
                onCancel={() => setConfirming(undefined)}
            />
        </section>
    )
}
