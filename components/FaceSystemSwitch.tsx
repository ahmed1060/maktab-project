'use client'

import { useState, type ReactNode } from 'react'
import useSWR from 'swr'
import { ConfirmHealthAction } from '@/components/HealthDialogs'
import { Button, Card, Reserve, StatusBadge, type ButtonVariant, type StatusTone } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { leftAfterPress, photosLeft } from '@/lib/face-rekey-progress'
import { fetcher } from '@/lib/swr-fetcher'
import type { TranslationKey } from '@/lib/translations'

/**
 * Face verification for the whole system (ATTENDANCE_PLAN.md §10.4), on the
 * Super Admin's System Settings. Every Super Admin sees where it stands; only
 * the protected one switches it, after their own legal consultation, and the
 * server asks them for a fresh authenticator code. Off again is pause and
 * purge, typed to confirm, and its record says what was destroyed.
 *
 * While FACE_PHOTO_KEY is being rotated (mobile/README.md), any Super Admin
 * sees how many stored photos are still on the old key and moves them.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, Operations part 4b): a card
 * with its state as a badge in its meaning's colour, its buttons, and its
 * questions as the building blocks' dialogs. It holds the room of the most
 * it can show while it loads (Reserve), as it held it by hand: rendering
 * less, then the card, pushed the Branding card below it down (Lighthouse: a
 * layout shift of 0.2; Codex reviews on #43 and #49).
 */
type State = 'OFF' | 'ON' | 'PAUSED'
type Action = { variant: ButtonVariant; label: TranslationKey; action: 'ON' | 'PAUSED' | 'PURGE' }

const STATES: readonly State[] = ['OFF', 'ON', 'PAUSED']
const TONE: Record<State, StatusTone> = { ON: 'good', PAUSED: 'waiting', OFF: 'neutral' }
// What each state offers the protected Super Admin, in order.
const BUTTONS: Record<State, readonly Action[]> = {
    OFF: [{ variant: 'primary', label: 'face_sys_turn_on', action: 'ON' }],
    ON: [{ variant: 'secondary', label: 'face_sys_pause', action: 'PAUSED' }, { variant: 'danger', label: 'face_purge', action: 'PURGE' }],
    PAUSED: [{ variant: 'primary', label: 'face_sys_resume', action: 'ON' }, { variant: 'danger', label: 'face_purge', action: 'PURGE' }],
}

type Rekey = { rotating: false } | { rotating: true; sameKey: true } | { rotating: true; sameKey?: undefined; total: number; previous: number; unreadable: number }
type Purged = { at: string; keysDestroyed: number; photosDeleted: number; acknowledged: number }

