'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useRef, useState, type FormEvent } from 'react'
import { refusalOf } from '@/components/CompanyRolesCard'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Choice, Dialog, DialogActions, Field, PasswordInput, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useViewer } from '@/lib/useCan'
import type { TranslationKey } from '@/lib/translations'

/**
 * Adding a Super Admin, and changing one's name and gender (the Super Admin's
 * pages part 2b, UI_PLAN.md §5 step 5): the building blocks' dialog, each
 * field labelled, what's wrong said under its field on Add or Save. Each
 * stays open, its button busy, until the server has answered.
 */

export type SuperAdmin = { id: string; firstName: string; lastName: string; email: string; gender?: string; isProtected?: boolean }
type Gender = 'MALE' | 'FEMALE'
type NewAdmin = { firstName: string; lastName: string; email: string; password: string }
type Wrong = Partial<Record<keyof NewAdmin, TranslationKey>>

// The server's own check is stricter; this catches what's plainly not an
// address before it's sent, and the server's answer is said under the field.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What's wrong with a name, on Add and on Save. */
function nameErrors(firstName: string, lastName: string): Pick<Wrong, 'firstName' | 'lastName'> {
    const wrong: Pick<Wrong, 'firstName' | 'lastName'> = {}
    if (!firstName.trim()) wrong.firstName = 'super_admins_first_name_required'
    if (!lastName.trim()) wrong.lastName = 'super_admins_last_name_required'
    return wrong
}

/** What's wrong with a new Super Admin on Add, field by field; empty when it'll do. The server wants 12 to 72 characters. */
export function addErrors(a: NewAdmin): Wrong {
    const wrong: Wrong = nameErrors(a.firstName, a.lastName)
    if (!EMAIL.test(a.email.trim())) wrong.email = 'super_admins_email_invalid'
    if (a.password.length < 12) wrong.password = 'super_admins_password_short'
    return wrong
}

/**
 * What your session should now say, when the one saved is you: the top bar
 * reads your name from it, and kept the old one until you signed in again
 * (audit on part 2b). Null for anyone else.
 */
export function ownSessionChange<T extends { firstName: string; lastName: string; gender: Gender }>(adminId: string, viewerId: string | undefined, sent: T): T | null {
    return adminId === viewerId ? sent : null
}

function useGenders() {
    const { t } = useLanguage()
    return [{ value: 'MALE' as const, label: t('male') }, { value: 'FEMALE' as const, label: t('female') }]
}

