'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { Button, Field, PasswordInput, TextInput } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { SignInScreen } from '@/components/sign-in/SignInScreen'
import { SignInMessage, type Hold } from '@/components/sign-in/SignInMessage'
import { useLanguage } from '@/context/LanguageContext'
import { apiErrorText } from '@/lib/api-error-text'
import { reportClientError } from '@/lib/client-error-report'
import { PASSWORD_MAX } from '@/lib/new-password-form'
import { CODE_LENGTH, EMAIL_MAX, emailError } from '@/lib/security-forms'
import { resetErrors, resetRefusal, type ResetField } from '@/lib/sign-in-form'
import type { TranslationKey } from '@/lib/translations'

/**
 * Forgot your password's first step (DESIGN.md §5.5, Sign-in): the account's
 * email, focused, written left to right in both languages as emails are
 * (DESIGN.md §3.3), filled in as the account's name by password managers.
 */
export function ResetEmailStep({ email, error, message, busy, onEmail, onSubmit, onBack }: {
    email: string
    /** What's wrong with the email, said under it. */
    error?: string
    /** What the server answered (SignInMessage), or nothing. */
    message: ReactNode
    busy: boolean
    onEmail: (value: string) => void
    onSubmit: (e: FormEvent<HTMLFormElement>) => void
    onBack: () => void
}) {
    const { t } = useLanguage()
    return (
        <form className="ui-form ui-signin-form" noValidate onSubmit={onSubmit}>
            <Field label={t('email')} error={error}>{p => (
                // Focused: it's the one thing this step asks for.
                <TextInput {...p} name="email" type="email" dir="ltr" autoComplete="username" spellCheck={false} autoCapitalize="none" maxLength={EMAIL_MAX} autoFocus
                    value={email} onChange={e => onEmail(e.target.value)} />
            )}</Field>
            <div className="ui-signin-actions">
                {message}
                <Button type="submit" variant="primary" busy={busy}>{t('forgot_send')}</Button>
                <Button variant="quiet" onClick={onBack}>{t('sign_in_back')}</Button>
            </div>
        </form>
    )
}

/**
 * Its second step: the code sent, focused, with where it may be, then the
 * new password, asked twice as Change password asks it, its hint saying how
 * long it must be. Save new password is the step's one primary button; a new
 * code, a different email and going back are quiet under it.
 */
export function ResetCodeStep({ code, newPassword, confirmPassword, errors, message, busy, sending, onCode, onNewPassword, onConfirmPassword, onSubmit, onSendAgain, onOtherEmail, onBack }: {
    code: string
    newPassword: string
    confirmPassword: string
    /** What's wrong with each field, said under it. */
    errors: Partial<Record<ResetField, string>>
    /** What the server answered (SignInMessage), or nothing. */
    message: ReactNode
    busy: boolean
    /** A new code is being sent. */
    sending: boolean
    onCode: (value: string) => void
    onNewPassword: (value: string) => void
    onConfirmPassword: (value: string) => void
    onSubmit: (e: FormEvent<HTMLFormElement>) => void
    onSendAgain: () => void
    onOtherEmail: () => void
    onBack: () => void
}) {
    const { t } = useLanguage()
    return (
        <form className="ui-form ui-signin-form" noValidate onSubmit={onSubmit}>
            <Field label={t('sign_in_code')} hint={t('sign_in_code_spam')} error={errors.code}>{p => (
                // Focused: it's what came by email.
                <TextInput {...p} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH} spellCheck={false} dir="ltr" autoFocus
                    value={code} onChange={e => onCode(e.target.value)} />
            )}</Field>
            <Field label={t('change_password_new')} hint={t('change_password_new_hint')} error={errors.newPassword}>{p => (
                <PasswordInput {...p} name="newPassword" autoComplete="new-password" maxLength={PASSWORD_MAX}
                    value={newPassword} onChange={e => onNewPassword(e.target.value)} />
            )}</Field>
            <Field label={t('change_password_confirm')} error={errors.confirmPassword}>{p => (
                <PasswordInput {...p} name="confirmPassword" autoComplete="new-password" maxLength={PASSWORD_MAX}
                    value={confirmPassword} onChange={e => onConfirmPassword(e.target.value)} />
            )}</Field>
            <div className="ui-signin-actions">
                {message}
                <Button type="submit" variant="primary" busy={busy}>{t('change_password_save')}</Button>
                <Button variant="quiet" busy={sending} onClick={onSendAgain}>{t('sign_in_email_code_again')}</Button>
                <Button variant="quiet" onClick={onOtherEmail}>{t('forgot_other_email')}</Button>
                <Button variant="quiet" onClick={onBack}>{t('sign_in_back')}</Button>
            </div>
        </form>
    )
}

/**
 * The line under the second step's title: a code was sent to the email as
 * typed, if it's on an account, so a mistake in it shows. Written left to
 * right within an Arabic sentence, as an email is.
 */
export function ResetSentTo({ email }: { email: string }) {
    const { t } = useLanguage()
    const [before, after] = t('forgot_code_hint').split('{email}')
    return <>{before}<bdi>{email}</bdi>{after}</>
}

type Answer = { success?: boolean; error?: string; code?: unknown; wait?: unknown } | null

/**
 * Forgot your password (DESIGN.md §5.5, Sign-in), two steps in the sign-in
 * card: the account's email, then the code sent to it with the new password.
 * Neither says whether the email is on an account
 * (app/api/auth/forgot-password/request/route.ts). What's wrong with what was
 * typed is said under its field before anything is sent, and what the server
 * answered above the step's primary button, in the page's language: too many
 * tries are counted down, as signing in counts an account held back.
 *
 * It was a form of its own making, its words typed into the page in both
 * languages, its mistakes said at the top of the card in English.
 */