export default function FaceSystemSwitch() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const intl = locale === 'ar' ? 'ar-EG' : 'en-GB'
    const num = (n: number) => n.toLocaleString(intl)
    const { data, error, isValidating, mutate } = useSWR<{ data: { state: State; canChange: boolean; rotating?: boolean } }>('/api/system-settings/face', fetcher)
    const { data: purgeBody, error: purgeError, mutate: reloadPurge } = useSWR<{ data: Purged | null }>('/api/system-settings/face/purge', fetcher)
    const { data: rekeyBody, error: rekeyError, isValidating: rekeyValidating, mutate: reloadRekey } = useSWR<{ data: Rekey }>('/api/system-settings/face/rekey', fetcher)
    const [asking, setAsking] = useState<{ to: 'ON' | 'PAUSED'; label: TranslationKey } | null>(null)
    const [purging, setPurging] = useState(false)
    const [busy, setBusy] = useState(false)
    // A rotation runs a bounded share per press: where the last press stopped,
    // and how many are left by the screen's own count (review on #33; photosLeft).
    const [rekeyFrom, setRekeyFrom] = useState<{ table: string; after: string } | null>(null)
    const [rekeyLeft, setRekeyLeft] = useState<number | null>(null)

    // The purge record waits with the state, as it would push the card when
    // it came. The rotation doesn't: its status reads every stored photo
    // (Codex review on #49).
    const ready = !!data && (purgeBody !== undefined || !!purgeError)
    const state = ready ? data.data.state : null
    const canChange = ready && data.data.canChange
    const last = ready ? purgeBody?.data ?? null : null

    const move = async (to: 'ON' | 'PAUSED') => {
        setBusy(true)
        try {
            const res = await fetch('/api/system-settings/face', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: to }) })
            const text = await res.text()
            // Refused, the question stays open, so it can be asked again.
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t(to === 'ON' ? 'face_sys_on_toast' : 'face_sys_paused_toast'), 'success')
            setAsking(null)
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false) }
    }

    const purge = async () => {
        setBusy(true)
        try {
            const res = await fetch('/api/system-settings/face/purge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'PURGE' }) })
            const text = await res.text()
            if (!res.ok) return showToast(apiErrorText(text, t('error_generic')), 'error')
            showToast(t('face_purge_done'), 'success')
            setPurging(false)
            void mutate()
            void reloadPurge()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false) }
    }

    const rotation = rekeyBody?.data.rotating ? rekeyBody.data : null
    // A rotation on, by the card's own status, whose details aren't here: its place is kept, and the rest
    // of the card is usable meanwhile. The card's status decides, as an answer kept from before the
    // rotation began still says none, while the slow one is read (Codex review on #49).
    const rotationWaiting = !!data?.data.rotating && !rotation
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
            showToast(t('face_rekey_toast').replace('{moved}', num(run.moved)), 'success')
            if (run.next) {
                // More to read: the next press goes on from here, and the full count waits for the end.
                setRekeyFrom(run.next)
                setRekeyLeft(leftAfterPress(shown, run.moved))
            } else {
                setRekeyFrom(null)
                setRekeyLeft(null)
                void reloadRekey()
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally { setBusy(false) }
    }

    // Where it stands, for each state, and when it couldn't be read.
    const stateLine = (s: State): ReactNode => <>
        <StatusBadge tone={TONE[s]}>{t(`face_sys_badge_${s}`)}</StatusBadge>
        <span className="ui-card-note">{t(`face_sys_detail_${s}`)}</span>
    </>
    const failedLine = <StatusBadge tone="problem">{t('face_sys_load_failed')}</StatusBadge>
    // The buttons a state offers; the same list is what each hidden copy shows, so a copy can't drift from them.
    const buttons = (s: State, live: boolean): ReactNode => BUTTONS[s].map(b => (
        <Button key={b.action} variant={b.variant} disabled={live && busy}
            onClick={live ? () => (b.action === 'PURGE' ? setPurging(true) : setAsking({ to: b.action, label: b.label })) : undefined}>
            {t(b.label)}
        </Button>
    ))
    const protectedOnly = <p className="ui-card-note">{t('face_sys_protected_only')}</p>
    const tryAgain = (validating: boolean, retry: () => void, small = false) =>
        <Button size={small ? 'sm' : 'md'} busy={validating} onClick={retry}>{t('try_again')}</Button>

    // The rotation's lines, for each thing it can say: photos left with the button, done, the same key twice.
    const unreadable = (n: number) => <p className="ui-card-note">{t('face_rekey_unreadable').replace('{n}', num(n))}</p>
    const leftLines = (n: number, total: number, live: boolean) => <>
        <p>{t('face_rekey_status').replace('{previous}', num(n)).replace('{total}', num(total))}</p>
        <Button variant="primary" disabled={live && busy} onClick={live ? rekey : undefined}>{t('face_rekey_run')}</Button>
    </>
    const doneLine = <p>{t('face_rekey_done')}</p>
    const sameKeyLine = <p className="ui-error">{t('face_rekey_same_key')}</p>

    return (
        <Card title={t('face_sys_title')}>
            <p className="ui-card-note">{t('face_sys_hint')}</p>
            <Reserve className="ui-state-line" room={[...STATES.map(stateLine), failedLine]}>
                {state ? stateLine(state) : error ? failedLine : <span className="ui-card-note" role="status">{t('loading')}</span>}
            </Reserve>
            <Reserve className="ui-card-actions" room={[...STATES.map(s => buttons(s, false)), protectedOnly, tryAgain(false, () => {})]}>
                {state ? (canChange ? buttons(state, true) : protectedOnly) : error && tryAgain(isValidating, () => { void mutate() })}
            </Reserve>
            {last && (
                <p className="ui-card-note">
                    {t('face_purge_record')
                        .replace('{date}', new Date(last.at).toLocaleDateString(intl, { day: 'numeric', month: 'short', year: 'numeric' }))
                        .replaceAll('{keys}', num(last.keysDestroyed)).replace('{photos}', num(last.photosDeleted)).replace('{acks}', num(last.acknowledged))}
                </p>
            )}
            {(rotation || rotationWaiting) && (
                <div className="ui-card-report">
                    <h3 className="ui-subsection-title">{t('face_rekey_title')}</h3>
                    {/* As tall as the most it can say, the unreadable line with each where it can come (Codex review on #49). */}
                    <Reserve className="ui-card-lines" room={[<>{leftLines(0, 0, false)}{unreadable(0)}</>, <>{doneLine}{unreadable(0)}</>, sameKeyLine]}>
                        {!rotation ? (
                            rekeyError
                                ? <><p className="ui-error">{t('face_rekey_load_failed')}</p>{tryAgain(rekeyValidating, () => { void reloadRekey() }, true)}</>
                                : <p className="ui-card-note" role="status">{t('loading')}</p>
                        ) : rotation.sameKey ? sameKeyLine : <>
                            {rotation.previous > 0 ? leftLines(left, rotation.total, true) : doneLine}
                            {rotation.unreadable > 0 && unreadable(rotation.unreadable)}
                        </>}
                    </Reserve>
                </div>
            )}
            {purging && (
                <ConfirmHealthAction title={t('face_purge_title')} body={t('face_purge_text')} word="PURGE" danger confirmLabel={t('face_purge')}
                    busy={busy} onConfirm={() => { void purge() }} onCancel={() => setPurging(false)} />
            )}
            {asking && (
                <ConfirmHealthAction
                    title={t(asking.to === 'ON' ? 'face_sys_confirm_on_title' : 'face_sys_confirm_pause_title')}
                    body={t(asking.to === 'ON' ? 'face_sys_confirm_on' : 'face_sys_confirm_pause')}
                    confirmLabel={t(asking.label)}
                    busy={busy} onConfirm={() => { void move(asking.to) }} onCancel={() => setAsking(null)} />
            )}
        </Card>
    )
}