export function AddSuperAdminDialog({ onClose, onAdded }: { onClose: () => void; onAdded: (name: string) => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const genders = useGenders()
    const formRef = useRef<HTMLFormElement>(null)
    const [admin, setAdmin] = useState<NewAdmin>({ firstName: '', lastName: '', email: '', password: '' })
    const [gender, setGender] = useState<Gender>('MALE')
    const [wrong, setWrong] = useState<Wrong>({})
    const [busy, setBusy] = useState(false)
    const change = (key: keyof NewAdmin, value: string) => {
        setAdmin(a => ({ ...a, [key]: value }))
        setWrong(w => ({ ...w, [key]: undefined }))
    }

    const add = async (e: FormEvent) => {
        e.preventDefault()
        const found = addErrors(admin)
        setWrong(found)
        if (Object.keys(found).length > 0) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            const sent = { firstName: admin.firstName.trim(), lastName: admin.lastName.trim(), email: admin.email.trim(), password: admin.password, gender }
            const res = await fetch('/api/super-admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent) })
            if (!res.ok) {
                const body = await res.clone().json().catch(() => ({}))
                // The two the server can say about one field, said under it.
                const email: TranslationKey | null = body?.error === 'Email already exists' ? 'super_admins_email_taken' : body?.details?.email ? 'super_admins_email_invalid' : null
                if (email) {
                    setWrong({ email })
                    focusFirstWrong(formRef.current)
                } else {
                    showToast(await refusalOf(res, t('error_generic')), 'error')
                }
                return
            }
            onAdded(`${sent.firstName} ${sent.lastName}`)
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('super_admins_add')}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={add}>
                <Field label={t('super_admins_first_name')} error={wrong.firstName && t(wrong.firstName)}>{p => (
                    <TextInput {...p} name="firstName" autoComplete="off" value={admin.firstName} onChange={e => change('firstName', e.target.value)} />
                )}</Field>
                <Field label={t('super_admins_last_name')} error={wrong.lastName && t(wrong.lastName)}>{p => (
                    <TextInput {...p} name="lastName" autoComplete="off" value={admin.lastName} onChange={e => change('lastName', e.target.value)} />
                )}</Field>
                <Field label={t('email')} error={wrong.email && t(wrong.email)}>{p => (
                    <TextInput {...p} type="email" name="email" autoComplete="off" spellCheck={false} value={admin.email} onChange={e => change('email', e.target.value)} />
                )}</Field>
                <Field label={t('password')} hint={t('super_admins_password_hint')} error={wrong.password && t(wrong.password)}>{p => (
                    <PasswordInput {...p} name="password" autoComplete="new-password" maxLength={72} value={admin.password} onChange={e => change('password', e.target.value)} />
                )}</Field>
                <Choice legend={t('super_admins_gender')} name="gender" value={gender} onChange={setGender} options={genders} />
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('super_admins_add_submit')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}

/**
 * A Super Admin's name and gender. Their email isn't changed here: your own
 * is changed in Security settings, where the new one is confirmed, and
 * someone else's only by them.
 */
export function EditSuperAdminDialog({ admin, onClose, onSaved }: { admin: SuperAdmin; onClose: () => void; onSaved: (name: string) => void }) {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const viewer = useViewer()
    const { update } = useSession()
    const genders = useGenders()
    const formRef = useRef<HTMLFormElement>(null)
    const [firstName, setFirstName] = useState(admin.firstName)
    const [lastName, setLastName] = useState(admin.lastName)
    const [gender, setGender] = useState<Gender>(admin.gender === 'FEMALE' ? 'FEMALE' : 'MALE')
    const [wrong, setWrong] = useState<Pick<Wrong, 'firstName' | 'lastName'>>({})
    const [busy, setBusy] = useState(false)
    const own = admin.id === viewer?.id
    const [before, after] = t('super_admins_email_own').split('{link}')

    const save = async (e: FormEvent) => {
        e.preventDefault()
        const found = nameErrors(firstName, lastName)
        setWrong(found)
        if (Object.keys(found).length > 0) { focusFirstWrong(formRef.current); return }
        setBusy(true)
        try {
            const sent = { firstName: firstName.trim(), lastName: lastName.trim(), gender }
            const res = await fetch(`/api/super-admins/${admin.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sent) })
            if (!res.ok) {
                showToast(await refusalOf(res, t('error_generic')), 'error')
                return
            }
            const change = ownSessionChange(admin.id, viewer?.id, sent)
            if (change) await update(change)
            onSaved(`${sent.firstName} ${sent.lastName}`)
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={() => { if (!busy) onClose() }} title={t('super_admins_edit_title').replace('{name}', `${admin.firstName} ${admin.lastName}`)}>
            <form ref={formRef} className="ui-form" noValidate onSubmit={save}>
                <Field label={t('super_admins_first_name')} error={wrong.firstName && t(wrong.firstName)}>{p => (
                    <TextInput {...p} name="firstName" autoComplete="off" value={firstName} onChange={e => { setFirstName(e.target.value); setWrong(w => ({ ...w, firstName: undefined })) }} />
                )}</Field>
                <Field label={t('super_admins_last_name')} error={wrong.lastName && t(wrong.lastName)}>{p => (
                    <TextInput {...p} name="lastName" autoComplete="off" value={lastName} onChange={e => { setLastName(e.target.value); setWrong(w => ({ ...w, lastName: undefined })) }} />
                )}</Field>
                <Field label={t('email')} hint={own ? <>{before}<Link href="/dashboard/security-settings">{t('security_settings_nav')}</Link>{after}</> : t('super_admins_email_theirs')}>{p => (
                    <TextInput {...p} type="email" name="email" value={admin.email} disabled />
                )}</Field>
                <Choice legend={t('super_admins_gender')} name="gender" value={gender} onChange={setGender} options={genders} />
                <DialogActions>
                    <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('save')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
