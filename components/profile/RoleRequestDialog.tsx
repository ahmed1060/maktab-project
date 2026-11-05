'use client'
import { useRef, useState, type FormEvent } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { focusFirstWrong } from '@/components/attendance-calendar/focus'
import { Button, Dialog, DialogActions, Field, Select, TextInput } from '@/components/ui'
import { roleAskErrors } from '@/lib/profile-form'
import type { AssignableRole } from '@/lib/useAssignableRoles'
import { roleOptions, type HeldRole } from './RoleFields'

/** What's wrong with asking: under the role or its date, or above the buttons. */
export type AskRefusal = { field?: string; message: string }

/**
 * Asking for another role from someone's details (a person's profile, part
 * 4, PR 194), for whoever may ask for one but may not edit them, as HR may
 * (ROLES_PLAN.md §6.12): the building blocks' dialog, as a form, with the
 * role field the profile's form has and what's wrong under it. They keep
 * their role until an Admin approves the one asked for.
 *
 * onSend asks for it, and hands back what's wrong, or null once it's asked,
 * when the dialog's closed by whoever opened it. While it's sent, the dialog
 * stays: Cancel is off and Send request is busy.
 */
export function RoleRequestDialog({ name, roles, current, actingFrom, onCancel, onSend }: {
    name: string
    roles: AssignableRole[]
    current: HeldRole | null
    /** The first day an acting role may end on: tomorrow. */
    actingFrom: string
    onCancel: () => void
    onSend: (asked: { roleId: string; actingUntil: string }) => Promise<AskRefusal | null>
}) {
    const { t } = useLanguage()
    const form = useRef<HTMLFormElement>(null)
    // Theirs to start from: what's asked for is another.
    const [roleId, setRoleId] = useState(current?.id ?? '')
    const [actingUntil, setActingUntil] = useState('')
    const [errors, setErrors] = useState<{ roleId?: string; actingUntil?: string }>({})
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const changing = !!roleId && roleId !== current?.id
    const [before, after] = t('profile_role_ask_body').split('{name}')

    const cancel = () => { if (!busy) onCancel() }
    const submit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        if (busy) return
        setError(null)
        // A date not typed in full reads as empty, as though left empty.
        const date = e.currentTarget.elements.namedItem('actingUntil')
        const wrong = roleAskErrors({
            roleId, current: current?.id ?? '', actingFrom,
            actingUntil: changing ? actingUntil : '',
            unreadable: date instanceof HTMLInputElement && date.validity.badInput,
        })
        if (Object.keys(wrong).length > 0) {
            setErrors(Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key)])))
            focusFirstWrong(form.current)
            return
        }
        setBusy(true)
        try {
            const problem = await onSend({ roleId, actingUntil: changing ? actingUntil : '' })
            if (problem?.field === 'roleId' || problem?.field === 'actingUntil') {
                setErrors({ [problem.field]: problem.message })
                focusFirstWrong(form.current)
            } else if (problem) {
                setError(problem.message)
            }
        } finally {
            setBusy(false)
        }
    }

    return (
        <Dialog open onClose={cancel} title={t('profile_role_ask')}>
            <form ref={form} className="ui-form" noValidate onSubmit={submit}>
                <p>{before}<bdi>{name}</bdi>{after}</p>
                <Field label={t('role_label')} error={errors.roleId}>{p => (
                    <Select {...p} name="roleId" value={roleId} disabled={busy} options={roleOptions(roles, current, t)}
                        onChange={e => { setRoleId(e.target.value); setErrors({}) }} />
                )}</Field>
                {changing && (
                    <Field label={t('acting_until_label')} hint={t('acting_until_hint')} error={errors.actingUntil}>{p => (
                        <TextInput {...p} name="actingUntil" type="date" min={actingFrom} value={actingUntil} disabled={busy}
                            onChange={e => { setActingUntil(e.target.value); setErrors(was => ({ ...was, actingUntil: undefined })) }} />
                    )}</Field>
                )}
                {error && <p className="ui-error" role="alert">{error}</p>}
                <DialogActions>
                    <Button onClick={cancel} disabled={busy}>{t('cancel')}</Button>
                    <Button type="submit" variant="primary" busy={busy}>{t('profile_role_ask_send')}</Button>
                </DialogActions>
            </form>
        </Dialog>
    )
}
