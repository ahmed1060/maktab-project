'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Field, Page, PageHeader, PasswordInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { apiErrorText } from '@/lib/api-error-text'
import { firstError } from '@/lib/form-errors'
import { NEW_PASSWORD_FIELDS, PASSWORD_MAX, newPasswordErrors, type NewPasswordField } from '@/lib/new-password-form'
import { ownPasswordRefusal } from '@/lib/profile-password'
import { refreshSession } from '@/lib/refresh-session'
import { useViewer } from '@/lib/useCan'

/**
 * Shown when an admin has issued a one-time temporary password for this
 * account (F-02, replaces the old password-reveal feature). Middleware
 * redirects here and blocks the rest of the dashboard until the password
 * is changed.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, the pages left), as Add
 * employee is: the page header names it, and its form is one card, each
 * mistake under its field and the first one wrong focused. It was a card of
 * its own making, its sides chosen by hand for each language, its words typed
 * into the page in both languages and its mistakes said as toasts.
 */
export default function ChangePasswordPage() {
    const { t } = useLanguage()
    // Whose password it is, from the layout on the first paint: the session
    // hook's own copy is still loading then, and a quick Save sent no id.
    const viewer = useViewer()
    const { showToast } = useToast()

    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<NewPasswordField, string>>>({})
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)
    const [focusOn, setFocusOn] = useState<{ field: NewPasswordField; n: number } | null>(null)

    useEffect(() => {
        if (!focusOn || saving) return
        document.querySelector<HTMLElement>(`[name="${focusOn.field}"]`)?.focus()
    }, [focusOn, saving])

    const clear = (field: NewPasswordField) => { if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: undefined }) }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')
        const wrong = newPasswordErrors({ newPassword, confirmPassword })
        if (Object.keys(wrong).length > 0) {
            const errors = Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key)]))
            setFieldErrors(errors)
            const first = firstError(errors, NEW_PASSWORD_FIELDS) as NewPasswordField | null
            if (first) setFocusOn(f => ({ field: first, n: (f?.n ?? 0) + 1 }))
            return
        }
        setFieldErrors({})
        setSaving(true)
        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: viewer?.id, password: newPassword }),
            })
            if (!res.ok) {
                // A session the temporary password ended is asked for it by
                // the server (PR 229), whose answer is in English.
                const text = await res.text()
                let answer: { code?: string } | null = null
                try { answer = JSON.parse(text) } catch { /* not JSON: said as it came */ }
                const refused = ownPasswordRefusal(answer)
                setError(refused ? t(refused) : apiErrorText(text, t('change_password_failed')))
                setSaving(false)
                return
            }
            // The session is written again, the flag cleared from the
            // account, so the gate stops sending the browser here. Not by the
            // session hook's update, which does nothing until the page has
            // loaded its session: pressed before, the page came back though
            // the password had been changed (PR 228).
            await refreshSession({ mustChangePassword: false })
            showToast(t('change_password_done'), 'success')
            // Loaded afresh rather than moved to within the app. Signing in
            // went to the dashboard, which was turned to this page, and the
            // app kept that answer: moving to the dashboard again came
            // straight back here, asking the server nothing (browser flows,
            // PR 187). Loaded afresh, the gate and the layout read the new
            // session. Still busy meanwhile, so it isn't sent twice.
            window.location.replace('/dashboard')
        } catch {
            setError(t('change_password_failed'))
            setSaving(false)
        }
    }

    return (
        <Page>
            <PageHeader title={t('change_password_title')} subtitle={t('change_password_subtitle')} />
            <Card>
                <form onSubmit={handleSubmit} noValidate className="ui-form">
                    <Field label={t('change_password_new')} hint={t('change_password_new_hint')} error={fieldErrors.newPassword}>{p => (
                        // Focused: it's the one thing this page asks for.
                        <PasswordInput {...p} name="newPassword" autoComplete="new-password" maxLength={PASSWORD_MAX} autoFocus value={newPassword} disabled={saving}
                            onChange={e => { setNewPassword(e.target.value); clear('newPassword') }} />
                    )}</Field>
                    <Field label={t('change_password_confirm')} error={fieldErrors.confirmPassword}>{p => (
                        <PasswordInput {...p} name="confirmPassword" autoComplete="new-password" maxLength={PASSWORD_MAX} value={confirmPassword} disabled={saving}
                            onChange={e => { setConfirmPassword(e.target.value); clear('confirmPassword') }} />
                    )}</Field>

                    {error && <p className="ui-error" role="alert">{error}</p>}
                    <div className="ui-form-actions">
                        <Button type="submit" variant="primary" busy={saving}>{t('change_password_save')}</Button>
                    </div>
                </form>
            </Card>
        </Page>
    )
}
