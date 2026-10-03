'use client'

import { useState } from 'react'
import useSWR from 'swr'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'

/**
 * Face verification for the whole system (ATTENDANCE_PLAN.md §10.4), on the
 * Super Admin's System Settings. Every Super Admin sees where it stands; only
 * the protected one switches it, after their own legal consultation, and the
 * server asks them for a fresh authenticator code.
 */
type State = 'OFF' | 'ON' | 'PAUSED'

export default function FaceSystemSwitch() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data, mutate } = useSWR<{ data: { state: State; canChange: boolean } }>('/api/system-settings/face', fetcher)
    const [asking, setAsking] = useState<'ON' | 'PAUSED' | null>(null)
    const [busy, setBusy] = useState(false)
    if (!data) return null
    const { state, canChange } = data.data

    const move = async (to: 'ON' | 'PAUSED') => {
        setBusy(true)
        try {
            const res = await fetch('/api/system-settings/face', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: to }) })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t(to === 'ON' ? 'face_sys_on_toast' : 'face_sys_paused_toast'), 'success')
            mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false); setAsking(null) }
    }

    const tone = state === 'ON' ? 'var(--ok-fg)' : state === 'PAUSED' ? 'var(--warn-fg)' : 'var(--text-soft)'
    return (
        <section className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ margin: 0 }}>{t('face_sys_title')}</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: 0 }}>{t('face_sys_hint')}</p>
            <p style={{ margin: 0, fontWeight: 600, color: tone }}>{t(`face_sys_state_${state}`)}</p>
            {canChange ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {state !== 'ON' && <button className="btn btn-primary" disabled={busy} onClick={() => setAsking('ON')}>{t(state === 'PAUSED' ? 'face_sys_resume' : 'face_sys_turn_on')}</button>}
                    {state === 'ON' && <button className="btn btn-secondary" disabled={busy} onClick={() => setAsking('PAUSED')}>{t('face_sys_pause')}</button>}
                </div>
            ) : (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: 0 }}>{t('face_sys_protected_only')}</p>
            )}
            <ConfirmModal
                isOpen={asking !== null}
                title={t(asking === 'ON' ? 'face_sys_confirm_on_title' : 'face_sys_confirm_pause_title')}
                message={t(asking === 'ON' ? 'face_sys_confirm_on' : 'face_sys_confirm_pause')}
                variant={asking === 'ON' ? 'warning' : 'info'}
                onConfirm={() => asking && move(asking)}
                onCancel={() => setAsking(null)}
            />
        </section>
    )
}