export function ResetPassword({ email: typedAtSignIn, onBack, onDone }: {
    /** The email to start from: the one typed at signing in, if one was. */
    email: string
    onBack: () => void
    /** Reset: the email it was for, without spaces at its ends. */
    onDone: (email: string) => void
}) {
    const { t } = useLanguage()
    const [step, setStep] = useState<'email' | 'code'>('email')
    const [email, setEmail] = useState(typedAtSignIn)
    const [emailErr, setEmailErr] = useState<string>()
    const [code, setCode] = useState('')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [errors, setErrors] = useState<Partial<Record<ResetField, string>>>({})
    const [busy, setBusy] = useState(false)
    const [sending, setSending] = useState(false)
    const [error, setError] = useState('')
    const [hold, setHold] = useState<Hold | null>(null)
    const [notice, setNotice] = useState('')
    const clearMessages = () => {
        setError('')
        setHold(null)
        setNotice('')
    }

    /** A failure nothing answered for, such as no connection, in the page's language. */
    const failed = async (err: unknown, key: TranslationKey) => {
        await reportClientError(err, '/login')
        setError(t(key))
    }

    /**
     * Whether the server did it. If not, its refusal is said by its code:
     * under its field, with the focus there, or counted down above the
     * primary button; anything else as the server put it.
     */
    const done = async (res: Response, fallback: TranslationKey, form: HTMLFormElement | null) => {
        const text = await res.text()
        let body: Answer = null
        try {
            body = JSON.parse(text)
        } catch { /* not JSON: said as the fallback below */ }
        if (res.ok && body?.success) return true
        const refusal = resetRefusal(body)
        if (!refusal) {
            setError(apiErrorText(text, t(fallback)))
        } else if ('wait' in refusal) {
            setHold({ kind: 'reset', until: Date.now() + refusal.wait * 1000 })
        } else {
            if (refusal.field === 'email') setEmailErr(t(refusal.key))
            else setErrors(was => ({ ...was, code: t(refusal.key) }))
            if (form) focusFirstWrong(form)
        }
        return false
    }

    const sendCode = () => fetch('/api/auth/forgot-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Without spaces at its ends, as signing in sends it.
        body: JSON.stringify({ email: email.trim() }),
    })

    const handleEmail = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        clearMessages()
        const wrong = emailError(email)
        if (wrong) {
            setEmailErr(t(wrong))
            focusFirstWrong(form)
            return
        }
        setEmailErr(undefined)
        setBusy(true)
        try {
            if (await done(await sendCode(), 'forgot_send_failed', form)) {
                setStep('code')
                setCode('')
                setErrors({})
            }
        } catch (err) {
            await failed(err, 'forgot_send_failed')
        } finally {
            setBusy(false)
        }
    }

    const handleCode = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        clearMessages()
        const wrong = resetErrors({ code, newPassword, confirmPassword })
        if (Object.keys(wrong).length > 0) {
            setErrors(Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key)])))
            focusFirstWrong(form)
            return
        }
        setErrors({})
        setBusy(true)
        try {
            const res = await fetch('/api/auth/forgot-password/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // The password as typed: spaces may be part of it.
                body: JSON.stringify({ email: email.trim(), code: code.trim(), newPassword }),
            })
            if (await done(res, 'change_password_failed', form)) {
                onDone(email.trim())
                return
            }
        } catch (err) {
            await failed(err, 'change_password_failed')
        }
        setBusy(false)
    }

    /** A new code from the second step, said as sent, if the email is on an account. */
    const sendAgain = async () => {
        clearMessages()
        setSending(true)
        try {
            if (await done(await sendCode(), 'forgot_send_failed', null)) {
                setNotice(t('forgot_sent_again'))
                setCode('')
                setErrors(was => ({ ...was, code: undefined }))
                // Turned busy, the button lost the focus: the new code is what's asked for next.
                requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name="code"]')?.focus())
            }
        } catch (err) {
            await failed(err, 'forgot_send_failed')
        } finally {
            setSending(false)
        }
    }

    const message = (
        <SignInMessage hold={hold} error={error} notice={notice} onHoldOver={() => { setHold(null); setNotice(t('forgot_wait_over')) }} />
    )

    if (step === 'email') {
        return (
            <SignInScreen title={t('forgot_title')} subtitle={t('forgot_email_hint')}>
                <ResetEmailStep
                    email={email}
                    error={emailErr}
                    message={message}
                    busy={busy}
                    onEmail={value => { setEmail(value); setEmailErr(undefined) }}
                    onSubmit={handleEmail}
                    onBack={onBack}
                />
            </SignInScreen>
        )
    }

    return (
        <SignInScreen title={t('forgot_title')} subtitle={<ResetSentTo email={email.trim()} />}>
            <ResetCodeStep
                code={code}
                newPassword={newPassword}
                confirmPassword={confirmPassword}
                errors={errors}
                message={message}
                busy={busy}
                sending={sending}
                onCode={value => { setCode(value); setErrors(was => ({ ...was, code: undefined })) }}
                onNewPassword={value => { setNewPassword(value); setErrors(was => ({ ...was, newPassword: undefined })) }}
                onConfirmPassword={value => { setConfirmPassword(value); setErrors(was => ({ ...was, confirmPassword: undefined })) }}
                onSubmit={handleCode}
                onSendAgain={() => { void sendAgain() }}
                onOtherEmail={() => { clearMessages(); setStep('email') }}
                onBack={onBack}
            />
        </SignInScreen>
    )
}
