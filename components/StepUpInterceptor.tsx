'use client'

import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react'
import { useSession } from 'next-auth/react'
import { Button, ButtonLink, Dialog, DialogActions, Field, TextInput } from '@/components/ui'
import { stepUpWaiting } from '@/lib/step-up-waiting'
import { stepUpCheck } from '@/lib/step-up-check'
import { codeDigits, isCode } from '@/lib/security-forms'
import { countOf } from '@/lib/plural'
import { useLanguage } from '@/context/LanguageContext'

/**
 * Step-up confirmation for high-risk actions (ROLES_PLAN.md §6.15), for every
 * screen at once.
 *
 * A high-risk route answers 403 with `code: STEP_UP_REQUIRED` when the session
 * has not confirmed recently. This catches that answer, asks for the
 * authenticator code, has the server check it (a session update — the server
 * writes the time into the signed token, never the browser), and sends the
 * original request again; the screen that asked gets that second answer and
 * never knows. Cancelling hands it the refusal. `MFA_ENROL_REQUIRED` says to
 * set up two-factor authentication first.
 *
 * On the building blocks' dialog, above every other one (DESIGN.md §5.5,
 * Dialog; PR 217): it was the last of the older pages' windows.
 */

type Ask = { kind: 'code' | 'enrol'; minutes: number }
/** What's said under the code: not six digits, not right, or not checked. */
export type CodeError = 'invalid' | 'wrong' | 'unchecked'

const ERROR_TEXT = { invalid: 'security_mfa_code_invalid', wrong: 'security_mfa_code_wrong', unchecked: 'step_up_unchecked' } as const

export default function StepUpInterceptor() {
    const { data: current, update } = useSession()
    const [ask, setAsk] = useState<Ask | null>(null)
    // Every request waiting on the prompt, settled together by its answer.
    const [waiting] = useState(stepUpWaiting)
    const [code, setCode] = useState('')
    const [error, setError] = useState<CodeError | null>(null)
    const [checking, setChecking] = useState(false)
    // The code's field, to go back to with what's wrong under it.
    const field = useRef<HTMLInputElement>(null)
    // The latest update() for the patched fetch, which is installed once.
    const updateRef = useRef(update)
    useEffect(() => { updateRef.current = update }, [update])
    // What the session said before asking: a confirmation is a new time, not
    // one compared against this browser's clock, which may not agree.
    const previousRef = useRef<number | null>(null)
    useEffect(() => { previousRef.current = (current?.user as { stepUpAt?: number | null } | undefined)?.stepUpAt ?? null }, [current])

    useEffect(() => {
        const { fetch: inner } = window
        const waitFor = (kind: Ask['kind'], minutes: number) => waiting.wait(() => setAsk({ kind, minutes }))

        window.fetch = async (input, init) => {
            // A Request's body can be read once; keep a copy to send again.
            const again = input instanceof Request ? input.clone() : input
            const res = await inner(input, init)
            if (res.status !== 403) return res
            const body = await res.clone().json().catch(() => null)
            if (body?.code === 'MFA_ENROL_REQUIRED') {
                await waitFor('enrol', body.minutes ?? 60)
                return res
            }
            if (body?.code !== 'STEP_UP_REQUIRED') return res
            const confirmed = await waitFor('code', body.minutes ?? 60)
            return confirmed ? inner(again, init) : res
        }
        return () => { window.fetch = inner }
    }, [waiting])

    // What was typed is never kept: each time it opens, the field is empty.
    const close = (confirmed: boolean) => {
        waiting.settle(confirmed)
        setAsk(null)
        setCode('')
        setError(null)
    }
    // Not while the code is checked: its answer decides.
    const cancel = () => { if (!checking) close(false) }
    const wrongly = (problem: CodeError) => {
        setError(problem)
        field.current?.focus()
    }

    const confirm = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (checking) return
        // Said under the code before anything is sent, as signing in's is.
        if (!isCode(code)) return wrongly('invalid')
        setChecking(true)
        setError(null)
        try {
            const session = await updateRef.current({ stepUpCode: code.trim() })
            const check = stepUpCheck(session, previousRef.current)
            if (check === 'confirmed') close(true)
            else wrongly(check)
        } finally {
            setChecking(false)
        }
    }

    if (!ask) return null
    if (ask.kind === 'enrol') return <StepUpEnrolDialog onClose={() => close(false)} />
    return (
        <StepUpCodeDialog minutes={ask.minutes} code={code} error={error} checking={checking} field={field}
            onCode={value => setCode(codeDigits(value))} onSubmit={confirm} onCancel={cancel} />
    )
}

/**
 * The code (DESIGN.md §5.5, Dialog): a form over the confirmation that sent
 * the action, which waits, open, for its answer. Why, and for how long it
 * won't be asked again, in the page's digits; the code's six digits left to
 * right, what's wrong said under them; then Cancel and Confirm, in the form.
 */
export function StepUpCodeDialog({ minutes, code, error, checking, field, onCode, onSubmit, onCancel }: {
    minutes: number
    code: string
    error: CodeError | null
    checking: boolean
    field?: Ref<HTMLInputElement>
    onCode: (value: string) => void
    onSubmit: (e: FormEvent<HTMLFormElement>) => void
    onCancel: () => void
}) {
    const { t, locale } = useLanguage()
    return (
        <Dialog open onClose={onCancel} title={t('step_up_title')} aboveAll>
            <form className="ui-form" noValidate onSubmit={onSubmit}>
                <p>{t('step_up_hint').replace('{minutes}', countOf(t, locale, minutes, 'minutes'))}</p>
                <Field label={t('step_up_code')} error={error ? t(ERROR_TEXT[error]) : undefined}>{p => (
                    // The one thing it asks for, so it takes the focus as it opens. Six digits at most by
                    // what's kept (codeDigits), not by the field: cut at six, "123 456" pasted lost its 6.
                    <TextInput {...p} ref={field} name="code" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} dir="ltr" autoFocus
                        value={code} onChange={e => onCode(e.target.value)} />
                )}</Field>
                <DialogActions>
                    <Button onClick={onCancel} disabled={checking}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={checking}>{t('step_up_confirm')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/** For an account without two-factor sign-in: the action needs it, with Cancel and the way to set it up. */
export function StepUpEnrolDialog({ onClose }: { onClose: () => void }) {
    const { t } = useLanguage()
    return (
        <Dialog open onClose={onClose} title={t('step_up_enrol_title')} aboveAll actions={<>
            <Button onClick={onClose}>{t('cancel')}</Button>
            <ButtonLink variant="primary" href="/dashboard/security-settings" onClick={onClose}>{t('step_up_enrol_go')}</ButtonLink>
        </>}>
            <p>{t('step_up_enrol_hint')}</p>
        </Dialog>
    )
}
