'use client'
import { useState, useEffect, useEffectEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { HourglassIcon, PencilSimpleIcon } from '@phosphor-icons/react/ssr'
import EndContractModal from './EndContractModal'
import TeamHandOffModal from './TeamHandOffModal'
import { useCan, useViewer } from '@/lib/useCan'
import RoleSelect from '@/components/RoleSelect'
import RoleRequestControl from '@/components/RoleRequestControl'
import { roleLabel } from '@/lib/role-label'
import { apiErrorText } from "@/lib/api-error-text"
import { changedUsername } from "@/lib/username-rules"
import { ButtonLink, Card, EmptyState, Page } from '@/components/ui'
import { firstError } from '@/lib/form-errors'
import { NameChangeWaiting, ProfileHeader } from '@/components/profile/ProfileFrame'
import { ProfilePhoto } from '@/components/profile/ProfilePhoto'
import { ProfileView } from '@/components/profile/ProfileView'
import { ConfirmPasswordDialog, TemporaryPasswordDialog } from '@/components/profile/PasswordDialogs'
import { ProfileForm, type ProfileValues } from '@/components/profile/ProfileForm'
import { profileAccess } from '@/lib/profile-access'
import { PROFILE_FIELDS, profileErrors, refusedField, type ProfileField } from '@/lib/profile-form'
import { resetRefusal } from '@/lib/profile-password'
import { fetchRetrying } from '@/lib/swr-fetcher'

type EmployeeProfileFormProps = {
    userId: string
    isViewMode?: boolean
}

/**
 * A person's profile: someone else's, to see (?mode=view) or edit, or one's
 * own, from the account menu. On the building blocks in parts (UI_PLAN.md
 * §5 step 5, the pages left). Part 1, PR 191: its page header, its photo,
 * and a name change waiting (components/profile). Part 2, PR 192: someone
 * else's, seen, as their details (components/profile/ProfileView.tsx), what
 * may be seen and done asked in one place (lib/profile-access.ts), and
 * confirming with one's own password in the building blocks' dialog. Part
 * 3, PR 193: its form (components/profile/ProfileForm.tsx), each field's
 * mistake under it (lib/profile-form.ts). Its role field and its contract's
 * dialogs follow in the parts after.
 */
export default function EmployeeProfileForm({ userId, isViewMode = false }: EmployeeProfileFormProps) {
    const { t, locale } = useLanguage()
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('')
    // Which of the company's roles they hold (ROLES_PLAN.md §6.4); `role` is
    // its kind, which the rest of the form still reads.
    const [roleId, setRoleId] = useState('')
    const [currentRole, setCurrentRole] = useState<{ id: string; name: string; builtIn?: string | null; companyId: string } | null>(null)
    // An acting role (§6.13): the return date for a new one, and the cover
    // already running, if any.
    const [actingDate, setActingDate] = useState('')
    // The earliest return date the picker offers: tomorrow. Worked out once,
    // not on every render.
    const [tomorrow] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10))
    const [acting, setActing] = useState<{ until: string; returnTo: { name: string; builtIn?: string | null } | null } | null>(null)
    const [gender, setGender] = useState('MALE')
    const [salary, setSalary] = useState<string>('')
    const [baseDayOffCredit, setBaseDayOffCredit] = useState<string>('')
    const [username, setUsername] = useState('')
    // As loaded: the username is sent only when it's been changed.
    const [savedUsername, setSavedUsername] = useState('')
    const [status, setStatus] = useState('OFFLINE')
    const [companyId, setCompanyId] = useState('')
    // Empty string is the select's "no team leader" option; it becomes an
    // explicit null in the payload, because absent means "leave it alone" and
    // an Admin resolving a hand-off needs to be able to say "unassign".
    const [teamLeaderId, setTeamLeaderId] = useState('')
    const [myLeader, setMyLeader] = useState<{ firstName: string; lastName: string } | null>(null)
    const [leaders, setLeaders] = useState<{ id: string; firstName: string; lastName: string }[]>([])
    // Set when the server refuses a change because this person still leads a
    // team. It carries the names, so the modal asks about these people rather
    // than about a count.
    const [handoff, setHandoff] = useState<{ id: string; firstName: string; lastName: string }[] | null>(null)
    const [companies, setCompanies] = useState<{ id: string, name: string }[]>([])
    // Nothing to load without a user id; the effect below warns about that
    // case rather than loading anything.
    const [loading, setLoading] = useState(Boolean(userId))
    const [saving, setSaving] = useState(false)
    // Their photo, as saved: changed and removed at once (components/profile/ProfilePhoto.tsx).
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    // The id is the request's on the Requests page; one just asked for has none yet.
    const [pendingRequest, setPendingRequest] = useState<{ id?: string, newFirstName: string, newLastName: string } | null>(null)
    const [originalFirstName, setOriginalFirstName] = useState('')
    const [originalLastName, setOriginalLastName] = useState('')
    const [showEndContract, setShowEndContract] = useState(false)
    // Bumped after ending or reinstating a contract, so the profile reloads and
    // shows the new status (and the button its opposite action). The view has
    // no save that would otherwise bring it up to date.
    const [reloadKey, setReloadKey] = useState(0)
    const router = useRouter()
    const { data: session, update } = useSession()
    const { showToast } = useToast()
    const userRole = session?.user?.role || ''
    // Each field is offered, and sent, with the permission PUT /api/users
    // checks for it.
    const { can } = useCan()
    const viewer = useViewer()
    const canAssignTeam = can('employees.assign_team')

    // What's wrong, under each field, and what isn't a field's, above the buttons.
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<ProfileField, string>>>({})
    const [formError, setFormError] = useState<string | null>(null)
    // The field to focus, once the form can be used again: its fields are off
    // while it's sent. Numbered, so the same field asked for again is focused
    // again (as Add employee's).
    const [focusOn, setFocusOn] = useState<{ field: ProfileField; n: number } | null>(null)
    // Something typed since it was loaded or saved, which a reload or a
    // closed tab would lose.
    const [changed, setChanged] = useState(false)
    // Set once a temporary password has been issued via the reset flow (F-02)
    // — shown to the acting admin exactly once, never persisted or re-fetchable.
    const [issuedTempPassword, setIssuedTempPassword] = useState<string | null>(null)
    // What one's own password is asked for, before it's done: saving the
    // form, or resetting their password (components/profile/PasswordDialogs.tsx).
    const [confirming, setConfirming] = useState<'UPDATE' | 'RESET_PASSWORD' | null>(null)

    useEffect(() => {
        // Prevent default drag and drop behavior globally for this page
        const preventDefault = (e: DragEvent) => {
            e.preventDefault()
            e.stopPropagation()
        }

        window.addEventListener('dragover', preventDefault)
        window.addEventListener('drop', preventDefault)

        return () => {
            window.removeEventListener('dragover', preventDefault)
            window.removeEventListener('drop', preventDefault)
        }
    }, [])

    // Read at the moment it fires, not a reason to fetch again: a language
    // switch should not reload the form under somebody's edits.
    const reportLoadFailure = useEffectEvent(() => showToast(t('error_generic'), 'error'))

    // Keyed on who is signed in, not on the session object. The session is
    // refetched every five minutes and comes back as a new object each time;
    // depending on it re-ran this load and re-seeded every field from the
    // server, throwing away whatever an Admin was halfway through editing.
    const sessionUserId = session?.user?.id

    useEffect(() => {
        const fetchEmployee = async () => {
            if (!sessionUserId) return // Don't fetch if no session (avoids errors on signout)
            try {
                const res = await fetchRetrying(`/api/users?id=${userId}`, { cache: 'no-store' })
                const result = await res.json()
                if (!result.success) throw new Error(result.error || 'Failed to fetch employee')
                const employee = result.data

                if (employee.firstName) {
                    setFirstName(employee.firstName)
                    setLastName(employee.lastName)
                    setOriginalFirstName(employee.firstName)
                    setOriginalLastName(employee.lastName)
                } else if (employee.name) {
                    const parts = employee.name.split(' ')
                    setFirstName(parts[0] || '')
                    setLastName(parts.slice(1).join(' ') || '')
                    setOriginalFirstName(parts[0] || '')
                    setOriginalLastName(parts.slice(1).join(' ') || '')
                }
                const cleanEmail = employee.email?.split('_DELETED_')[0] || employee.email
                setEmail(cleanEmail)
                setRole(employee.role)
                setRoleId(employee.roleId || '')
                setCurrentRole(employee.roleId ? { id: employee.roleId, name: employee.assignedRole?.name ?? '', builtIn: employee.assignedRole?.builtIn ?? null, companyId: employee.companyId } : null)
                setActing(employee.actingUntil ? { until: employee.actingUntil, returnTo: employee.returnRole ?? null } : null)
                setGender(employee.gender || 'MALE')
                setSalary(employee.salary !== undefined && employee.salary !== null ? employee.salary.toString() : '')
                setBaseDayOffCredit(employee.baseDayOffCredit !== undefined && employee.baseDayOffCredit !== null ? employee.baseDayOffCredit.toString() : '0')
                setCompanyId(employee.companyId || '')
                setUsername(employee.username || '')
                setSavedUsername(employee.username || '')
                setStatus(employee.status || 'OFFLINE')
                setTeamLeaderId(employee.teamLeaderId || '')
                setMyLeader(employee.teamLeader || null)
                setAvatarUrl(employee.avatar || null)

                // Their own name change waiting, asked for by whose it is: the
                // list gives whoever may decide name changes the company's
                // waiting ones otherwise, and the first, whoever's, showed
                // here as theirs (PR 191).
                if (userId === sessionUserId && (employee.role === 'EMPLOYEE' || employee.role === 'TEAM_LEADER')) {
                    const reqRes = await fetchRetrying(`/api/profile-requests?status=PENDING&userId=${encodeURIComponent(userId)}`)
                    if (reqRes.ok) {
                        const result = await reqRes.json()
                        const requestsData = result.data?.data || []
                        if (requestsData.length > 0) {
                            setPendingRequest(requestsData[0])
                        }
                    }
                }
            } catch {
                reportLoadFailure()
            } finally {
                setLoading(false)
            }
        }

        const fetchCompanies = async () => {
            try {
                const res = await fetchRetrying('/api/companies?limit=1000')
                if (res.ok) {
                    const result = await res.json()
                    const data = result.data || {}
                    setCompanies(data.data || [])
                }
            } catch (e) {
                console.error('Failed to fetch companies', e)
            }
        }

        if (userId) {
            fetchEmployee()
        } else {
            console.warn('EmployeeProfileForm: userId is missing')
        }
        // Who this employee could be assigned to. Asked for by role rather
        // than fetched wholesale and filtered here — the browser should not be
        // handed a list it is going to throw most of away.
        const fetchLeaders = async () => {
            try {
                const res = await fetchRetrying('/api/users?role=TEAM_LEADER&limit=1000')
                if (res.ok) {
                    const result = await res.json()
                    setLeaders(result.data?.data || [])
                }
            } catch (e) {
                console.error('Failed to fetch team leaders', e)
            }
        }

        if (userRole === 'SUPER_ADMIN') {
            fetchCompanies()
        }
        if (canAssignTeam) {
            fetchLeaders()
        }
    }, [userId, userRole, sessionUserId, reloadKey, canAssignTeam])

    // Each hands back what's wrong, to say under the password, or null once
    // it's done. The route's refusals are in English, and are said in the
    // page's language (lib/profile-password.ts).
    const resetPassword = async (confirmPassword: string): Promise<string | null> => {
        try {
            const res = await fetch(`/api/users/${userId}/reset-password`, {
                method: 'POST',
                body: JSON.stringify({ confirmPassword }),
                headers: { 'Content-Type': 'application/json' }
            })
            const result = await res.json().catch(() => null)
            if (!res.ok || !result?.success) return t(resetRefusal(result?.error))
            setConfirming(null)
            // Shown this once, in its own dialog.
            setIssuedTempPassword(result.data.password)
            return null
        } catch {
            return t('profile_reset_failed')
        }
    }

    const confirmAndSave = async (password: string): Promise<string | null> => {
        try {
            const res = await fetch('/api/auth/verify', {
                method: 'POST',
                body: JSON.stringify({ password }),
                headers: { 'Content-Type': 'application/json' }
            })
            const result = await res.json().catch(() => null)
            // A check that failed, as when the server does, isn't a wrong password.
            if (!res.ok || !result?.success) return t('profile_verify_failed')
            if (!result.data?.valid) return t('incorrect_password')
        } catch {
            return t('profile_verify_failed')
        }
        setConfirming(null)
        await executeSubmit()
        return null
    }

    // Someone else's profile is under their name as it was loaded, not as it's
    // being typed. Whose it is is known from the first paint, from the layout,
    // before the session hook has loaded.
    const own = userId === viewer?.id
    const name = `${originalFirstName} ${originalLastName}`.trim() || email
    // What they may see here and do, for the view and the form alike (PR 192).
    const access = profileAccess({ can, viewer, person: { id: userId, role } })
    // Seen, too, where its form would be refused: at the form's address,
    // by someone who may not edit them, as the notice of an acting role
    // held back sends whoever decides roles.
    const seeing = isViewMode || !access.edit

    // The form's fields are its own (components/profile/ProfileForm.tsx);
    // what's typed is kept here, and sent from here.
    const wrongAt = (errors: Partial<Record<ProfileField, string>>) => {
        setFieldErrors(errors)
        const first = firstError(errors as Record<string, string>, PROFILE_FIELDS) as ProfileField | null
        if (first) setFocusOn(f => ({ field: first, n: (f?.n ?? 0) + 1 }))
    }

    useEffect(() => {
        if (!focusOn || saving) return
        // The first field that's wrong takes the focus, which brings it into view.
        document.querySelector<HTMLElement>(`[name="${focusOn.field}"]`)?.focus()
    }, [focusOn, saving])

    // Reloading or closing the tab with something typed asks first, as Add
    // employee does; not while it's being sent.
    useEffect(() => {
        if (!changed || saving || seeing) return
        const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [changed, saving, seeing])

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setFormError(null)
        setFocusOn(null)
        // In a number field, what the browser can't read ("1e", "-") reads as
        // empty, as though left empty, which is sent as 0: it's asked of the
        // fields themselves, as the form doesn't let the browser check them.
        const form = e.currentTarget
        const unreadable = (['salary', 'dayOffCredit'] as const).filter(name => {
            const field = form.elements.namedItem(name)
            return field instanceof HTMLInputElement && field.validity.badInput
        })
        // What's wrong is said under its field before anything is asked or
        // sent; then one's own password (ConfirmPasswordDialog), then the save.
        const wrong = profileErrors({
            firstName, lastName,
            password: access.changePassword ? password : '',
            email: access.changeEmail ? email : undefined,
            username: access.changeUsername ? changedUsername(username, savedUsername) : undefined,
            salary: access.changeSalary ? salary : undefined,
            dayOffCredit: access.changeDayOffCredit ? baseDayOffCredit : undefined,
            unreadable,
        })
        if (Object.keys(wrong).length > 0) {
            wrongAt(Object.fromEntries(Object.entries(wrong).map(([field, key]) => [field, t(key)])))
            return
        }
        setFieldErrors({})
        setConfirming('UPDATE')
    }

    /**
     * `reassignTo` is the answer to "where does their team go", and is only
     * ever passed on the retry that follows the modal. undefined means nobody
     * has answered, which is what makes the first attempt get refused — the
     * three states have to survive all the way to the server.
     */
    const executeSubmit = async (reassignTo?: string | null) => {
        setSaving(true)
        setFormError(null)

        try {
            const isNameChanged = firstName !== originalFirstName || lastName !== originalLastName

            // One's own name, on an employee's or a team leader's footing, is
            // asked for (access.nameByRequest), and the rest saved as usual.
            if (access.nameByRequest && isNameChanged) {
                const reqRes = await fetch('/api/profile-requests', {
                    method: 'POST',
                    body: JSON.stringify({ newFirstName: firstName, newLastName: lastName }),
                    headers: { 'Content-Type': 'application/json' }
                })

                if (!reqRes.ok) {
                    const text = await reqRes.text()
                    throw new Error(apiErrorText(text, t('error_generic')))
                }

                showToast(t('name_change_submitted'), 'success')
                setPendingRequest({ newFirstName: firstName, newLastName: lastName })
                setFirstName(originalFirstName)
                setLastName(originalLastName)
            }

            const res = await fetch('/api/users', {
                method: 'PUT',
                body: JSON.stringify({
                    id: userId,
                    // Each as the form may change it (lib/profile-access.ts).
                    firstName: access.nameByRequest ? undefined : firstName,
                    lastName: access.nameByRequest ? undefined : lastName,
                    email: access.changeEmail ? email : undefined,
                    password: access.changePassword && password ? password : undefined,
                    role,
                    // Only a different role is a change; the server refuses
                    // what the dropdown would not have offered.
                    roleId: roleId && roleId !== currentRole?.id ? roleId : undefined,
                    actingUntil: roleId && roleId !== currentRole?.id && actingDate ? actingDate : undefined,
                    gender,
                    avatar: avatarUrl,
                    salary: access.changeSalary ? parseFloat(salary) || 0 : undefined,
                    baseDayOffCredit: access.changeDayOffCredit ? parseFloat(baseDayOffCredit) || 0 : undefined,
                    username: access.changeUsername ? changedUsername(username, savedUsername) : undefined,
                    status: access.status ? status : undefined,
                    // undefined leaves it alone; null unassigns. The empty
                    // option means the second, so it cannot be sent as "".
                    teamLeaderId: access.teamLeader ? (teamLeaderId || null) : undefined,
                    reassignReportsTo: reassignTo
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const text = await res.text()
                let answer: { error?: string; details?: Record<string, unknown> } | null = null
                try { answer = JSON.parse(text) } catch { /* not JSON: said as it came */ }
                // Read before the rest, because this one is not an error to
                // report — it is a question to ask.
                const reports = answer?.details?.reports
                if (Array.isArray(reports) && reports.length > 0) {
                    setHandoff(reports)
                    setSaving(false)
                    return
                }
                // Under the field it's about, where it can be; above the buttons otherwise.
                const refused = refusedField(answer)
                if (refused) wrongAt({ [refused.field]: t(refused.key) })
                else setFormError(apiErrorText(text, t('error_generic')))
                setSaving(false)
                return
            }

            setHandoff(null)
            // Saved, it's nothing to lose.
            setChanged(false)

            // Sync Logic
            if (userId === session?.user?.id) {
                await update({
                    firstName,
                    lastName,
                    gender,
                    avatar: avatarUrl,
                    image: avatarUrl,
                    picture: avatarUrl
                })
                showToast(t('profile_updated_success'), 'success')
                setSaving(false)
                router.refresh()
            } else {
                showToast(t('employee_updated_success'), 'success')
                setSaving(false)
                setTimeout(() => {
                    router.back()
                    router.refresh()
                }, 1500)
            }
        } catch (err) {
            // Above the buttons, where it stays to be read, not in a toast that left.
            setFormError(err instanceof Error && err.message ? err.message : t('error_generic'))
            setSaving(false)
        }
    }

    // The page's header from the start, and the building blocks' panel where
    // the profile will be (DESIGN.md §5.5, Loading). It was the old spinner,
    // then the panel alone (PR 190).
    if (loading) {
        return (
            <Page>
                <ProfileHeader own={own} editing={!seeing} name={null} />
                <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
            </Page>
        )
    }

    if (seeing) {
        const digits = locale === 'ar' ? 'ar-EG' : 'en-GB'
        return (
            <Page>
                <ProfileHeader own={own} editing={false} name={name}
                    action={access.edit ? <ButtonLink variant="primary" icon={PencilSimpleIcon} href={`/dashboard/employees/${userId}`} prefetch={false}>{t('edit')}</ButtonLink> : undefined} />
                {pendingRequest && <NameChangeWaiting name={`${pendingRequest.newFirstName} ${pendingRequest.newLastName}`.trim()} requestId={pendingRequest.id} />}
                <ProfileView
                    name={name}
                    photo={avatarUrl}
                    access={access}
                    facts={{
                        email,
                        username: savedUsername,
                        gender,
                        company: role === 'SUPER_ADMIN' ? 'SHSD' : companies.find(c => c.id === companyId)?.name ?? null,
                        role: role === 'SUPER_ADMIN' ? t('role_super_admin') : roleLabel(currentRole, t),
                        acting: acting ? t('acting_now').replace('{date}', new Date(acting.until).toLocaleDateString(digits, { day: 'numeric', month: 'long', year: 'numeric' })).replace('{role}', roleLabel(acting.returnTo, t)) : null,
                        teamLeader: myLeader ? `${myLeader.firstName} ${myLeader.lastName}`.trim() : null,
                        status,
                        salary,
                        dayOffCredit: baseDayOffCredit,
                    }}
                    onResetPassword={() => setConfirming('RESET_PASSWORD')}
                    // Ending a contract, or reinstating one, saves through its own
                    // dialog, with the settlement shown first: it's the view's,
                    // never the form's, beside whose Update it read as though
                    // Update would apply it.
                    onEndContract={() => setShowEndContract(true)}
                />
                {showEndContract && (
                    <EndContractModal
                        userId={userId}
                        name={name}
                        status={status}
                        onClose={() => setShowEndContract(false)}
                        onDone={() => { setReloadKey(k => k + 1); router.refresh() }}
                    />
                )}
                <ConfirmPasswordDialog open={confirming === 'RESET_PASSWORD'} onCancel={() => setConfirming(null)} onConfirm={resetPassword} />
                <TemporaryPasswordDialog name={name} password={issuedTempPassword} onClose={() => setIssuedTempPassword(null)} />
            </Page>
        )
    }

    // The role keeps its own controls until its part (UI_PLAN.md §5 step 5).
    const roleField = access.role && (
        <div>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('role_label')}</label>
            {role === 'SUPER_ADMIN' ? (
                <input aria-label={t('role_label')} className="input" value={t('super_admins')} disabled style={{ background: 'var(--surface-sunk)', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' }} />
            ) : !can('employees.assign_role') ? (
                // May only ask (§6.12): a request, not a change.
                <RoleRequestControl userId={userId} companyId={companyId} current={currentRole} locked={role === 'ADMIN'} style={{ textAlign: locale === 'ar' ? 'right' : 'left' }} />
            ) : (
                <RoleSelect
                    companyId={companyId}
                    value={roleId}
                    // Moved to another company, their role there is chosen afresh.
                    current={currentRole && currentRole.companyId === companyId ? currentRole : null}
                    onChange={(id, chosen) => { setRoleId(id); setChanged(true); if (chosen) setRole(chosen.baseRole) }}
                    // Only the Super Admin acts on an Admin (§4.2, rule 7).
                    locked={role === 'ADMIN' && userRole !== 'SUPER_ADMIN'}
                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                />
            )}
            {acting && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0.35rem 0 0' }}>
                    {t('acting_now').replace('{date}', new Date(acting.until).toLocaleDateString(locale)).replace('{role}', roleLabel(acting.returnTo, t))}
                </p>
            )}
            {can('employees.assign_role') && roleId && roleId !== currentRole?.id && (
                <div style={{ marginTop: '0.75rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.8rem' }}>{t('acting_until_label')}</label>
                    <input aria-label={t('acting_until_label')} type="date" className="input" value={actingDate} min={tomorrow} onChange={e => { setActingDate(e.target.value); setChanged(true) }} />
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-soft)', margin: '0.25rem 0 0' }}>{t('acting_until_hint')}</p>
                </div>
            )}
        </div>
    )

    const values: ProfileValues = { firstName, lastName, gender, email, username, salary, dayOffCredit: baseDayOffCredit, password, status, teamLeaderId }
    const setters: Record<keyof ProfileValues, (value: string) => void> = {
        firstName: setFirstName, lastName: setLastName, gender: setGender, email: setEmail, username: setUsername,
        salary: setSalary, dayOffCredit: setBaseDayOffCredit, password: setPassword, status: setStatus, teamLeaderId: setTeamLeaderId,
    }
    // Typed again, a field's mistake is gone.
    const set = (field: keyof ProfileValues, value: string) => {
        setters[field](value)
        setChanged(true)
        if (field in fieldErrors && fieldErrors[field as ProfileField]) setFieldErrors(errors => ({ ...errors, [field]: undefined }))
    }

    return (
        <Page>
            <ProfileHeader own={own} editing name={name} />
            {pendingRequest && <NameChangeWaiting name={`${pendingRequest.newFirstName} ${pendingRequest.newLastName}`.trim()} requestId={pendingRequest.id} />}
            <Card>
                <ProfilePhoto userId={userId} name={name} photo={avatarUrl} canChange own={own} onChange={setAvatarUrl} />
                <ProfileForm
                    values={values}
                    set={set}
                    errors={fieldErrors}
                    error={formError}
                    access={access}
                    company={role === 'SUPER_ADMIN' ? 'SHSD' : companies.find(c => c.id === companyId)?.name ?? null}
                    ownTeamLeader={myLeader ? `${myLeader.firstName} ${myLeader.lastName}`.trim() : null}
                    leaders={leaders.filter(l => l.id !== userId).map(l => ({ id: l.id, name: `${l.firstName} ${l.lastName}`.trim() }))}
                    busy={saving}
                    role={roleField}
                    onSubmit={handleSubmit}
                    cancelHref={`/dashboard/employees/${userId}?mode=view`}
                />
            </Card>

            {
                handoff && (
                    <TeamHandOffModal
                        leaderId={userId}
                        leaderName={`${firstName} ${lastName}`.trim()}
                        reports={handoff}
                        leaders={leaders}
                        busy={saving}
                        onCancel={() => setHandoff(null)}
                        onConfirm={reassignTo => {
                            setHandoff(null)
                            executeSubmit(reassignTo)
                        }}
                    />
                )
            }
            <ConfirmPasswordDialog open={confirming === 'UPDATE'} onCancel={() => setConfirming(null)} onConfirm={confirmAndSave} />
        </Page>
    )
}
