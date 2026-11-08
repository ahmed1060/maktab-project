'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import useSWR from 'swr'
import { UserPlusIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import { useAssignableRoles, type AssignableRole } from '@/lib/useAssignableRoles'
import { Button, ButtonLink, Card, Field, Page, PageHeader, PasswordInput, Select, TextInput } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { apiErrorText } from '@/lib/api-error-text'
import { firstError } from '@/lib/form-errors'
import { FIELDS, NAME_MAX, PASSWORD_MAX, newEmployeeErrors, refusedField, type NewEmployeeField } from '@/lib/new-employee-form'
import { roleLabel } from '@/lib/role-label'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { useFeatures } from '@/lib/features/useFeatures'
import { useModules } from '@/lib/useModules'

type Company = { id: string; name: string }
type Leader = { id: string; firstName: string; lastName: string }

export const dynamic = 'force-dynamic'

/**
 * Add employee (UI_PLAN.md §5 step 5, the pages left), on the building
 * blocks: the page header with a way back to the list, and one card with
 * each field's label above it and what's wrong below it, the first one
 * wrong focused. It was a card of its own making, its sides chosen by hand
 * for each language, its mistakes in English whatever the language, and its
 * password eye drawn by hand.
 */
export default function NewEmployeePage() {
    const { t, locale } = useLanguage()
    const modules = useModules()
    // How much of a name it takes, as it stops at the server's limit (web interface audit, PR 180).
    const used = (n: number) => t('ui_characters_used').replace('{used}', n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')).replace('{max}', NAME_MAX.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB'))
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('EMPLOYEE')
    // Empty: the company's default role (ROLES_PLAN.md §6.4). `role` is the
    // chosen role's kind, which decides whether there is a team to join.
    const [roleId, setRoleId] = useState('')
    const [companyId, setCompanyId] = useState('')
    const [salary, setSalary] = useState('')
    const [dayOffCredit, setDayOffCredit] = useState('0')
    const [teamLeaderId, setTeamLeaderId] = useState('')
    // Which the role picked has: pay for anyone but an Admin, a day off
    // balance for an employee or a team leader. Checked and sent only then,
    // and only where the company's package includes them: pay is Payroll's,
    // a day off balance Day off's (DESIGN.md §5.5, Page layout).
    const features = useFeatures()
    const salaryShown = features.has('PAYROLL') && !['ADMIN', 'SUPER_ADMIN'].includes(role) && role !== ''
    const dayOffShown = features.has('DAY_OFF') && (role === 'EMPLOYEE' || role === 'TEAM_LEADER')
    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<NewEmployeeField, string>>>({})
    const [loading, setLoading] = useState(false)
    // The field to focus, once the form can be used again: its fields are off
    // while it's sent, and a refused email focused then took the focus nowhere.
    // Numbered, so the same field asked for again is focused again.
    const [focusOn, setFocusOn] = useState<{ field: NewEmployeeField; n: number } | null>(null)
    const router = useRouter()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const isSuperAdmin = userRole === 'SUPER_ADMIN'
    const { can } = useCan()
    // Adding people is theirs who may (the list offers the button only to
    // them); anyone reaching this address by hand is told so, and nothing is asked.
    const mayCreate = can('employees.create')
    const canAssignTeam = can('employees.assign_team')
    const canAssignRole = can('employees.assign_role')
    // Somebody who may only ask for a role — HR — picks one too; the account
    // starts on the default and the pick goes to an Admin (ROLES_PLAN.md §6.12).
    const canRequestRole = !canAssignRole && can('employees.request_role')

    // Asked for by role rather than fetched wholesale and filtered here, and
    // said when they didn't come, where a failure left the list empty.
    const companies = useSWR<{ data: { data: Company[] } }>(mayCreate && isSuperAdmin ? '/api/companies?limit=1000' : null, fetcher)
    const leaders = useSWR<{ data: { data: Leader[] } }>(mayCreate && canAssignTeam ? '/api/users?role=TEAM_LEADER&limit=1000' : null, fetcher)

    // Reloading or closing the tab with something typed asks first, as it
    // would lose it; not once it's being sent.
    const started = !!(firstName || lastName || email || password || salary || dayOffCredit !== '0' || roleId || companyId || teamLeaderId)
    useEffect(() => {
        if (!started || loading) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [started, loading])

    useEffect(() => {
        if (!focusOn || loading) return
        // The first field that's wrong takes the focus, which brings it into view.
        document.querySelector<HTMLElement>(`[name="${focusOn.field}"]`)?.focus()
    }, [focusOn, loading])

    if (!mayCreate) return <AccessDenied />

    const clear = (field: NewEmployeeField) => { if (fieldErrors[field]) setFieldErrors({ ...fieldErrors, [field]: undefined }) }
    const wrongAt = (errors: Partial<Record<NewEmployeeField, string>>) => {
        setFieldErrors(errors)
        const first = firstError(errors as Record<string, string>, FIELDS) as NewEmployeeField | null
        if (first) setFocusOn(f => ({ field: first, n: (f?.n ?? 0) + 1 }))
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setError('')
        setFocusOn(null)
        // In a number field, what the browser can't read ("1e", "-") reads as
        // empty, as though left empty, which was saved as 0: it's asked of the
        // fields themselves, as the form doesn't let the browser check them.
        const form = e.currentTarget
        const unreadable = (['salary', 'dayOffCredit'] as const).filter(name => {
            const field = form.elements.namedItem(name)
            return field instanceof HTMLInputElement && field.validity.badInput
        })
        const wrong = newEmployeeErrors({
            firstName, lastName, email, password, company: { needed: isSuperAdmin, id: companyId },
            salary: { shown: salaryShown, text: salary }, dayOffCredit: { shown: dayOffShown, text: dayOffCredit }, unreadable,
        })
        if (Object.keys(wrong).length > 0) {
            wrongAt(Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key)])))
            return
        }
        setFieldErrors({})
        setLoading(true)

        try {
            const body: Record<string, unknown> = { firstName: firstName.trim(), lastName: lastName.trim(), email: email.trim(), password, role: roleId ? role : 'EMPLOYEE', ...(roleId ? { roleId } : {}) }
            if (isSuperAdmin && companyId) {
                body.companyId = companyId
            }
            if (salaryShown && salary) {
                body.salary = parseFloat(salary)
            }
            // Only an employee has one. Sending it for any other role would be
            // refused by the server, which is correct but a pointless round
            // trip and a confusing message for something the form allowed.
            if (role === 'EMPLOYEE' && teamLeaderId) {
                body.teamLeaderId = teamLeaderId
            }

            const res = await fetch('/api/users', {
                method: 'POST',
                body: JSON.stringify({ ...body, ...(dayOffShown ? { dayOffCredit: parseFloat(dayOffCredit) || 0 } : {}) }),
                headers: { 'Content-Type': 'application/json' },
            })

            if (!res.ok) {
                const text = await res.text()
                let answer: { error?: string; details?: Record<string, unknown> } | null = null
                try { answer = JSON.parse(text) } catch { /* not JSON: said as it came */ }
                // Under the field it's about, where it can be; above the buttons otherwise.
                const refused = refusedField(answer)
                if (refused) wrongAt({ [refused.field]: t(refused.key) })
                else setError(apiErrorText(text, t('error_generic')))
                setLoading(false)
                return
            }

            router.push('/dashboard/employees')
            router.refresh()
        } catch {
            setError(t('error_generic'))
            setLoading(false)
        }
    }

    const companyList = companies.data?.data?.data ?? []
    const leaderList = leaders.data?.data?.data ?? []

    return (
        <Page>
            <PageHeader title={isSuperAdmin ? t('add_new_user_title') : t('add_employee')} back={{ href: '/dashboard/employees', label: modules.label('employees') }} />

            <Card>
                <form onSubmit={handleSubmit} noValidate className="ui-form">
                    <Field label={t('first_name_label')} hint={used(firstName.length)} error={fieldErrors.firstName}>{p => (
                        <TextInput {...p} name="firstName" autoComplete="off" dir="auto" maxLength={NAME_MAX} value={firstName} disabled={loading}
                            onChange={e => { setFirstName(e.target.value); clear('firstName') }} />
                    )}</Field>
                    <Field label={t('last_name_label')} hint={used(lastName.length)} error={fieldErrors.lastName}>{p => (
                        <TextInput {...p} name="lastName" autoComplete="off" dir="auto" maxLength={NAME_MAX} value={lastName} disabled={loading}
                            onChange={e => { setLastName(e.target.value); clear('lastName') }} />
                    )}</Field>
                    <Field label={t('email')} error={fieldErrors.email}>{p => (
                        <TextInput {...p} name="email" type="email" autoComplete="off" spellCheck={false} dir="ltr" value={email} disabled={loading}
                            onChange={e => { setEmail(e.target.value); clear('email') }} />
                    )}</Field>
                    <Field label={t('password')} hint={t('emp_new_password_hint')} error={fieldErrors.password}>{p => (
                        <PasswordInput {...p} name="password" autoComplete="new-password" maxLength={PASSWORD_MAX} value={password} disabled={loading}
                            onChange={e => { setPassword(e.target.value); clear('password') }} />
                    )}</Field>

                    {isSuperAdmin && (
                        <div>
                            <Field label={t('company_label')} error={fieldErrors.companyId ?? (companies.error ? t('emp_new_companies_failed') : undefined)}>{p => (
                                <Select {...p} name="companyId" value={companyId} disabled={loading}
                                    options={[{ value: '', label: t('select_company_placeholder') }, ...companyList.map(c => ({ value: c.id, label: c.name }))]}
                                    onChange={e => { setCompanyId(e.target.value); setRoleId(''); setRole('EMPLOYEE'); clear('companyId') }} />
                            )}</Field>
                            {companies.error && <Button size="sm" busy={companies.isValidating} onClick={() => { void companies.mutate() }}>{t('try_again')}</Button>}
                        </div>
                    )}

                    {(canAssignRole || canRequestRole) && (
                        <RoleField companyId={companyId} value={roleId} disabled={loading} requestOnly={canRequestRole}
                            onChange={(id, chosen) => { setRoleId(id); setRole(chosen?.baseRole ?? 'EMPLOYEE') }} />
                    )}

                    {salaryShown && (
                        <Field label={t('monthly_base_salary_label')} error={fieldErrors.salary}>{p => (
                            <TextInput {...p} name="salary" type="number" inputMode="decimal" min={0} autoComplete="off" value={salary} disabled={loading}
                                onChange={e => { setSalary(e.target.value); clear('salary') }} />
                        )}</Field>
                    )}

                    {dayOffShown && (
                        <Field label={t('day_off_credit')} error={fieldErrors.dayOffCredit}>{p => (
                            <TextInput {...p} name="dayOffCredit" type="number" inputMode="decimal" min={0} step={0.5} autoComplete="off" value={dayOffCredit} disabled={loading}
                                onChange={e => { setDayOffCredit(e.target.value); clear('dayOffCredit') }} />
                        )}</Field>
                    )}

                    {role === 'EMPLOYEE' && canAssignTeam && (
                        <div>
                            <Field label={t('team_leader_label')} hint={t('team_leader_hint')} error={leaders.error ? t('emp_new_leaders_failed') : undefined}>{p => (
                                <Select {...p} name="teamLeaderId" value={teamLeaderId} disabled={loading}
                                    options={[{ value: '', label: t('team_leader_none') }, ...leaderList.map(l => ({ value: l.id, label: `${l.firstName} ${l.lastName}`.trim() }))]}
                                    onChange={e => setTeamLeaderId(e.target.value)} />
                            )}</Field>
                            {leaders.error && <Button size="sm" busy={leaders.isValidating} onClick={() => { void leaders.mutate() }}>{t('try_again')}</Button>}
                        </div>
                    )}

                    {error && <p className="ui-error" role="alert">{error}</p>}
                    <div className="ui-form-actions">
                        <Button type="submit" variant="primary" icon={UserPlusIcon} busy={loading}>
                            {loading ? t('creating') : isSuperAdmin ? t('create_user_button') : t('create_employee_button')}
                        </Button>
                        <ButtonLink href={'/dashboard/employees'}>{t('cancel')}</ButtonLink>
                    </div>
                </form>
            </Card>
        </Page>
    )
}

/**
 * The role, from those the viewer may hand out (ROLES_PLAN.md §6.4), the
 * company's default first. Its own part, so the roles are asked for only
 * where there's a role to pick.
 */
function RoleField({ companyId, value, disabled, requestOnly, onChange }: {
    companyId: string
    value: string
    disabled: boolean
    /** Somebody who may only ask: the pick goes to an Admin for approval. */
    requestOnly: boolean
    onChange: (roleId: string, role: AssignableRole | null) => void
}) {
    const { t } = useLanguage()
    const roles = useAssignableRoles(companyId)
    const fallback = roles.find(r => r.isDefault)
    const options = [
        { value: '', label: `${t('roles_select_default')}${fallback ? ` (${roleLabel(fallback, t)})` : ''}` },
        ...roles.map(r => ({ value: r.id, label: roleLabel(r, t) })),
    ]
    return (
        <Field label={t('role_label')} hint={requestOnly && value ? t('role_requests_will_ask') : undefined}>{p => (
            <Select {...p} name="roleId" value={value} disabled={disabled} options={options}
                onChange={e => onChange(e.target.value, roles.find(r => r.id === e.target.value) ?? null)} />
        )}</Field>
    )
}
