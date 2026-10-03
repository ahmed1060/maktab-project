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
 * server asks them for a fresh authenticator code. Off again is pause and
 * purge, typed to confirm, and its record says what was destroyed.
 */
type State = 'OFF' | 'ON' | 'PAUSED'

export default function FaceSystemSwitch() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data, mutate } = useSWR<{ data: { state: State; canChange: boolean } }>('/api/system-settings/face', fetcher)
    const { data: purgeBody, mutate: reloadPurge } = useSWR<{ data: { at: string; keysDestroyed: number; photosDeleted: number; acknowledged: number } | null }>('/api/system-settings/face/purge', fetcher)
    const [asking, setAsking] = useState<'ON' | 'PAUSED' | null>(null)
    const [purging, setPurging] = useState(false)
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

    const purge = async () => {
        setBusy(true)
        try {
            const res = await fetch('/api/system-settings/face/purge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'PURGE' }) })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t('face_purge_done'), 'success')
            mutate()
            reloadPurge()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false); setPurging(false) }
    }
    const last = purgeBody?.data ?? null

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
                    {state !== 'OFF' && <button className="btn btn-danger" disabled={busy} onClick={() => setPurging(true)}>{t('face_purge')}</button>}
                </div>
            ) : (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: 0 }}>{t('face_sys_protected_only')}</p>
            )}
            {last && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: 0 }}>
                    {t('face_purge_record').replace('{date}', last.at.slice(0, 10)).replaceAll('{keys}', String(last.keysDestroyed)).replace('{photos}', String(last.photosDeleted)).replace('{acks}', String(last.acknowledged))}
                </p>
            )}
            <ConfirmModal
                isOpen={purging}
                title={t('face_purge_title')}
                message={t('face_purge_text')}
                variant="danger"
                requireTypedText="PURGE"
                confirmText={t('face_purge')}
                onConfirm={purge}
                onCancel={() => setPurging(false)}
            />
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
