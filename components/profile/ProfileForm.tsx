'use client'
import type { FormEvent, ReactNode } from 'react'
import { useLanguage } from '@/context/LanguageContext'
import { Button, ButtonLink, Choice, Field, PasswordInput, Select, TextInput } from '@/components/ui'
import { NAME_MAX, PASSWORD_MAX } from '@/lib/new-employee-form'
import { STATUS_WORD } from '@/lib/person-status'
import type { ProfileAccess } from '@/lib/profile-access'
import type { ProfileField } from '@/lib/profile-form'

/**
 * A person's profile, to edit, on the building blocks (a person's profile,
 * part 3, PR 193): its fields one under the other, each label above its
 * field and what's wrong under it (DESIGN.md §5.3). A field that can't be
 * changed is off, and its hint says why. It was fields of their own making,
 * each side chosen by hand for each language, with a password eye drawn by
 * hand, and their mistakes said in a toast.
 *
 * What's typed is the profile's, which sends it (../EmployeeProfileForm.tsx).
 */

export type ProfileValues = {
    firstName: string
    lastName: string
    gender: string
    email: string
    username: string
    salary: string
    dayOffCredit: string
    password: string
    status: string
    teamLeaderId: string
}

/** The statuses an edit may set; ending a contract is its own (the view's End contract). */
const SETTABLE = ['ACTIVE', 'SUSPENDED', 'OFFLINE'] as const

