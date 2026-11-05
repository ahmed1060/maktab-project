'use client'

import type { FormEvent, ReactNode } from 'react'
import { Button, Field, PasswordInput, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { IDENTIFIER_MAX, PASSWORD_MAX, type SignInField } from '@/lib/sign-in-form'

/**
 * Signing in's first step (DESIGN.md §5.5, Sign-in): the email or username,
 * then the password, each with its label and its mistake under it, Forgot
 * your password? under the password, Stay signed in, and Sign in, with what
 * the server answered above it.
 *
 * Each field says what it's for (WCAG 1.3.5, Identify Input Purpose), so
 * password managers and browser autofill fill the right one. The email or
 * username is written left to right in both languages, as emails and
 * usernames are (DESIGN.md §3.3), never spell-checked or capitalised. Neither
 * has a placeholder: the label says what it is, and in Arabic the email's was
 * cut short at its start.
 */
export function CredentialsStep({ identifier, password, staySignedIn, errors, message, busy, onIdentifier, onPassword, onStaySignedIn, onSubmit, onForgot }: {
    identifier: string
    password: string
    staySignedIn: boolean
    errors: Partial<Record<SignInField, string>>
    /** What the server answered (SignInMessage), or nothing. */
    message: ReactNode
    busy: boolean
    onIdentifier: (value: string) => void
    onPassword: (value: string) => void
    onStaySignedIn: (on: boolean) => void
    onSubmit: (e: FormEvent<HTMLFormElement>) => void
    onForgot: () => void
}) {
    const { t } = useLanguage()
    return (
        <form className="ui-form ui-signin-form" noValidate onSubmit={onSubmit}>
            <Field label={t('sign_in_identifier')} error={errors.identifier}>{p => (
                <TextInput {...p} name="identifier" type="text" dir="ltr" autoComplete="username" spellCheck={false} autoCapitalize="none"
                    maxLength={IDENTIFIER_MAX} value={identifier} onChange={e => onIdentifier(e.target.value)} />
            )}</Field>
            <div className="ui-signin-password">
                <Field label={t('password')} error={errors.password}>{p => (
                    <PasswordInput {...p} name="password" autoComplete="current-password" maxLength={PASSWORD_MAX}
                        value={password} onChange={e => onPassword(e.target.value)} />
                )}</Field>
                <Button variant="quiet" className="ui-signin-forgot" onClick={onForgot}>{t('sign_in_forgot')}</Button>
            </div>
            <label className="ui-choice">
                <input type="checkbox" className="ui-check" name="staySignedIn" checked={staySignedIn} onChange={e => onStaySignedIn(e.target.checked)} />
                {t('stay_signed_in')}
            </label>
            <div className="ui-signin-actions">
                {message}
                <Button type="submit" variant="primary" busy={busy}>{t('sign_in')}</Button>
            </div>
        </form>
    )
}
