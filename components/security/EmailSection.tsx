'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useSession } from 'next-auth/react'
import { Button, Card, Field, StatusBadge, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { CODE_LENGTH, EMAIL_MAX, emailError, isCode, refusalText } from '@/lib/security-forms'
import { useViewer } from '@/lib/useCan'

// F-27: one component, two doors in. Reached two ways —
// (a) forced, via proxy.ts's redirect, whenever emailVerified is false: the
//     email field is editable here on purpose, since a user blocked from the
//     rest of the dashboard has no other way to fix a wrong/dead address
//     before verifying it.
// (b) voluntary, from Security Settings, once already verified, to change
//     the address — the same component, as a settings card.
// The protected super admin reaches the same gate to verify their (fixed)
// email once, but can't edit it — the field is off, its hint says why, and
// the backend (/api/account/email/*) enforces this independently regardless.
//
// On the building blocks (UI_PLAN.md §5 step 5, the pages left): in the gate,
// a card holding a form on a page of its own, as Change password is; after
// it, a settings card saying the address is verified. Each mistake is said
// under its field in the reader's language, the server's refusals too, which
// came in its English as they were (lib/security-forms.ts); where the code
// went is said beside it, rather than in a toast that left. It was a card of
// its own making, its words typed into the page in both languages.
export default function EmailSection({ gate }: { gate: boolean }) {
    const { t } = useLanguage()
    // Whose address, from the layout on the first paint: the session hook's
    // own copy is still loading then. update() is the session hook's.
    const viewer = useViewer()
    const { update } = useSession()
    const { showToast } = useToast()

    const currentEmail = viewer?.email || ''
    const isProtectedActor = viewer?.role === 'SUPER_ADMIN' && !!viewer?.isProtected

    const [email, setEmail] = useState(currentEmail)
    const [touched, setTouched] = useState(false)
    // The address the code went to, once one has: the second step.
    const [sentTo, setSentTo] = useState<string | null>(null)
    const [code, setCode] = useState('')
    const [sending, setSending] = useState(false)
    const [verifying, setVerifying] = useState(false)
    const [emailErr, setEmailErr] = useState<string>()
    const [codeErr, setCodeErr] = useState<string>()
    const form = useRef<HTMLFormElement>(null)
    // To the field said to be wrong, once it says so (DESIGN.md §5.3).
    const focusWrong = () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())

    // The address can change under this (verified, or changed here): follow
    // it until somebody starts typing.
    if (!touched && !sentTo && email !== currentEmail) setEmail(currentEmail)

    // In the gate, the address to verify, even unchanged; after it, only a
    // new one: the one already verified needs nothing.
    const changed = email.trim() !== currentEmail

    const sendCode = async (e: FormEvent) => {
        e.preventDefault()
        const wrong = emailError(email)
        if (wrong) {
            setEmailErr(t(wrong))
            focusWrong()
            return
        }
        setEmailErr(undefined)
        setSending(true)
        try {
            const res = await fetch('/api/account/email/request-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim() }),
            })
            if (!res.ok) {
                setEmailErr(refusalText('send', res.status, await res.text(), t))
                focusWrong()
                return
            }
            setSentTo(email.trim())
            setCode('')
            setCodeErr(undefined)
        } catch {
            setEmailErr(t('error_generic'))
        } finally {
            setSending(false)
        }
    }

    const handleVerifyCode = async (e: FormEvent) => {
        e.preventDefault()
        if (!sentTo) return
        if (!isCode(code)) {
            setCodeErr(t('security_email_code_invalid'))
            focusWrong()
            return
        }
        setCodeErr(undefined)
        setVerifying(true)
        try {
            const res = await fetch('/api/account/email/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: sentTo, code: code.trim() }),
            })
            const text = await res.text()
            if (!res.ok) {
                setCodeErr(refusalText('verify', res.status, text, t))
                setVerifying(false)
                focusWrong()
                return
            }
            const confirmed = (JSON.parse(text) as { data?: { email?: string } }).data?.email ?? sentTo
            const changedAddress = sentTo !== currentEmail
            await update({ emailVerified: true, email: confirmed })
            if (gate) {
                // Loaded afresh rather than moved to within the app, as Change
                // password is (PR 187): signing in went to the dashboard, which
                // was turned to this page, and the app kept that answer, so
                // moving there again came straight back here. Loaded afresh,
                // the gate and the layout read the new session. Still busy
                // meanwhile, so it isn't sent twice.
                window.location.replace('/dashboard')
                return
            }
            // Changed from the settings: it stays here, the new address in place.
            showToast(t(changedAddress ? 'email_changed_success' : 'email_verified_success'), 'success')
            setSentTo(null)
            setCode('')
            setTouched(false)
            setVerifying(false)
        } catch {
            setCodeErr(t('error_generic'))
            setVerifying(false)
        }
    }

    const formClass = gate ? 'ui-form' : 'ui-card-form'
    // A form on a page of its own has its main button first; a card's are on
    // its end side, the main one last (DESIGN.md §5.3, §5.5).
    const actionsClass = gate ? 'ui-form-actions' : 'ui-card-actions'
    const [before, after] = t('security_code_sent').split('{email}')

    const verifyButton = <Button type="submit" variant="primary" busy={verifying}>{t('verify_code_button')}</Button>
    const backButton = (
        <Button disabled={verifying} onClick={() => { setSentTo(null); setCode(''); setCodeErr(undefined) }}>{t('go_back')}</Button>
    )

    return (
        <Card title={gate ? undefined : t('email')}>
            {!gate && (
                <div className="ui-state-line">
                    <StatusBadge tone="good">{t('email_verified_badge')}</StatusBadge>
                </div>
            )}
            {!sentTo ? (
                <form ref={form} onSubmit={sendCode} noValidate className={formClass}>
                    <Field label={t('email_address_label')} error={emailErr}
                        hint={isProtectedActor ? t('email_protected_note') : gate ? undefined : t('security_email_change_hint')}>{p => (
                        <TextInput {...p} name="email" type="email" autoComplete="email" spellCheck={false} dir="ltr" maxLength={EMAIL_MAX}
                            value={email} disabled={isProtectedActor || sending}
                            onChange={e => { setTouched(true); setEmail(e.target.value); setEmailErr(undefined) }} />
                    )}</Field>
                    {/* A protected Super Admin verifies their address, and can't change it. */}
                    {(gate || !isProtectedActor) && (
                        <div className={actionsClass}>
                            <Button type="submit" variant="primary" busy={sending} disabled={!gate && !changed}>{t('send_code_button')}</Button>
                        </div>
                    )}
                </form>
            ) : (
                <form ref={form} onSubmit={handleVerifyCode} noValidate className={formClass}>
                    {/* The address left to right in either language (DESIGN.md §3.3). */}
                    <p className="ui-card-note" role="status">{before}<bdi dir="ltr" translate="no">{sentTo}</bdi>{after}</p>
                    <Field label={t('verification_code_label')} hint={t('check_spam_note')} error={codeErr}>{p => (
                        // Focused: the step it opens asks only for this.
                        <TextInput {...p} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH} spellCheck={false} dir="ltr" autoFocus
                            value={code} disabled={verifying} onChange={e => { setCode(e.target.value); setCodeErr(undefined) }} />
                    )}</Field>
                    <div className={actionsClass}>
                        {gate ? <>{verifyButton}{backButton}</> : <>{backButton}{verifyButton}</>}
                    </div>
                </form>
            )}
        </Card>
    )
}
