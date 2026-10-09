'use client'

import { useState } from 'react'
import useSWR from 'swr'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'
import { apiErrorText } from '@/lib/api-error-text'
import { leftAfterPress, photosLeft } from '@/lib/face-rekey-progress'

/**
 * Face verification for the whole system (ATTENDANCE_PLAN.md §10.4), on the
 * Super Admin's System Settings. Every Super Admin sees where it stands; only
 * the protected one switches it, after their own legal consultation, and the
 * server asks them for a fresh authenticator code. Off again is pause and
 * purge, typed to confirm, and its record says what was destroyed.
 *
 * While FACE_PHOTO_KEY is being rotated (mobile/README.md), any Super Admin
 * sees how many stored photos are still on the old key and moves them.
 */
type State = 'OFF' | 'ON' | 'PAUSED'

const CARD = { padding: '1.5rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' } as const
const HINT = { fontSize: '0.8rem', color: 'var(--text-soft)', margin: 0 } as const
// One button's height (40px), whether the row holds buttons, the protected-only line or nothing yet.
const CONTROLS = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', minHeight: '2.5rem' } as const
const STATES: readonly State[] = ['OFF', 'ON', 'PAUSED']

/**
 * The state line, as tall as its longest state's text, whichever shows: on a
 * phone "On: …" takes two lines and the loading line one, and that moved
 * the cards below when the state arrived (Codex review on #43).
 */
function StateLine({ text, color }: { text: string; color: string }) {
    const { t } = useLanguage()
    return (
        <p style={{ margin: 0, fontWeight: 600, color, display: 'grid' }}>
            {STATES.map(s => <span key={s} aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden' }}>{t(`face_sys_state_${s}`)}</span>)}
            <span style={{ gridArea: '1 / 1' }}>{text}</span>
        </p>
    )
}
type Rekey = { rotating: false } | { rotating: true; sameKey: true } | { rotating: true; sameKey?: undefined; total: number; previous: number; unreadable: number }

export default function FaceSystemSwitch() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data, error, mutate } = useSWR<{ data: { state: State; canChange: boolean } }>('/api/system-settings/face', fetcher)
    const { data: purgeBody, error: purgeError, mutate: reloadPurge } = useSWR<{ data: { at: string; keysDestroyed: number; photosDeleted: number; acknowledged: number } | null }>('/api/system-settings/face/purge', fetcher)
    const { data: rekeyBody, error: rekeyError, mutate: reloadRekey } = useSWR<{ data: Rekey }>('/api/system-settings/face/rekey', fetcher)
    const [asking, setAsking] = useState<'ON' | 'PAUSED' | null>(null)
    const [purging, setPurging] = useState(false)
    const [busy, setBusy] = useState(false)
    // A rotation runs a bounded share per press: where the last press stopped,
    // and how many are left by the screen's own count (review on #33; photosLeft).
    const [rekeyFrom, setRekeyFrom] = useState<{ table: string; after: string } | null>(null)
    const [rekeyLeft, setRekeyLeft] = useState<number | null>(null)
    // While it loads, the card already holds its place: rendering nothing and
    // then the card pushed the Branding card below it down on System settings
    // (Lighthouse: a layout shift of 0.2). It holds the loaded card's place,
    // hint, state line and a row of controls, and stays when the status can't
    // be read: a heading and a line alone still pushed Branding 158px down on
    // a phone, and an error took the card away (Codex review on #43). The
    // purge record and the rotation wait with it, as they'd push it too.
    const settled = (body: unknown, failed: unknown) => body !== undefined || !!failed
    if (!data || !settled(purgeBody, purgeError) || !settled(rekeyBody, rekeyError)) {
        return (
            <section className="glass" style={CARD} aria-busy={!error}>
                <h3 style={{ margin: 0 }}>{t('face_sys_title')}</h3>
                <p style={HINT}>{t('face_sys_hint')}</p>
                <StateLine text={error ? t('error_generic') : t('loading')} color={error ? 'var(--danger-fg)' : 'var(--text-soft)'} />
                <div style={CONTROLS} />
            </section>
        )
    }
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

    const rotation = rekeyBody?.data.rotating ? rekeyBody.data : null
    const left = rotation && !rotation.sameKey ? photosLeft(rekeyLeft, rotation.previous) : 0

    const rekey = async () => {
        // What showed as the press began: a status read during it may already have some of its moves.
        const shown = left
        setBusy(true)
        try {
            const res = await fetch('/api/system-settings/face/rekey', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: rekeyFrom }),
            })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            const run: { moved: number; next: { table: string; after: string } | null } = JSON.parse(text).data
            showToast(t('face_rekey_toast').replace('{moved}', String(run.moved)), 'success')
            if (run.next) {
                // More to read: the next press goes on from here, and the full count waits for the end.
                setRekeyFrom(run.next)
                setRekeyLeft(leftAfterPress(shown, run.moved))
            } else {
                setRekeyFrom(null)
                setRekeyLeft(null)
                reloadRekey()
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false) }
    }

    const tone = state === 'ON' ? 'var(--ok-fg)' : state === 'PAUSED' ? 'var(--warn-fg)' : 'var(--text-soft)'
    return (
        <section className="glass" style={CARD}>
            <h3 style={{ margin: 0 }}>{t('face_sys_title')}</h3>
            <p style={HINT}>{t('face_sys_hint')}</p>
            <StateLine text={t(`face_sys_state_${state}`)} color={tone} />
            <div style={CONTROLS}>
                {canChange ? (
                    <>
                        {state !== 'ON' && <button className="btn btn-primary" disabled={busy} onClick={() => setAsking('ON')}>{t(state === 'PAUSED' ? 'face_sys_resume' : 'face_sys_turn_on')}</button>}
                        {state === 'ON' && <button className="btn btn-secondary" disabled={busy} onClick={() => setAsking('PAUSED')}>{t('face_sys_pause')}</button>}
                        {state !== 'OFF' && <button className="btn btn-danger" disabled={busy} onClick={() => setPurging(true)}>{t('face_purge')}</button>}
                    </>
                ) : (
                    <p style={HINT}>{t('face_sys_protected_only')}</p>
                )}
            </div>
            {last && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: 0 }}>
                    {t('face_purge_record').replace('{date}', last.at.slice(0, 10)).replaceAll('{keys}', String(last.keysDestroyed)).replace('{photos}', String(last.photosDeleted)).replace('{acks}', String(last.acknowledged))}
                </p>
            )}
            {rotation && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>{t('face_rekey_title')}</p>
                    {rotation.sameKey ? (
                        <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--warn-fg)' }}>{t('face_rekey_same_key')}</p>
                    ) : rotation.previous > 0 ? (
                        <>
                            <p style={{ fontSize: '0.8rem', margin: 0 }}>{t('face_rekey_status').replace('{previous}', String(left)).replace('{total}', String(rotation.total))}</p>
                            <div><button className="btn btn-primary" disabled={busy} onClick={rekey}>{t('face_rekey_run')}</button></div>
                        </>
                    ) : (
                        <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--ok-fg)' }}>{t('face_rekey_done')}</p>
                    )}
                    {!rotation.sameKey && rotation.unreadable > 0 && (
                        <p style={{ fontSize: '0.8rem', margin: 0, color: 'var(--warn-fg)' }}>{t('face_rekey_unreadable').replace('{n}', String(rotation.unreadable))}</p>
                    )}
                </div>
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
