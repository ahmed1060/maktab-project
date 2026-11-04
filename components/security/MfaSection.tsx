'use client'

import { useRef, useState, type FormEvent } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { DevicesIcon, HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { Button, Card, Dialog, DialogActions, EmptyState, Field, PasswordInput, Row, Rows, Section, StatusBadge, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { CODE_LENGTH, isCode } from '@/lib/security-forms'
import { fetcher } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'

type TrustedDevice = {
    id: string
    label: string | null
    createdAt: string
    lastUsedAt: string
    expiresAt: string
}

// F-27, Phase 4: enrollment + toggle. Opt-in and toggleable for everyone
// except a protected SuperAdmin, for whom enabling is still voluntary but
// disabling is a permanent one-way door (see /api/account/mfa/disable) —
// that's what "enforced" actually means for that account, not a separate
// flag flipped elsewhere later.
//
// On the building blocks (UI_PLAN.md §5 step 5, the pages left): a settings
// card with where it stands as a badge, setting it up in the card, and
// turning it off asked in a dialog, with the password and the danger
// button. Each mistake is said under its field in the reader's language. The
// trusted devices are a list under their own heading, each removed only once
// it's asked, where a click removed them at once; and a list that didn't load
// says so, where it said there were none. It was cards of their own making,
// their words typed into the page in both languages.

/** Whether two-factor authentication is on, setting it up, and turning it off. */
export function TwoFactorCard() {
    const { t } = useLanguage()
    // From the layout on the first paint, as the email card's.
    const viewer = useViewer()
    const { update } = useSession()
    const { showToast } = useToast()

    const on = !!viewer?.mfaEnabled
    const isProtectedActor = viewer?.role === 'SUPER_ADMIN' && !!viewer?.isProtected

    const [starting, setStarting] = useState(false)
    const [startError, setStartError] = useState('')
    const [enrolment, setEnrolment] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null)
    const [code, setCode] = useState('')
    const [codeErr, setCodeErr] = useState<string>()
    const [confirming, setConfirming] = useState(false)
    const [turningOff, setTurningOff] = useState(false)
    const form = useRef<HTMLFormElement>(null)
    const focusWrong = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

    const startEnroll = async () => {
        setStartError('')
        setStarting(true)
        try {
            const res = await fetch('/api/account/mfa/enroll', { method: 'POST' })
            const text = await res.text()
            if (!res.ok) {
                setStartError(apiErrorText(text, t('error_generic')))
                return
            }
            const { data } = JSON.parse(text) as { data: { secret: string; qrCodeDataUrl: string } }
            setEnrolment({ secret: data.secret, qrCodeDataUrl: data.qrCodeDataUrl })
            setCode('')
            setCodeErr(undefined)
        } catch {
            setStartError(t('error_generic'))
        } finally {
            setStarting(false)
        }
    }

    const confirmEnroll = async (e: FormEvent) => {
        e.preventDefault()
        if (!enrolment) return
        if (!isCode(code)) {
            setCodeErr(t('security_mfa_code_invalid'))
            focusWrong()
            return
        }
        setCodeErr(undefined)
        setConfirming(true)
        try {
            const res = await fetch('/api/account/mfa/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret: enrolment.secret, code: code.trim() }),
            })
            if (!res.ok) {
                setCodeErr(apiErrorText(await res.text(), t('error_generic')))
                focusWrong()
                return
            }
            await update({ mfaEnabled: true })
            showToast(t('security_mfa_on_done'), 'success')
            setEnrolment(null)
            setCode('')
        } catch {
            setCodeErr(t('error_generic'))
        } finally {
            setConfirming(false)
        }
    }

    const cancelEnroll = () => {
        setEnrolment(null)
        setCode('')
        setCodeErr(undefined)
    }

    return (
        <Card title={t('security_mfa_title')}>
            <div className="ui-state-line">
                <StatusBadge tone={on ? 'good' : 'neutral'}>{on ? t('security_mfa_on') : t('security_mfa_off')}</StatusBadge>
            </div>
            {on ? (
                <>
                    <p className="ui-card-note">{isProtectedActor ? t('security_mfa_required_note') : t('security_mfa_on_note')}</p>
                    {!isProtectedActor && (
                        <div className="ui-card-actions">
                            <Button onClick={() => setTurningOff(true)}>{t('security_mfa_turn_off')}</Button>
                        </div>
                    )}
                </>
            ) : enrolment ? (
                <form ref={form} onSubmit={confirmEnroll} noValidate className="ui-card-form">
                    <p className="ui-card-note">{t('security_mfa_scan')}</p>
                    {/* A data URL made by the server for this one secret: nothing for next/image to do. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={enrolment.qrCodeDataUrl} alt={t('security_mfa_qr_alt')} width={200} height={200} />
                    <details className="ui-more">
                        <summary>{t('security_mfa_cant_scan')}</summary>
                        {/* A key to type as it is: left to right, never translated. */}
                        <p className="ui-note-text"><code dir="ltr" translate="no">{enrolment.secret}</code></p>
                    </details>
                    <Field label={t('verification_code_label')} error={codeErr}>{p => (
                        <TextInput {...p} name="mfaCode" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH} spellCheck={false} dir="ltr"
                            value={code} disabled={confirming} onChange={e => { setCode(e.target.value); setCodeErr(undefined) }} />
                    )}</Field>
                    <div className="ui-card-actions">
                        <Button disabled={confirming} onClick={cancelEnroll}>{t('cancel')}</Button>
                        <Button type="submit" variant="primary" busy={confirming}>{t('security_mfa_turn_on')}</Button>
                    </div>
                </form>
            ) : (
                <>
                    <p className="ui-card-note">{t('security_mfa_off_note')}</p>
                    {startError && <p className="ui-error" role="alert">{startError}</p>}
                    <div className="ui-card-actions">
                        <Button variant="primary" busy={starting} onClick={startEnroll}>{t('security_mfa_set_up')}</Button>
                    </div>
                </>
            )}
            {turningOff && <TurnOffDialog onClose={() => setTurningOff(false)} />}
        </Card>
    )
}

