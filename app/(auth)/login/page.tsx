'use client'
import { signIn } from 'next-auth/react'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { reportClientError } from '@/lib/client-error-report'
import { apiErrorText } from '@/lib/api-error-text'
import { signInErrorKey, codeErrorKey, isWrongCode, waitOf } from '@/lib/login-errors'
import { codeError, emailCodeRefusal, signInErrors, type CodeKind, type SignInField } from '@/lib/sign-in-form'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { SignInScreen } from '@/components/sign-in/SignInScreen'
import { CredentialsStep } from '@/components/sign-in/CredentialsStep'
import { CodeStep } from '@/components/sign-in/CodeStep'
import { ResetPassword } from '@/components/sign-in/ResetPassword'
import { SignInMessage, type Hold } from '@/components/sign-in/SignInMessage'

/**
 * Signing in (DESIGN.md §5.5, Sign-in): the email or username and the
 * password, then, for an account with two-factor authentication on a device
 * it doesn't trust yet, the code from the authenticator app or one emailed
 * instead.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left): what's
 * wrong with what was typed is said under its field before anything is sent,
 * and what the server answered above the step's primary button, in the
 * page's language. Forgot your password is two steps of its own
 * (components/sign-in/ResetPassword.tsx).
 */
export default function LoginPage() {
    const { t } = useLanguage()
    const router = useRouter()

    const [identifier, setIdentifier] = useState('')
    const [password, setPassword] = useState('')
    const [staySignedIn, setStaySignedIn] = useState(false)
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<SignInField, string>>>({})
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    // Held back after wrong tries, counted down until it's over, and then
    // said that it's over (lib/sign-in-lock.ts, decided 2026-11-03).
    const [hold, setHold] = useState<Hold | null>(null)
    const [notice, setNotice] = useState('')
    /** Whether the server held sign-in back; if so, the count down is shown in place of an error. */
    const held = (serverError: string | undefined | null) => {
        const wait = waitOf(serverError)
        if (!wait) return false
        setError('')
        setHold({ kind: wait.kind, until: Date.now() + wait.seconds * 1000 })
        return true
    }
    const clearMessages = () => {
        setError('')
        setHold(null)
        setNotice('')
    }

    // F-27: 'credentials', then, if MFA is on and this browser isn't a
    // trusted device, the code: from the authenticator app ('app'), or one
    // emailed instead ('email'). An account without MFA never reaches the
    // code: authorize() returns a session at once.
    const [stage, setStage] = useState<'credentials' | CodeKind>('credentials')
    const [code, setCode] = useState('')
    const [codeErr, setCodeErr] = useState<string>()
    const [rememberDevice, setRememberDevice] = useState(false)
    const [sending, setSending] = useState(false)

    // F-27, Phase 3.5: entirely separate from the MFA stage machine above
    // — this is "I can't get in at all," not a second factor on top of a
    // password that already checked out. It starts from the email typed
    // here, if one was.
    const [mode, setMode] = useState<'login' | 'forgot'>('login')
    const [forgotEmail, setForgotEmail] = useState('')

    // Where the focus goes once the step it's in is on screen. Chosen after an
    // answer came, a step isn't put there at once, so it couldn't be focused
    // straight away. Counted, so the same place can be asked for again.
    const [focusOn, setFocusOn] = useState<{ selector: string; n: number } | null>(null)
    const focusNext = (selector: string) => setFocusOn(was => ({ selector, n: (was?.n ?? 0) + 1 }))
    useEffect(() => {
        if (focusOn) document.querySelector<HTMLElement>(focusOn.selector)?.focus()
    }, [focusOn])

    const resetBack = () => {
        setMode('login')
        focusNext('.ui-signin-forgot')
    }
    /** Reset: back to signing in, the email filled in, saying so, with the new password asked for. */
    const resetDone = (email: string) => {
        setIdentifier(email)
        setPassword('')
        setNotice(t('forgot_done'))
        setMode('login')
        focusNext('input[name="password"]')
    }

    /** A failure nothing answered for, such as no connection: in the page's language, with a reference for the admin when there is one. */
    const failed = async (err: unknown) => {
        const ref = await reportClientError(err, '/login')
        setError(ref ? t('sign_in_failed_ref').replace('{ref}', ref) : t('sign_in_failed'))
    }

    /**
     * Into the app, trusting this device first only at the end of a sign-in
     * that took a code (app/api/account/mfa/trust-device/route.ts): ticked at
     * a code, then Back to sign in and an account without two-factor, it was
     * trusted for that one too.
     */
    const finishLogin = async (trustDevice: boolean) => {
        if (trustDevice) {
            // Best-effort — a failed trust-device call just means being
            // asked for a code again next time, not a login failure.
            try {
                await fetch('/api/account/mfa/trust-device', { method: 'POST' })
            } catch { /* non-fatal */ }
        }
        router.push('/dashboard')
        router.refresh()
    }

    const handleCredentialsSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const form = e.currentTarget
        clearMessages()
        const wrong = signInErrors({ identifier, password })
        if (Object.keys(wrong).length > 0) {
            setFieldErrors(Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key)])))
            focusFirstWrong(form)
            return
        }
        setFieldErrors({})
        setLoading(true)
        try {
            // Without spaces at its ends, such as one a phone's keyboard adds
            // after a suggestion: what's sent is matched as it is
            // (lib/sign-in-account.ts), so "x@y.com " wasn't anybody's.
            const res = await signIn('credentials', {
                email: identifier.trim(),
                password,
                remember: staySignedIn.toString(),
                redirect: false,
            })

            if (res?.error === 'MFA_REQUIRED') {
                setStage('app')
                setCode('')
                setCodeErr(undefined)
                setLoading(false)
                return
            }

            if (res?.error) {
                if (!held(res.error)) {
                    const key = signInErrorKey(res.error)
                    setError(t(key))
                    // Readied to type again: Sign in, turned busy, took the focus with it.
                    if (key === 'error_invalid_credentials') {
                        const typed = form.querySelector<HTMLInputElement>('[name="password"]')
                        typed?.focus()
                        typed?.select()
                    }
                }
                setLoading(false)
            } else if (res?.ok) {
                await finishLogin(false)
            } else {
                setError(t('sign_in_failed'))
                setLoading(false)
            }
        } catch (err) {
            console.error('Login error:', err)
            await failed(err)
            setLoading(false)
        }
    }

    const handleCodeSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (stage === 'credentials') return
        const form = e.currentTarget
        const kind = stage
        clearMessages()
        const wrong = codeError(code, kind)
        if (wrong) {
            setCodeErr(t(wrong))
            focusFirstWrong(form)
            return
        }
        setCodeErr(undefined)
        setLoading(true)

        try {
            const res = await signIn('credentials', {
                email: identifier.trim(),
                password,
                remember: staySignedIn.toString(),
                ...(kind === 'email' ? { mfaRecoveryCode: code.trim() } : { mfaCode: code.trim() }),
                redirect: false,
            })

            if (res?.ok) {
                await finishLogin(rememberDevice)
                return
            }

            if (!held(res?.error)) {
                const key = codeErrorKey(res?.error, kind)
                if (isWrongCode(res?.error)) {
                    setCodeErr(t(key))
                    focusFirstWrong(form)
                } else {
                    setError(t(key))
                }
            }
            setLoading(false)
        } catch (err) {
            await failed(err)
            setLoading(false)
        }
    }

    /** "Email me a code instead", and from the emailed code's own step, a new one. */
    const emailCode = async () => {
        clearMessages()
        setSending(true)
        try {
            const res = await fetch('/api/auth/mfa-recovery/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: identifier.trim(), password }),
            })
            const text = await res.text()
            let data: { success?: boolean; error?: string; code?: string } = {}
            try {
                data = JSON.parse(text)
            } catch { /* not JSON: said as the fallback below */ }
            if (!res.ok || !data.success) {
                if (held(data.error)) return
                const key = emailCodeRefusal(data.code)
                setError(key ? t(key) : apiErrorText(text, t('sign_in_failed')))
                return
            }
            if (stage === 'email') setNotice(t('sign_in_email_code_sent'))
            setStage('email')
            setCode('')
            setCodeErr(undefined)
        } catch (err) {
            await failed(err)
        } finally {
            setSending(false)
        }
    }

    const switchToApp = () => {
        clearMessages()
        setStage('app')
        setCode('')
        setCodeErr(undefined)
    }

    const backToSignIn = () => {
        clearMessages()
        setStage('credentials')
        setCode('')
        setCodeErr(undefined)
        setPassword('')
        // The password, cleared, is what's asked for again.
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name="password"]')?.focus())
    }

    const message = (
        <SignInMessage hold={hold} error={error} notice={notice} onHoldOver={() => { setHold(null); setNotice(t('sign_in_wait_over')) }} />
    )

    if (mode === 'forgot') return <ResetPassword email={forgotEmail} onBack={resetBack} onDone={resetDone} />

    if (stage === 'credentials') {
        return (
            <SignInScreen title={t('sign_in_title')}>
                <CredentialsStep
                    identifier={identifier}
                    password={password}
                    staySignedIn={staySignedIn}
                    errors={fieldErrors}
                    message={message}
                    busy={loading}
                    onIdentifier={value => { setIdentifier(value); if (fieldErrors.identifier) setFieldErrors({ ...fieldErrors, identifier: undefined }) }}
                    onPassword={value => { setPassword(value); if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: undefined }) }}
                    onStaySignedIn={setStaySignedIn}
                    onSubmit={handleCredentialsSubmit}
                    // Forgot your password asks for the email, as the code goes
                    // there: filled in from here only when an email was typed.
                    onForgot={() => { setMode('forgot'); setForgotEmail(identifier.includes('@') ? identifier.trim() : ''); setFieldErrors({}); clearMessages() }}
                />
            </SignInScreen>
        )
    }

    return (
        <SignInScreen title={t('sign_in_code_title')} subtitle={t(stage === 'app' ? 'sign_in_code_app_hint' : 'sign_in_code_email_hint')}>
            <CodeStep key={stage}
                kind={stage}
                code={code}
                rememberDevice={rememberDevice}
                error={codeErr}
                message={message}
                busy={loading}
                sending={sending}
                onCode={value => { setCode(value); setCodeErr(undefined) }}
                onRememberDevice={setRememberDevice}
                onSubmit={handleCodeSubmit}
                onEmailCode={() => { void emailCode() }}
                onUseApp={switchToApp}
                onBack={backToSignIn}
            />
        </SignInScreen>
    )
}
