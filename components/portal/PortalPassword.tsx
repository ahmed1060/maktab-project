'use client'

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Field, Page, PageHeader, PasswordInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { firstError } from '@/lib/form-errors'
import { PASSWORD_MAX } from '@/lib/new-password-form'
import { PORTAL_PASSWORD_FIELDS, portalPasswordErrors, portalPasswordRefusal, type PortalPasswordField } from '@/lib/portal-password-form'

/**
 * Change password in the client's area (CLIENT_PORTAL_PLAN.md §5.3, §12 step
 * 7d-2; PR 335), from its account menu, as the company's people's Change
 * password is (app/(dashboard)/dashboard/change-password): the page header
 * names it, under a way back to Tax position, and its form is one card, each
 * mistake under its field and the first one wrong focused. It asks for the
 * current password first, which the server checks, then the new one twice.
 * Saved, it goes back to Tax position, saying so; the account's other
 * sessions end within a minute, and this one stays.
 */
export function PortalPassword() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const router = useRouter()

    const [typed, setTyped] = useState<Record<PortalPasswordField, string>>({ currentPassword: '', newPassword: '', confirmPassword: '' })
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<PortalPasswordField, string>>>({})
    const [error, setError] = useState('')
    const [saving, setSaving] = useState(false)
    const [focusOn, setFocusOn] = useState<{ field: PortalPasswordField; n: number } | null>(null)

    // Once the fields can take it again: a disabled field can't be focused.
    useEffect(() => {
        if (!focusOn || saving) return
        document.querySelector<HTMLElement>(`[name="${focusOn.field}"]`)?.focus()
    }, [focusOn, saving])

    const focus = (field: PortalPasswordField) => setFocusOn(f => ({ field, n: (f?.n ?? 0) + 1 }))
    const type = (field: PortalPasswordField) => (e: ChangeEvent<HTMLInputElement>) => {
        setTyped({ ...typed, [field]: e.target.value })
        if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: undefined })
    }

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault()
        setError('')
        const wrong = portalPasswordErrors(typed)
        if (Object.keys(wrong).length > 0) {
            const errors = Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key)]))
            setFieldErrors(errors)
            const first = firstError(errors, PORTAL_PASSWORD_FIELDS) as PortalPasswordField | null
            if (first) focus(first)
            return
        }
        setFieldErrors({})
        setSaving(true)
        try {
            const res = await fetch('/api/portal/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(typed),
            })
            if (!res.ok) {
                // The server's answers are in English, with codes the page says in the reader's language.
                const refused = portalPasswordRefusal(await res.json().catch(() => null))
                if (refused.field) {
                    setFieldErrors({ [refused.field]: t(refused.key) })
                    focus(refused.field)
                } else {
                    setError(t(refused.key))
                }
                setSaving(false)
                return
            }
            showToast(t('change_password_done'), 'success')
            // Still busy meanwhile, so it isn't sent twice.
            router.push('/portal')
        } catch {
            setError(t('change_password_failed'))
            setSaving(false)
        }
    }

    return (
        <Page>
            <PageHeader back={{ href: '/portal', label: t('tax_position') }} title={t('portal_password_title')} subtitle={t('portal_password_subtitle')} />
            <Card>
                <form onSubmit={handleSubmit} noValidate className="ui-form">
                    <Field label={t('portal_password_current')} error={fieldErrors.currentPassword}>{p => (
                        // Not focused as the page opens, so a phone's keyboard
                        // doesn't come up over it (the owner's answer, PR 341).
                        <PasswordInput {...p} name="currentPassword" autoComplete="current-password" value={typed.currentPassword} disabled={saving}
                            onChange={type('currentPassword')} />
                    )}</Field>
                    <Field label={t('change_password_new')} hint={t('change_password_new_hint')} error={fieldErrors.newPassword}>{p => (
                        <PasswordInput {...p} name="newPassword" autoComplete="new-password" maxLength={PASSWORD_MAX} value={typed.newPassword} disabled={saving}
                            onChange={type('newPassword')} />
                    )}</Field>
                    <Field label={t('change_password_confirm')} error={fieldErrors.confirmPassword}>{p => (
                        <PasswordInput {...p} name="confirmPassword" autoComplete="new-password" maxLength={PASSWORD_MAX} value={typed.confirmPassword} disabled={saving}
                            onChange={type('confirmPassword')} />
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
