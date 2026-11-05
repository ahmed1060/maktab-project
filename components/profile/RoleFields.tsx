'use client'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'
import { Field, Select, TextInput, type SelectOption } from '@/components/ui'
import { roleLabel, type RoleNamed } from '@/lib/role-label'
import type { TranslationKey } from '@/lib/translations'
import type { AssignableRole } from '@/lib/useAssignableRoles'

/**
 * A person's role, in their profile's form (a person's profile, part 4, PR
 * 194): the roles to pick from, as the server would let them be given
 * (lib/useAssignableRoles.ts), and once another is picked, until when, for an
 * acting one (ROLES_PLAN.md §6.13). Whoever may only ask for a role picks one
 * too, and the profile's save sends it for approval (§6.12). A role that
 * isn't changed here is off, and its hint says why. It was a select of its
 * own making with a button of its own beside it, to ask, and its date and
 * notes were styled by hand.
 */

/** The role they hold. */
export type HeldRole = RoleNamed & { id: string }
/** A change of their role, waiting for approval. */
export type WaitingRole = { id: string; role: RoleNamed }

/** Theirs first, where it isn't one the viewer may give, then the ones the viewer may. */
export function roleOptions(roles: AssignableRole[], current: HeldRole | null, t: (key: TranslationKey) => string): SelectOption[] {
    const theirs = current && !roles.some(r => r.id === current.id) ? [{ value: current.id, label: roleLabel(current, t) }] : []
    return [...theirs, ...roles.map(r => ({ value: r.id, label: roleLabel(r, t) }))]
}

/** A change waiting, linked to where it's decided: its row on the Requests page. */
export function RoleWaiting({ request }: { request: WaitingRole }) {
    const { t } = useLanguage()
    const [before, after] = t('role_requests_pending_for').split('{role}')
    return <Link href={`/dashboard/requests?kind=role&highlight=${encodeURIComponent(request.id)}`}>{before}<bdi>{roleLabel(request.role, t)}</bdi>{after}</Link>
}

export function RoleFields({ how, superAdmin, roles, current, value, onChange, actingUntil, onActingUntil, actingFrom, acting, waiting, blocked = false, errors, busy }: {
    /** As the profile may change it (lib/profile-access.ts): given, asked for, or neither, when it's off. */
    how: 'assign' | 'ask' | null
    /** A Super Admin's, which isn't changed here. */
    superAdmin: boolean
    roles: AssignableRole[]
    current: HeldRole | null
    /** The role picked: theirs, until another is. */
    value: string
    onChange: (roleId: string, chosen: AssignableRole | null) => void
    actingUntil: string
    onActingUntil: (date: string) => void
    /** The first day an acting role may end on: tomorrow. */
    actingFrom: string
    /** Until when they're acting in the role they hold, worded as their details say it. */
    acting: string | null
    /** A change asked for, waiting: nothing more is asked meanwhile. */
    waiting: WaitingRole | null
    /**
     * Told by the server a change already waits, though it isn't one the
     * viewer is shown: whoever may only ask sees their own requests alone.
     */
    blocked?: boolean
    errors: { roleId?: string; actingUntil?: string }
    busy: boolean
}) {
    const { t } = useLanguage()
    if (superAdmin) {
        return (
            <Field label={t('role_label')} hint={t('profile_role_super_admin')}>{p => (
                <TextInput {...p} value={t('role_super_admin')} disabled />
            )}</Field>
        )
    }
    const changing = !!how && !waiting && !blocked && !!value && value !== current?.id
    // Why it's off, or what picking another means, which its date then says
    // for one given; otherwise until when they're acting in theirs.
    const hint = !how ? t('profile_role_admin')
        : waiting ? <RoleWaiting request={waiting} />
        : blocked ? t('profile_role_already_asked')
        : changing ? (how === 'ask' ? t('profile_role_will_ask') : null)
        : acting
    return (
        <>
            <Field label={t('role_label')} hint={hint} error={errors.roleId}>{p => (
                <Select {...p} name="roleId" value={waiting || blocked ? current?.id ?? '' : value} disabled={busy || !how || !!waiting || blocked}
                    options={roleOptions(roles, current, t)}
                    onChange={e => onChange(e.target.value, roles.find(r => r.id === e.target.value) ?? null)} />
            )}</Field>
            {changing && (
                <Field label={t('acting_until_label')} hint={t('acting_until_hint')} error={errors.actingUntil}>{p => (
                    <TextInput {...p} name="actingUntil" type="date" autoComplete="off" min={actingFrom} value={actingUntil} disabled={busy}
                        onChange={e => onActingUntil(e.target.value)} />
                )}</Field>
            )}
        </>
    )
}
