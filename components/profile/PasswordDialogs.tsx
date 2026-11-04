'use client'
import { useRef, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { Button, Dialog, DialogActions, Field, PasswordInput } from '@/components/ui'

/**
 * Confirming with one's own password, before saving someone's profile or
 * resetting their password (a person's profile, part 2, PR 192): the building
 * blocks' dialog, as a form, with what's wrong under the field. It was a
 * window of its own making, with a hand-drawn lock and eye, that said a wrong
 * password in a toast.
 *
 * onConfirm checks the password and does what it was asked for. It hands back
 * what's wrong, to say under the field, or null once it's done, when the
 * dialog's closed by whoever opened it. While it's checked, the dialog stays:
 * Cancel is off and Confirm is busy. Told what's wrong, the focus is back in
 * the field: it's off while it's checked, so the focus went with it.
 */
export function ConfirmPasswordDialog({ open, onCancel, onConfirm }: {
    open: boolean
    onCancel: () => void
    onConfirm: (password: string) => Promise<string | null>
}) {
    const { t } = useLanguage()
    const [password, setPassword] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const form = useRef<HTMLFormElement>(null)
    // Each time it opens, from nothing: a password typed is never kept.
    useAdjustOnChange([open], () => { setPassword(''); setError(null); setBusy(false) })

    const cancel = () => { if (!busy) onCancel() }
    const submit = async (e: FormEvent) => {
        e.preventDefault()
        if (busy) return
        if (!password) {
            setError(t('profile_verify_empty'))
            focusFirstWrong(form.current)
            return
        }
        setBusy(true)
        try {
            const problem = await onConfirm(password)
            if (problem) { setError(problem); focusFirstWrong(form.current) }
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open={open} onClose={cancel} title={t('profile_verify_title')}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <p>{t('profile_verify_body')}</p>
                <Field label={t('profile_verify_password')} error={error}>{p => (
                    <PasswordInput {...p} name="password" autoComplete="current-password" autoFocus value={password} disabled={busy}
                        onChange={e => { setPassword(e.target.value); setError(null) }} />
                )}</Field>
                <DialogActions>
                    <Button onClick={cancel} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('confirm')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * A temporary password, once it's issued: shown this once, to be handed to
 * the person, as an attendance agent's code is (company settings part 3c).
 * It's never kept, or asked for again: closed, it's gone.
 */
export function TemporaryPasswordDialog({ name, password, onClose }: { name: string; password: string | null; onClose: () => void }) {
    const { t } = useLanguage()
    const [before, after] = t('profile_temp_password_title').split('{name}')
    return (
        <Dialog
            open={!!password}
            onClose={onClose}
            title={<>{before}<bdi>{name}</bdi>{after}</>}
            actions={<Button variant="primary" onClick={onClose}>{t('done')}</Button>}
        >
            <p>{t('profile_temp_password_hint')}</p>
            {/* Typed as shown: left to right, and never translated by the page. */}
            <p className="ui-code ui-code-long" dir="ltr" translate="no">{password}</p>
            <p className="ui-hint">{t('profile_temp_password_once')}</p>
        </Dialog>
    )
}