export function ProfileForm({ values, set, errors, error, access, company, ownTeamLeader, leaders, busy, role, onSubmit, cancelHref }: {
    values: ProfileValues
    set: (field: keyof ProfileValues, value: string) => void
    errors: Partial<Record<ProfileField, string>>
    /** What's wrong with no field to say it under. */
    error: string | null
    access: ProfileAccess
    /** Their company's name, where it's shown. */
    company: string | null
    /** One's own team leader's name, on one's own profile. */
    ownTeamLeader: string | null
    leaders: { id: string; name: string }[]
    busy: boolean
    /** The role, where it's chosen: its own part, until it's on the building blocks too. */
    role?: ReactNode
    onSubmit: (e: FormEvent) => void
    /** Where Cancel goes, a link, as every page form's is: their details. */
    cancelHref: string
}) {
    const { t, locale } = useLanguage()
    const digits = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    // How much of a name it takes, as it stops at the server's limit (as Add employee's).
    const used = (n: number) => t('ui_characters_used').replace('{used}', digits(n)).replace('{max}', digits(NAME_MAX))
    // Why it's off: one's own is the company's to set; someone else's, a role's that may only see it.
    const locked = access.own ? t('profile_set_by_company') : t('profile_view_only')
    const archived = values.status === 'ARCHIVED'

    return (
        <form className="ui-form" noValidate onSubmit={onSubmit}>
            {access.nameByRequest && <p className="ui-hint">{t('profile_name_by_request')}</p>}
            <Field label={t('first_name_label')} hint={used(values.firstName.length)} error={errors.firstName}>{p => (
                <TextInput {...p} name="firstName" autoComplete={access.own ? 'given-name' : 'off'} dir="auto" maxLength={NAME_MAX} value={values.firstName} disabled={busy}
                    onChange={e => set('firstName', e.target.value)} />
            )}</Field>
            <Field label={t('last_name_label')} hint={used(values.lastName.length)} error={errors.lastName}>{p => (
                <TextInput {...p} name="lastName" autoComplete={access.own ? 'family-name' : 'off'} dir="auto" maxLength={NAME_MAX} value={values.lastName} disabled={busy}
                    onChange={e => set('lastName', e.target.value)} />
            )}</Field>
            <Choice legend={t('gender_label')} name="gender" value={values.gender} onChange={v => set('gender', v)}
                options={[{ value: 'MALE', label: t('male'), disabled: busy }, { value: 'FEMALE', label: t('female'), disabled: busy }]} />

            {access.company && (
                // Shown, never changed: the server refuses any other (COMPANY_CHANGE_FORBIDDEN).
                <Field label={t('company_label')} hint={t('profile_company_stays')}>{p => (
                    <TextInput {...p} name="company" value={company ?? ''} disabled />
                )}</Field>
            )}

            <Field label={t('email')} hint={access.changeEmail ? undefined : t('profile_email_own')} error={errors.email}>{p => (
                <TextInput {...p} name="email" type="email" autoComplete="off" spellCheck={false} dir="ltr" value={values.email} disabled={busy || !access.changeEmail}
                    onChange={e => set('email', e.target.value)} />
            )}</Field>
            <Field label={t('username_label')} hint={access.changeUsername ? undefined : t('profile_username_locked')} error={errors.username}>{p => (
                <TextInput {...p} name="username" dir="ltr" spellCheck={false} autoCapitalize="none" autoComplete="off" translate="no" value={values.username} disabled={busy || !access.changeUsername}
                    onChange={e => set('username', e.target.value)} />
            )}</Field>

            {access.salary && (
                <Field label={t('monthly_base_salary_label')} hint={access.changeSalary ? undefined : locked} error={errors.salary}>{p => (
                    <TextInput {...p} name="salary" type="number" inputMode="decimal" min={0} autoComplete="off" value={values.salary} disabled={busy || !access.changeSalary}
                        onChange={e => set('salary', e.target.value)} />
                )}</Field>
            )}
            {access.dayOffCredit && (
                <Field label={t('day_off_credit_assigned')} hint={access.changeDayOffCredit ? undefined : locked} error={errors.dayOffCredit}>{p => (
                    <TextInput {...p} name="dayOffCredit" type="number" inputMode="decimal" min={0} step={0.5} autoComplete="off" value={values.dayOffCredit} disabled={busy || !access.changeDayOffCredit}
                        onChange={e => set('dayOffCredit', e.target.value)} />
                )}</Field>
            )}

            {access.changePassword && (
                <Field label={t('new_password_optional_label')} hint={t('profile_new_password_hint')} error={errors.password}>{p => (
                    <PasswordInput {...p} name="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={values.password} disabled={busy}
                        onChange={e => set('password', e.target.value)} />
                )}</Field>
            )}

            {role}

            {access.ownTeamLeader && (
                // Information, not a choice: who manages you shouldn't have to be asked.
                <Field label={t('team_leader_yours')} hint={ownTeamLeader ? t('profile_set_by_company') : t('team_leader_yours_none')}>{p => (
                    <TextInput {...p} name="ownTeamLeader" value={ownTeamLeader ?? ''} disabled />
                )}</Field>
            )}
            {access.teamLeader && (
                // Only an employee has a team leader, so it's gone rather than off for anyone else.
                <Field label={t('team_leader_label')} hint={t('team_leader_hint')}>{p => (
                    <Select {...p} name="teamLeaderId" value={values.teamLeaderId} disabled={busy}
                        options={[{ value: '', label: t('team_leader_none') }, ...leaders.map(l => ({ value: l.id, label: l.name }))]}
                        onChange={e => set('teamLeaderId', e.target.value)} />
                )}</Field>
            )}

            {access.status && (
                // An ended contract's stays as it is, as it was saved: the
                // view's Reinstate brings them back, with its own dialog.
                <Choice legend={t('status_label')} name="status" value={values.status} onChange={v => set('status', v)}
                    options={[
                        ...SETTABLE.map(s => ({ value: s, label: t(STATUS_WORD[s]), disabled: busy || archived })),
                        ...(archived ? [{ value: 'ARCHIVED', label: t('status_archived'), disabled: true }] : []),
                    ]}
                    warning={archived ? t('profile_status_archived') : undefined} />
            )}

            {error && <p className="ui-error" role="alert">{error}</p>}
            <div className="ui-form-actions">
                <Button type="submit" variant="primary" busy={busy}>{busy ? t('saving') : t('save')}</Button>
                <ButtonLink href={cancelHref} prefetch={false}>{t('cancel')}</ButtonLink>
            </div>
        </form>
    )
}
