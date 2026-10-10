'use client'

import { Fragment, useState } from 'react'
import useSWR from 'swr'
import ConfirmModal from '@/components/ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import type { TranslationKey } from '@/lib/translations'
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
const CONTROLS = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', alignContent: 'flex-start' } as const
const STATES: readonly State[] = ['OFF', 'ON', 'PAUSED']
// What each state offers the protected Super Admin, in order.
const BUTTONS: Record<State, readonly { cls: string; label: TranslationKey; action: 'ON' | 'PAUSED' | 'PURGE' }[]> = {
    OFF: [{ cls: 'btn btn-primary', label: 'face_sys_turn_on', action: 'ON' }],
    ON: [{ cls: 'btn btn-secondary', label: 'face_sys_pause', action: 'PAUSED' }, { cls: 'btn btn-danger', label: 'face_purge', action: 'PURGE' }],
    PAUSED: [{ cls: 'btn btn-primary', label: 'face_sys_resume', action: 'ON' }, { cls: 'btn btn-danger', label: 'face_purge', action: 'PURGE' }],
}

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
/**
 * The row of controls, as tall as the tallest any state can show, at any
 * width: buttons, the protected-only line, or nothing yet. On a narrow phone,
 * or with the text zoomed, "Pause" and "Pause and purge" take two rows, and a
 * placeholder one button high still moved the cards below when they came
 * (Codex review on #49).
 */
function Controls({ children }: { children?: React.ReactNode }) {
    const { t } = useLanguage()
    return (
        <div style={{ display: 'grid' }}>
            {STATES.map(s => (
                <div key={s} aria-hidden="true" style={{ ...CONTROLS, gridArea: '1 / 1', visibility: 'hidden' }}>
                    {BUTTONS[s].map(b => <span key={b.action} className={b.cls}>{t(b.label)}</span>)}
                </div>
            ))}
            {/* And the line a Super Admin who isn't the protected one sees instead, which can wrap further on a
                narrow phone or with the text zoomed (Codex review on #49). */}
            <div aria-hidden="true" style={{ ...CONTROLS, gridArea: '1 / 1', visibility: 'hidden' }}>
                <p style={HINT}>{t('face_sys_protected_only')}</p>
            </div>
            <div style={{ ...CONTROLS, gridArea: '1 / 1' }}>{children}</div>
        </div>
    )
}
const LINE = { fontSize: '0.8rem', margin: 0 } as const
const COLUMN = { display: 'flex', flexDirection: 'column', gap: '0.5rem' } as const

/**
 * The rotation's section below its title, as tall as the tallest of what it
 * can show: photos left with the button, done, the same key twice, each with
 * the unreadable line where it can come. Hidden copies sit in one cell with
 * what shows. Kept to the button's layout alone, the done line that every
 * load shows once all are moved still moved the cards below (Codex review on
 * #49).
 */
function RotationBody({ children }: { children: React.ReactNode }) {
    const { t } = useLanguage()
    const unreadable = <p style={LINE}>{t('face_rekey_unreadable').replace('{n}', '0000')}</p>
    const layouts = [
        <Fragment key="left"><p style={LINE}>{t('face_rekey_status').replace('{previous}', '0000').replace('{total}', '0000')}</p><div><span className="btn btn-primary">{t('face_rekey_run')}</span></div>{unreadable}</Fragment>,
        <Fragment key="done"><p style={LINE}>{t('face_rekey_done')}</p>{unreadable}</Fragment>,
        <p key="same" style={LINE}>{t('face_rekey_same_key')}</p>,
    ]
    return (
        <div style={{ display: 'grid' }}>
            {layouts.map(layout => <div key={layout.key} aria-hidden="true" style={{ ...COLUMN, gridArea: '1 / 1', visibility: 'hidden' }}>{layout}</div>)}
            <div style={{ ...COLUMN, gridArea: '1 / 1' }}>{children}</div>
        </div>
    )
}
type Rekey = { rotating: false } | { rotating: true; sameKey: true } | { rotating: true; sameKey?: undefined; total: number; previous: number; unreadable: number }

export default function FaceSystemSwitch() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const { data, error, mutate } = useSWR<{ data: { state: State; canChange: boolean; rotating?: boolean } }>('/api/system-settings/face', fetcher)
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
    // purge record waits with it, as it would push it too. The rotation
    // doesn't: its status reads every stored photo (Codex review on #49).
    const settled = (body: unknown, failed: unknown) => body !== undefined || !!failed
    if (!data || !settled(purgeBody, purgeError)) {
        return (
            <section className="glass" style={CARD} aria-busy={!error}>
                <h3 style={{ margin: 0 }}>{t('face_sys_title')}</h3>
                <p style={HINT}>{t('face_sys_hint')}</p>
                <StateLine text={error ? t('error_generic') : t('loading')} color={error ? 'var(--danger-fg)' : 'var(--text-soft)'} />
                <Controls />
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
    // A rotation on, by the card's own status, whose details aren't here: its place is kept, and the rest
    // of the card is usable meanwhile. The card's status decides, as an answer kept from before the
    // rotation began still says none, while the slow one is read (Codex review on #49).
    const rotationWaiting = !!data.data.rotating && !rotation
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
            <Controls>
                {canChange ? BUTTONS[state].map(b => (
                    <button key={b.action} className={b.cls} disabled={busy} onClick={() => (b.action === 'PURGE' ? setPurging(true) : setAsking(b.action))}>{t(b.label)}</button>
                )) : (
                    <p style={HINT}>{t('face_sys_protected_only')}</p>
                )}
            </Controls>
            {last && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: 0 }}>
                    {t('face_purge_record').replace('{date}', last.at.slice(0, 10)).replaceAll('{keys}', String(last.keysDestroyed)).replace('{photos}', String(last.photosDeleted)).replace('{acks}', String(last.acknowledged))}
                </p>
            )}
            {(rotation || rotationWaiting) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                    <p style={{ margin: 0, fontWeight: 600 }}>{t('face_rekey_title')}</p>
                    <RotationBody>
                        {!rotation ? (
                            <p style={{ ...LINE, color: rekeyError ? 'var(--danger-fg)' : 'var(--text-soft)' }}>{rekeyError ? t('error_generic') : t('loading')}</p>
                        ) : rotation.sameKey ? (
                            <p style={{ ...LINE, color: 'var(--warn-fg)' }}>{t('face_rekey_same_key')}</p>
                        ) : rotation.previous > 0 ? (
                            <>
                                <p style={LINE}>{t('face_rekey_status').replace('{previous}', String(left)).replace('{total}', String(rotation.total))}</p>
                                <div><button className="btn btn-primary" disabled={busy} onClick={rekey}>{t('face_rekey_run')}</button></div>
                            </>
                        ) : (
                            <p style={{ ...LINE, color: 'var(--ok-fg)' }}>{t('face_rekey_done')}</p>
                        )}
                        {rotation && !rotation.sameKey && rotation.unreadable > 0 && (
                            <p style={{ ...LINE, color: 'var(--warn-fg)' }}>{t('face_rekey_unreadable').replace('{n}', String(rotation.unreadable))}</p>
                        )}
                    </RotationBody>
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
