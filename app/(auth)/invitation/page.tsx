'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button, ButtonLink, Field, PasswordInput, TextInput } from '@/components/ui'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { SignInScreen } from '@/components/sign-in/SignInScreen'
import { SignInMessage, type Hold } from '@/components/sign-in/SignInMessage'
import { useLanguage } from '@/context/LanguageContext'
import { apiErrorText } from '@/lib/api-error-text'
import { reportClientError } from '@/lib/client-error-report'
import type { InvitationView } from '@/lib/client-invitation'
import { newPasswordErrors, PASSWORD_MAX, type NewPasswordField } from '@/lib/new-password-form'
import type { TranslationKey } from '@/lib/translations'

/**
 * Setting a password from an invitation (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md
 * §5.2, step 6b-1): where one of a client's people lands from the link in
 * their invitation, on the sign-in screen's frame.
 *
 * The link's secret is after the #, which the browser never sends with the
 * page: it's read here, taken out of the address bar, so it isn't left in
 * the browser's history or shown over a shoulder, and sent only in the body
 * of the two requests, which no log keeps.
 *
 * It opens in the language the person was invited in (step 6b-2, PR 325).
 */

/** A link that can't be used, each said as it is. */
type Unusable = 'expired' | 'unknown' | 'closed'
const UNUSABLE: Record<string, Unusable> = {
    INVITATION_EXPIRED: 'expired',
    INVITATION_UNKNOWN: 'unknown',
    INVITATION_TOKEN_REQUIRED: 'unknown',
    INVITATION_CLOSED: 'closed',
}
const UNUSABLE_WORDS: Record<Unusable, { title: TranslationKey; detail: TranslationKey }> = {
    expired: { title: 'invitation_expired_title', detail: 'invitation_expired_detail' },
    unknown: { title: 'invitation_unknown_title', detail: 'invitation_unknown_detail' },
    closed: { title: 'invitation_closed_title', detail: 'invitation_closed_detail' },
}
/** What's wrong with a password the server refused, said under its field. */
const PASSWORD_WORDS: Record<string, [NewPasswordField, TranslationKey]> = {
    INVITATION_PASSWORD_SHORT: ['newPassword', 'change_password_short'],
    INVITATION_PASSWORD_LONG: ['newPassword', 'invitation_password_long'],
    INVITATION_PASSWORD_MISMATCH: ['confirmPassword', 'change_password_mismatch'],
}

type Stage =
    | { at: 'opening' }
    | { at: 'form'; view: InvitationView; token: string }
    | { at: 'done'; email: string }
    | { at: 'unusable'; why: Unusable }
    | { at: 'failed' }

type Answer = { ok: true; body: { data?: unknown } } | { ok: false; status: number; code?: string; wait?: number; text: string }

