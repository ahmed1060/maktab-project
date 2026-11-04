'use client'
import { useState, useEffect, useEffectEvent } from 'react'
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
import { changedUsername, usernameError } from "@/lib/username-rules"
import { ButtonLink, Card, EmptyState, Page } from '@/components/ui'
import { NameChangeWaiting, ProfileHeader } from '@/components/profile/ProfileFrame'
import { ProfilePhoto } from '@/components/profile/ProfilePhoto'
import { ProfileView } from '@/components/profile/ProfileView'
import { ConfirmPasswordDialog, TemporaryPasswordDialog } from '@/components/profile/PasswordDialogs'
import { profileAccess } from '@/lib/profile-access'
import { resetRefusal } from '@/lib/profile-password'
import { startNavigationProgress } from '@/components/NavigationProgress'
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
 * confirming with one's own password in the building blocks' dialog. Its
 * form and its contract's dialogs follow in the parts after.
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

    // Password & Verification States
    const [showNewPassword, setShowNewPassword] = useState(false)
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
            if (!result?.data?.valid) return t('incorrect_password')
        } catch {
            return t('error_generic')
        }
        setConfirming(null)
        await executeSubmit()
        return null
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        // One's own password first (ConfirmPasswordDialog), then the save.
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

        // Validation — was /^[^@]{1,20}@[^@]{1,10}\.com$/, which rejected most
        // real addresses (subdomains, non-.com TLDs, longer local parts). The
        // backend already validates properly (user.schema.ts), this is just a
        // quick client-side check before that round trip.
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (!emailRegex.test(email)) {
            showToast(t('email_format_error'), 'error')
            setSaving(false)
            return
        }

        // The same rule as the server's (lib/username-rules.ts), said before the round trip.
        const sentUsername = userRole === 'SUPER_ADMIN' ? changedUsername(username, savedUsername) : undefined
        if (sentUsername !== undefined && usernameError(sentUsername)) {
            showToast(t('username_invalid'), 'error')
            setSaving(false)
            return
        }

        if (salary && parseFloat(salary) > 1000000000) {
            showToast(t('salary_limit_error'), 'error')
            setSaving(false)
            return
        }

        try {
            const isSelf = userId === session?.user?.id
            const isNameChanged = firstName !== originalFirstName || lastName !== originalLastName
            const isRestrictedRole = role === 'EMPLOYEE' || role === 'TEAM_LEADER'

            // If name changed and user is restricted role editing self, use request system
            if (isSelf && isRestrictedRole && isNameChanged) {
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
                    // Only send name if not restricted or not changed
                    firstName: (isSelf && isRestrictedRole) ? undefined : firstName,
                    lastName: (isSelf && isRestrictedRole) ? undefined : lastName,
                    email,
                    password: password || undefined,
                    role,
                    // Only a different role is a change; the server refuses
                    // what the dropdown would not have offered.
                    roleId: roleId && roleId !== currentRole?.id ? roleId : undefined,
                    actingUntil: roleId && roleId !== currentRole?.id && actingDate ? actingDate : undefined,
                    gender,
                    avatar: avatarUrl,
                    salary: can('salary.edit') && userId !== session?.user?.id ? parseFloat(salary) || 0 : undefined,
                    baseDayOffCredit: can('dayoff.adjust_credit') && userId !== session?.user?.id ? parseFloat(baseDayOffCredit) || 0 : undefined,
                    username: userRole === 'SUPER_ADMIN' ? changedUsername(username, savedUsername) : undefined,
                    status: can('employees.change_status') && userId !== session?.user?.id ? status : undefined,
                    // undefined leaves it alone; null unassigns. The empty
                    // option means the second, so it cannot be sent as "".
                    teamLeaderId: canAssignTeam && userId !== session?.user?.id && role === 'EMPLOYEE'
                        ? (teamLeaderId || null)
                        : undefined,
                    reassignReportsTo: reassignTo
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const text = await res.text()
                // Read before the generic handling below, because this one is
                // not an error to report — it is a question to ask.
                try {
                    const body = JSON.parse(text)
                    const reports = body?.details?.reports
                    if (Array.isArray(reports) && reports.length > 0) {
                        setHandoff(reports)
                        setSaving(false)
                        return
                    }
                } catch { /* not JSON, fall through to the message below */ }
                if (text.includes('"Username in use"')) throw new Error(t('username_in_use'))
                if (text.includes("Username follows another company's username code")) throw new Error(t('username_reserved'))
                throw new Error(apiErrorText(text, t('error_generic')))
            }

            setHandoff(null)

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
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            showToast(err.message || t('error_generic'), 'error')
            setSaving(false)
        }
    }

    // Someone else's profile is under their name as it was loaded, not as it's
    // being typed. Whose it is is known from the first paint, from the layout,
    // before the session hook has loaded.
    const own = userId === viewer?.id
    const name = `${originalFirstName} ${originalLastName}`.trim() || email
    // What they may see here and do, for the view and the form alike (PR 192).
    const access = profileAccess({ can, viewer, person: { id: userId, role } })

    // The page's header from the start, and the building blocks' panel where
    // the profile will be (DESIGN.md §5.5, Loading). It was the old spinner,
    // then the panel alone (PR 190).
    if (loading) {
        return (
            <Page>
                <ProfileHeader own={own} editing={!isViewMode} name={null} />
                <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
            </Page>
        )
    }

    if (isViewMode) {
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

    return (
        <Page>
            <ProfileHeader own={own} editing name={name} />
            {pendingRequest && <NameChangeWaiting name={`${pendingRequest.newFirstName} ${pendingRequest.newLastName}`.trim()} requestId={pendingRequest.id} />}
            <Card>
                <ProfilePhoto userId={userId} name={name} photo={avatarUrl} canChange own={own} onChange={setAvatarUrl} />
                <form onSubmit={handleSubmit} className="ui-form">
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('first_name_label')}</label>
                            <input aria-label={t('first_name_label')}
                                className="input"
                                value={firstName}
                                onChange={e => setFirstName(e.target.value)}
                                required
                                style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('last_name_label')}</label>
                            <input aria-label={t('last_name_label')}
                                className="input"
                                value={lastName}
                                onChange={e => setLastName(e.target.value)}
                                required
                                style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                            />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('gender_label')}</label>
                        <select aria-label={t('gender_label')}
                            className="input"
                            value={gender}
                            onChange={e => setGender(e.target.value)}
                            required
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        >
                            <option value="MALE">{t('male')}</option>
                            <option value="FEMALE">{t('female')}</option>
                        </select>
                    </div>

                    {access.company && (
                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('company_label')}</label>
                            {role === 'SUPER_ADMIN' ? (
                                <input aria-label={t('company_label')}
                                    className="input"
                                    value="SHSD"
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                            ) : (
                                // Shown, never changed: a person stays in the
                                // company they were added to, and the server
                                // refuses any other (COMPANY_CHANGE_FORBIDDEN).
                                <select
                                    aria-label={t('company_label')}
                                    className="input"
                                    value={companyId}
                                    disabled
                                    style={{ background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                >
                                    <option value="">{t('select_company')}</option>
                                    {companies.map(c => (
                                        <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    )}

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                        <input aria-label={t('email')}
                            type="email"
                            className="input"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            disabled={userId === session?.user?.id}
                            style={userId === session?.user?.id ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('username_label' as any) || 'Username'}</label>
                        <input aria-label={t('username_label' as any) || 'Username'}
                            className="input"
                            spellCheck={false} autoCapitalize="none" autoComplete="off" translate="no"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            disabled={userRole !== 'SUPER_ADMIN'}
                            style={userRole !== 'SUPER_ADMIN' ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                            placeholder={t('username_placeholder' as any) || 'Username'}
                        />
                    </div>

                    {/* Salary Field - Visible to Admins and Self, Editable only by Admins (not self). Hidden for Admins and Super Admins. */}
                    {
                        access.salary && (
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('monthly_base_salary_label')}</label>
                                <input aria-label={t('monthly_base_salary_label')}
                                    type="number"
                                    className="input"
                                    value={salary}
                                    onChange={e => setSalary(e.target.value)}
                                    disabled={userId === session?.user?.id || !can('salary.edit')}
                                    max={1000000000}
                                    style={(userId === session?.user?.id || !can('salary.edit')) ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    placeholder={userId === session?.user?.id && !salary ? t('no_data_available') : (locale === 'ar' ? 'أدخل الراتب' : 'Enter salary')}
                                />
                            </div>
                        )
                    }

                    {/* Day Off Credit Fields - Visible to Admins and Self, Editable only by Admins (not self). Hidden for Admins and Super Admins. */}
                    {
                        access.dayOffCredit && (
                            <>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('day_off_credit_assigned')}</label>
                                    <input aria-label={t('day_off_credit_assigned')}
                                        type="number"
                                        className="input"
                                        value={baseDayOffCredit}
                                        onChange={e => setBaseDayOffCredit(e.target.value)}
                                        disabled={userId === session?.user?.id || !can('dayoff.adjust_credit')}
                                        step="0.5"
                                        style={(userId === session?.user?.id || !can('dayoff.adjust_credit')) ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    />
                                </div>
                            </>
                        )
                    }

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('new_password_optional_label')}</label>
                        <div style={{ position: 'relative' }}>
                            <input aria-label={t('new_password_optional_label')}
                                type={showNewPassword ? "text" : "password"}
                                className="input"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                minLength={12}
                                maxLength={72}
                                placeholder={t('keep_current_password_placeholder')}
                                style={{
                                    textAlign: locale === 'ar' ? 'right' : 'left',
                                    [locale === 'ar' ? 'paddingLeft' : 'paddingRight']: '2.5rem'
                                }}
                            />
                            <button
                                type="button"
                                aria-label={showNewPassword ? t('hide_password' as any) : t('show_password' as any)}
                                aria-pressed={showNewPassword}
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                style={{
                                    position: 'absolute',
                                    [locale === 'ar' ? 'left' : 'right']: '0.75rem',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '0.25rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    color: 'var(--text-soft)'
                                }}
                            >
                                {showNewPassword ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                        <line x1="1" y1="1" x2="23" y2="23"></line>
                                    </svg>
                                ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                        <circle cx="12" cy="12" r="3"></circle>
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    {
                        access.role && (
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
                                        onChange={(id, chosen) => { setRoleId(id); if (chosen) setRole(chosen.baseRole) }}
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
                                        <input aria-label={t('acting_until_label')} type="date" className="input" value={actingDate} min={tomorrow} onChange={e => setActingDate(e.target.value)} />
                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-soft)', margin: '0.25rem 0 0' }}>{t('acting_until_hint')}</p>
                                    </div>
                                )}
                            </div>
                        )
                    }

                    {
                        /* Read-only, and only on your own profile. Everywhere else
                           the field above is an Admin's control; here it is simply
                           information, because knowing who manages you is not
                           something you should have to ask a colleague for. */
                        access.ownTeamLeader && (
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('team_leader_yours')}</label>
                                <p style={{
                                    margin: 0,
                                    padding: '0.6rem 0.75rem',
                                    borderRadius: '0.5rem',
                                    background: 'var(--surface-sunk)',
                                    color: myLeader ? 'var(--text-body)' : 'var(--text-faint)',
                                    textAlign: locale === 'ar' ? 'right' : 'left',
                                }}>
                                    {myLeader ? `${myLeader.firstName} ${myLeader.lastName}` : t('team_leader_yours_none')}
                                </p>
                            </div>
                        )
                    }

                    {
                        /* Only an employee has a team leader — leaders are not led,
                           and an Admin is not managed through this screen. The field
                           disappears rather than greying out when the role above is
                           changed, because an empty disabled control invites the
                           question of what it would mean. */
                        access.teamLeader && (
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('team_leader_label')}</label>
                                <select aria-label={t('team_leader_label')}
                                    className="input"
                                    value={teamLeaderId}
                                    onChange={e => setTeamLeaderId(e.target.value)}
                                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                >
                                    <option value="">{t('team_leader_none')}</option>
                                    {leaders.filter(l => l.id !== userId).map(l => (
                                        <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>
                                    ))}
                                </select>
                                <p style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-faint)', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('team_leader_hint')}</p>
                            </div>
                        )
                    }

                    {
                        access.status && (
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('status_label' as any) || (locale === 'ar' ? 'الحالة' : 'Status')}</label>
                                <select aria-label={t('status_label' as any) || (locale === 'ar' ? 'الحالة' : 'Status')}
                                    className="input"
                                    value={status}
                                    onChange={e => setStatus(e.target.value)}
                                    required
                                    disabled={status === 'ARCHIVED'}
                                    style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                                >
                                    <option value="ACTIVE">{t('status_active' as any) || (locale === 'ar' ? 'نشط' : 'Active')}</option>
                                    <option value="SUSPENDED">{t('status_suspended' as any) || (locale === 'ar' ? 'موقوف' : 'Suspended')}</option>
                                    <option value="OFFLINE">{t('status_offline' as any) || (locale === 'ar' ? 'غير متصل' : 'Offline')}</option>
                                    {/*
                                      Rendered only when it is already the value,
                                      and the select is disabled with it. Without
                                      the option the select would show ACTIVE for
                                      an archived person — the browser picks the
                                      first entry when the value matches none — and
                                      saving the form would quietly reinstate them.
                                    */}
                                    {status === 'ARCHIVED' && (
                                        <option value="ARCHIVED">{t('status_archived')}</option>
                                    )}
                                </select>
                            </div>
                        )
                    }

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-start', flexDirection: 'row' }}>
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? t('updating_button') : t('update_button')}
                        </button>
                        <button
                            type="button"
                            className="btn"
                            style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                            onClick={() => { startNavigationProgress(); router.back() }}
                        >
                            {t('close_button')}
                        </button>
                    </div>
                </form>
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
