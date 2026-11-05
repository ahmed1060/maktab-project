'use client'

import type { FormEvent, ReactNode } from 'react'
import { Button, Field, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { CODE_LENGTH } from '@/lib/security-forms'
import type { CodeKind } from '@/lib/sign-in-form'

/**
 * Signing in's second step, for an account with two-factor authentication on
 * a device it doesn't trust yet (DESIGN.md §5.5, Sign-in): the code from the
 * authenticator app, or one emailed instead. The code takes the focus, its
 * six digits written left to right, and what's wrong with it is said under
 * it. Verify is the step's one primary button; the other ways on are quiet
 * under it. A code can be emailed again from the emailed code's own step,
 * where its being wrong or expired says so.
 *
 * Remember this device is offered with either code: ticked before choosing
 * an emailed one, it was hidden there and still remembered the device.
 */
export function CodeStep({ kind, code, rememberDevice, error, message, busy, sending, onCode, onRememberDevice, onSubmit, onEmailCode, onUseApp, onBack }: {
    kind: CodeKind
    code: string
    rememberDevice: boolean
    /** What's wrong with the code, said under it. */
    error?: string
    /** What the server answered (SignInMessage), or nothing. */
    message: ReactNode
    busy: boolean
    /** A code is being emailed. */
    sending: boolean
    onCode: (value: string) => void
    onRememberDevice: (on: boolean) => void
    onSubmit: (e: FormEvent<HTMLFormElement>) => void
    onEmailCode: () => void
    onUseApp: () => void
    onBack: () => void
}) {
    const { t } = useLanguage()
    return (
        <form className="ui-form ui-signin-form" noValidate onSubmit={onSubmit}>
            <Field label={t('sign_in_code')} hint={kind === 'email' ? t('sign_in_code_spam') : undefined} error={error}>{p => (
                // Focused: it's the one thing this step asks for.
                <TextInput {...p} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={CODE_LENGTH} spellCheck={false} dir="ltr" autoFocus
                    value={code} onChange={e => onCode(e.target.value)} />
            )}</Field>
            <label className="ui-choice">
                <input type="checkbox" className="ui-check" name="rememberDevice" checked={rememberDevice} onChange={e => onRememberDevice(e.target.checked)} />
                {t('sign_in_remember_device')}
            </label>
            <div className="ui-signin-actions">
                {message}
                <Button type="submit" variant="primary" busy={busy}>{t('sign_in_verify')}</Button>
                {kind === 'app'
                    ? <Button variant="quiet" busy={sending} onClick={onEmailCode}>{t('sign_in_email_code')}</Button>
                    : <>
                        <Button variant="quiet" busy={sending} onClick={onEmailCode}>{t('sign_in_email_code_again')}</Button>
                        <Button variant="quiet" onClick={onUseApp}>{t('sign_in_use_app')}</Button>
                    </>}
                <Button variant="quiet" onClick={onBack}>{t('sign_in_back')}</Button>
            </div>
        </form>
    )
}