/** Sends the secret, and whatever goes with it, in a request's body. */
async function send(path: '/api/invitation' | '/api/invitation/password', body: Record<string, string>): Promise<Answer> {
    const res = path === '/api/invitation'
        ? await fetch('/api/invitation', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/invitation/password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const text = await res.text()
    if (res.ok) return { ok: true, body: JSON.parse(text) }
    let answer: { code?: string; wait?: number } = {}
    try { answer = JSON.parse(text) } catch { /* not the app's own answer */ }
    return { ok: false, status: res.status, code: answer.code, wait: answer.wait, text }
}

export default function InvitationPage() {
    const { t, setLanguage, isChangingLocale } = useLanguage()
    const token = useRef('')
    const opened = useRef(false)
    /** Which reading of a link is the page's now: another link opened in its place makes the one before old. */
    const generation = useRef(0)
    const form = useRef<HTMLFormElement>(null)
    /** The link whose language the page has been turned to. */
    const languageFor = useRef<InvitationView | null>(null)
    const [stage, setStage] = useState<Stage>({ at: 'opening' })
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [errors, setErrors] = useState<Partial<Record<NewPasswordField, TranslationKey>>>({})
    const [error, setError] = useState('')
    const [hold, setHold] = useState<Hold | null>(null)
    const [busy, setBusy] = useState(false)

    /** A refusal that isn't about the password: the link can't be used, too many tries, or what the server said. */
    const refused = (answer: Extract<Answer, { ok: false }>) => {
        const why = answer.code && UNUSABLE[answer.code]
        if (why) return setStage({ at: 'unusable', why })
        if (answer.status === 429 && answer.wait) return setHold({ kind: 'invitation', until: Date.now() + answer.wait * 1000 })
        setError(apiErrorText(answer.text, t('error_generic')))
    }

    const open = async () => {
        const mine = ++generation.current
        // Read once, then out of the address bar.
        const sent = token.current = token.current || window.location.hash.slice(1)
        if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search)
        try {
            const answer = await send('/api/invitation', { token: sent })
            // Another link opened meanwhile: its answer is the one shown
            // (found by Codex on PR 324).
            if (mine !== generation.current) return
            // The form goes with the link it was read for, and sets that one's password.
            if (answer.ok) setStage({ at: 'form', view: answer.body.data as InvitationView, token: sent })
            else if (answer.code && UNUSABLE[answer.code]) setStage({ at: 'unusable', why: UNUSABLE[answer.code] })
            else { setStage({ at: 'failed' }); refused(answer) }
        } catch (e) {
            if (mine !== generation.current) return
            void reportClientError(e, '/invitation')
            setError(t('error_generic'))
            setStage({ at: 'failed' })
        }
    }

    useEffect(() => {
        // Once as the page opens, and again for another link opened in its
        // place, which a browser doesn't load as a new page: the secret is
        // gone from the address after.
        if (!opened.current) {
            opened.current = true
            void open()
        }
        const another = () => {
            if (!window.location.hash) return
            token.current = ''
            setPassword('')
            setConfirmPassword('')
            setErrors({})
            setError('')
            setHold(null)
            setStage({ at: 'opening' })
            void open()
        }
        window.addEventListener('hashchange', another)
        return () => window.removeEventListener('hashchange', another)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // In the language they were invited in, once for each link read, so the
    // language switch under the card can still change it. Switched from the
    // page as it's drawn then, which knows the language it's in now, and once
    // a switch under way is done: one asked for meanwhile does nothing.
    const invited = stage.at === 'form' ? stage.view : null
    useEffect(() => {
        if (!invited || isChangingLocale || languageFor.current === invited) return
        languageFor.current = invited
        setLanguage(invited.language)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [invited, isChangingLocale])

    const submit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (stage.at !== 'form') return
        const mine = generation.current
        setError('')
        const wrong = newPasswordErrors({ newPassword: password, confirmPassword })
        setErrors(wrong)
        if (Object.keys(wrong).length) return focusFirstWrong(form.current)
        setBusy(true)
        try {
            const answer = await send('/api/invitation/password', { token: stage.token, password, confirmPassword })
            // Another link opened meanwhile: the page is that one's now.
            if (mine !== generation.current) return
            if (answer.ok) return setStage({ at: 'done', email: (answer.body.data as { email: string }).email })
            const field = answer.code && PASSWORD_WORDS[answer.code]
            if (field) {
                setErrors({ [field[0]]: field[1] })
                return focusFirstWrong(form.current)
            }
            refused(answer)
        } catch (err) {
            if (mine !== generation.current) return
            void reportClientError(err, '/invitation')
            setError(t('error_generic'))
        } finally {
            setBusy(false)
        }
    }

    if (stage.at === 'opening') {
        return <SignInScreen title={t('invitation_title')}><p className="ui-hint" role="status">{t('invitation_loading')}</p></SignInScreen>
    }
    if (stage.at === 'failed') {
        return (
            <SignInScreen title={t('invitation_title')}>
                <div className="ui-signin-actions">
                    <SignInMessage hold={hold} error={error} notice="" onHoldOver={() => setHold(null)} />
                    <Button variant="primary" onClick={() => { setError(''); setHold(null); setStage({ at: 'opening' }); void open() }}>{t('try_again')}</Button>
                </div>
            </SignInScreen>
        )
    }
    if (stage.at === 'unusable') {
        const words = UNUSABLE_WORDS[stage.why]
        return (
            <SignInScreen title={t(words.title)} subtitle={t(words.detail)}>
                <div className="ui-signin-actions">
                    <ButtonLink variant="quiet" href="/login">{t('invitation_sign_in')}</ButtonLink>
                </div>
            </SignInScreen>
        )
    }
    if (stage.at === 'done') {
        return (
            <SignInScreen title={t('invitation_done_title')} subtitle={named(t('invitation_done_detail'), { email: stage.email })}>
                <div className="ui-signin-actions" role="status">
                    <ButtonLink variant="primary" href="/login">{t('invitation_sign_in')}</ButtonLink>
                </div>
            </SignInScreen>
        )
    }

    const { view } = stage
    return (
        <SignInScreen title={t('invitation_title')} subtitle={named(t('invitation_from'), { office: view.office, client: view.client })}>
            <form ref={form} className="ui-form ui-signin-form" noValidate onSubmit={submit}>
                <Field label={t('email')}>{p => (
                    // Theirs alone, and what they'll sign in with: shown, never changed here.
                    <TextInput {...p} name="email" type="email" dir="ltr" autoComplete="username" spellCheck={false} autoCapitalize="none" readOnly value={view.email} />
                )}</Field>
                <Field label={t('invitation_password')} hint={t('change_password_new_hint')} error={errors.newPassword && t(errors.newPassword)}>{p => (
                    <PasswordInput {...p} name="newPassword" autoComplete="new-password" maxLength={PASSWORD_MAX} autoFocus
                        value={password} onChange={e => { setPassword(e.target.value); setErrors(was => ({ ...was, newPassword: undefined })) }} />
                )}</Field>
                <Field label={t('invitation_confirm')} error={errors.confirmPassword && t(errors.confirmPassword)}>{p => (
                    <PasswordInput {...p} name="confirmPassword" autoComplete="new-password" maxLength={PASSWORD_MAX}
                        value={confirmPassword} onChange={e => { setConfirmPassword(e.target.value); setErrors(was => ({ ...was, confirmPassword: undefined })) }} />
                )}</Field>
                <div className="ui-signin-actions">
                    <SignInMessage hold={hold} error={error} notice="" onHoldOver={() => setHold(null)} />
                    <Button type="submit" variant="primary" busy={busy}>{t('invitation_set')}</Button>
                    <p className="ui-hint">{t('invitation_once')}</p>
                </div>
            </form>
        </SignInScreen>
    )
}

/** A sentence with names in it, each kept whole in either language (DESIGN.md §3.2), and left as it is by a browser's translation. */
function named(sentence: string, names: Record<string, string>) {
    return sentence.split(/(\{[a-z]+\})/).map((part, i) => {
        const name = /^\{([a-z]+)\}$/.exec(part)?.[1]
        return name && names[name] !== undefined ? <bdi key={i} translate="no" dir={name === 'email' ? 'ltr' : undefined}>{names[name]}</bdi> : part
    })
}