/** Turning two-factor authentication off: the password, asked in a dialog, and the danger button. */
function TurnOffDialog({ onClose }: { onClose: () => void }) {
    const { t } = useLanguage()
    const { update } = useSession()
    const { showToast } = useToast()
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string>()
    const [busy, setBusy] = useState(false)
    const form = useRef<HTMLFormElement>(null)
    const focusWrong = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (busy) return
        if (!password) {
            setError(t('security_mfa_password_missing'))
            focusWrong()
            return
        }
        setError(undefined)
        setBusy(true)
        try {
            const res = await fetch('/api/account/mfa/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            })
            if (!res.ok) {
                setError(apiErrorText(await res.text(), t('error_generic')))
                setBusy(false)
                focusWrong()
                return
            }
            await update({ mfaEnabled: false })
            showToast(t('security_mfa_off_done'), 'success')
            onClose()
        } catch {
            setError(t('error_generic'))
            setBusy(false)
        }
    }

    return (
        // Once it's under way it can't be called off, so it can't look as if it was.
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('security_mfa_off_title')}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <p>{t('security_mfa_off_body')}</p>
                <Field label={t('password')} error={error}>{p => (
                    // Focused: the one thing this dialog asks for.
                    <PasswordInput {...p} name="password" autoComplete="current-password" autoFocus value={password} disabled={busy}
                        onChange={e => { setPassword(e.target.value); setError(undefined) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="danger" busy={busy}>{t('security_mfa_off_confirm')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * The devices that skip the code for 30 days, a list under its own heading,
 * each removed only once it's asked (F-27, Phase 6).
 */
export function TrustedDevices() {
    const { t, locale } = useLanguage()
    const { data, error, isValidating, mutate } = useSWR<{ data: { devices: TrustedDevice[] } }>('/api/account/mfa/trusted-devices', fetcher)
    const devices = data?.data?.devices
    const [removing, setRemoving] = useState<{ device: TrustedDevice } | { all: true } | null>(null)

    const day = (iso: string) => new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    const nameOf = (device: TrustedDevice) => device.label || t('security_device_unknown')

    return (
        <Section title={t('security_devices_title')} action={devices && devices.length > 0 ? (
            <Button variant="quiet" size="sm" onClick={() => setRemoving({ all: true })}>{t('security_devices_remove_all')}</Button>
        ) : undefined}>
            <p className="ui-hint">{t('security_devices_note')}</p>
            {!devices ? (
                error ? (
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('security_devices_load_failed')}
                            action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    </div>
                ) : (
                    <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
                )
            ) : devices.length === 0 ? (
                <div className="ui-panel"><EmptyState icon={DevicesIcon} title={t('security_devices_none')} /></div>
            ) : (
                <Rows label={t('security_devices_title')}>
                    {devices.map(device => (
                        <Row key={device.id}
                            // Named from the browser that asked: its own words, left to right or right to left as they are.
                            title={<span dir="auto">{nameOf(device)}</span>}
                            detail={t('security_device_last_used').replace('{date}', day(device.lastUsedAt))}
                            note={t('security_device_until').replace('{date}', day(device.expiresAt))}
                            end={(
                                <Button variant="quiet" size="sm" aria-label={t('security_device_remove_named').replace('{device}', nameOf(device))}
                                    onClick={() => setRemoving({ device })}>{t('remove')}</Button>
                            )} />
                    ))}
                </Rows>
            )}
            {removing && (
                <RemoveDialog
                    title={'all' in removing ? t('security_devices_remove_all_title') : t('security_device_remove_title').replace('{device}', nameOf(removing.device))}
                    body={'all' in removing ? t('security_devices_remove_all_body') : t('security_device_remove_body')}
                    confirmLabel={'all' in removing ? t('security_devices_remove_all') : t('remove')}
                    url={'all' in removing ? '/api/account/mfa/trusted-devices/revoke-all' : `/api/account/mfa/trusted-devices/${removing.device.id}`}
                    method={'all' in removing ? 'POST' : 'DELETE'}
                    onDone={() => { setRemoving(null); void mutate() }}
                    onCancel={() => setRemoving(null)} />
            )}
        </Section>
    )
}

/** Removing one trusted device, or all of them, once it's asked; the refusal said in the dialog. */
function RemoveDialog({ title, body, confirmLabel, url, method, onDone, onCancel }: {
    title: string
    body: string
    confirmLabel: string
    url: string
    method: 'POST' | 'DELETE'
    onDone: () => void
    onCancel: () => void
}) {
    const { t } = useLanguage()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')

    const remove = async () => {
        setError('')
        setBusy(true)
        try {
            const res = await fetch(url, { method })
            if (!res.ok) {
                setError(apiErrorText(await res.text(), t('error_generic')))
                setBusy(false)
                return
            }
            onDone()
        } catch {
            setError(t('error_generic'))
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!busy) onCancel() }} title={title}
            actions={<>
                <Button onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
                <Button variant="danger" busy={busy} onClick={() => { void remove() }}>{confirmLabel}</Button>
            </>}>
            <p>{body}</p>
            {error && <p className="ui-error" role="alert">{error}</p>}
        </Dialog>
    )
}
