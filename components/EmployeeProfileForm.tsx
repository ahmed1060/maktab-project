'use client'
import { useState, useEffect, useEffectEvent } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useToast } from '@/context/ToastContext'
import Image from 'next/image'
import { createPortal } from 'react-dom'
import ConfirmModal from './ConfirmModal'
import { useLanguage } from '@/context/LanguageContext'
import LoadingSpinner from './LoadingSpinner'
import EndContractModal from './EndContractModal'
import TeamHandOffModal from './TeamHandOffModal'
import { useCan } from '@/lib/useCan'

type EmployeeProfileFormProps = {
    userId: string
    isViewMode?: boolean
    onClose?: () => void
}

export default function EmployeeProfileForm({ userId, isViewMode = false, onClose }: EmployeeProfileFormProps) {
    const { t, locale } = useLanguage()
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('')
    const [gender, setGender] = useState('MALE')
    const [salary, setSalary] = useState<string>('')
    const [baseDayOffCredit, setBaseDayOffCredit] = useState<string>('')
    const [username, setUsername] = useState('')
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
    const [uploadingAvatar, setUploadingAvatar] = useState(false)
    const [isResetting, setIsResetting] = useState(false)
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    const [pendingRequest, setPendingRequest] = useState<{ newFirstName: string, newLastName: string } | null>(null)
    const [originalFirstName, setOriginalFirstName] = useState('')
    const [originalLastName, setOriginalLastName] = useState('')
    const [showAvatarModal, setShowAvatarModal] = useState(false)
    const [showEndContract, setShowEndContract] = useState(false)
    // Bumped after ending or reinstating a contract, so the profile reloads and
    // shows the new status (and the button its opposite action). The view has
    // no save that would otherwise bring it up to date.
    const [reloadKey, setReloadKey] = useState(0)
    const [showResetConfirm, setShowResetConfirm] = useState(false)
    const router = useRouter()
    const { data: session, update } = useSession()
    const { showToast } = useToast()
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    const userRole = session?.user?.role || ''
    // Each field is offered, and sent, with the permission PUT /api/users
    // checks for it.
    const { can } = useCan()
    const canAssignTeam = can('employees.assign_team')

    // Password & Verification States
    const [showNewPassword, setShowNewPassword] = useState(false)
    // Set once a temporary password has been issued via the reset flow (F-02)
    // — shown to the acting admin exactly once, never persisted or re-fetchable.
    const [issuedTempPassword, setIssuedTempPassword] = useState<string | null>(null)
    const [verificationModalOpen, setVerificationModalOpen] = useState(false)
    const [verificationPassword, setVerificationPassword] = useState('')
    const [isVerifying, setIsVerifying] = useState(false)
    const [showVerificationPassword, setShowVerificationPassword] = useState(false)
    const [verificationCallback, setVerificationCallback] = useState<{ type: 'UPDATE' | 'RESET_PASSWORD', data?: any } | null>(null)

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
                const res = await fetch(`/api/users?id=${userId}`, { cache: 'no-store' })
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
                setGender(employee.gender || 'MALE')
                setSalary(employee.salary !== undefined && employee.salary !== null ? employee.salary.toString() : '')
                setBaseDayOffCredit(employee.baseDayOffCredit !== undefined && employee.baseDayOffCredit !== null ? employee.baseDayOffCredit.toString() : '0')
                setCompanyId(employee.companyId || '')
                setUsername(employee.username || '')
                setStatus(employee.status || 'OFFLINE')
                setTeamLeaderId(employee.teamLeaderId || '')
                setMyLeader(employee.teamLeader || null)
                setAvatarUrl(employee.avatar || null)

                // Check for pending name change requests
                if (userId === sessionUserId && (employee.role === 'EMPLOYEE' || employee.role === 'TEAM_LEADER')) {
                    const reqRes = await fetch(`/api/profile-requests?status=PENDING`)
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
                const res = await fetch('/api/companies?limit=1000')
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
                const res = await fetch('/api/users?role=TEAM_LEADER&limit=1000')
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

    const handleResetPassword = async (adminPasswordInput: string) => {
        setIsVerifying(true)
        try {
            const res = await fetch(`/api/users/${userId}/reset-password`, {
                method: 'POST',
                body: JSON.stringify({ confirmPassword: adminPasswordInput }),
                headers: { 'Content-Type': 'application/json' }
            })

            const result = await res.json()
            if (!res.ok || !result.success) {
                throw new Error(result.error || t('incorrect_password'))
            }

            setIssuedTempPassword(result.data.password)
            showToast(t('password_reset_issued' as any), 'success')
            setVerificationModalOpen(false)
            setVerificationPassword('')
        } catch (err: any) {
            showToast(err.message || t('error_generic'), 'error')
        } finally {
            setIsVerifying(false)
        }
    }

    const handleVerifyAndUpdate = async (userPasswordInput: string) => {
        setIsVerifying(true)
        try {
            const res = await fetch('/api/auth/verify', {
                method: 'POST',
                body: JSON.stringify({ password: userPasswordInput }),
                headers: { 'Content-Type': 'application/json' }
            })

            const result = await res.json()
            if (!result.data || !result.data.valid) {
                throw new Error(t('incorrect_password'))
            }

            // If valid, proceed with the actual update
            setVerificationModalOpen(false)
            setVerificationPassword('')
            await executeSubmit()
        } catch (err: any) {
            showToast(err.message || t('error_generic'), 'error')
        } finally {
            setIsVerifying(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        // Trigger verification modal before actual submit
        setVerificationCallback({ type: 'UPDATE' })
        setVerificationModalOpen(true)
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
                    throw new Error(text || t('error_generic'))
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
                    gender,
                    avatar: avatarUrl,
                    companyId: userRole === 'SUPER_ADMIN' ? companyId : undefined,
                    salary: can('salary.edit') && userId !== session?.user?.id ? parseFloat(salary) || 0 : undefined,
                    baseDayOffCredit: can('dayoff.adjust_credit') && userId !== session?.user?.id ? parseFloat(baseDayOffCredit) || 0 : undefined,
                    username: userRole === 'SUPER_ADMIN' ? username : undefined,
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
                if (text.includes("Username already in use")) {
                    throw new Error(locale === 'ar' ? 'اسم المستخدم مستخدم بالفعل' : 'Username already in use')
                }
                throw new Error(text || t('error_generic'))
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
                if (onClose) {
                    setTimeout(() => {
                        onClose()
                        router.refresh()
                    }, 1500)
                } else {
                    setTimeout(() => {
                        router.back()
                        router.refresh()
                    }, 1500)
                }
            }
        } catch (err: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
            showToast(err.message || t('error_generic'), 'error')
            setSaving(false)
        }
    }

    const handleResetPhoto = async () => {
        try {
            setIsResetting(true)
            const res = await fetch('/api/users', {
                method: 'PUT',
                body: JSON.stringify({ id: userId, avatar: null }),
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error(t('photo_reset_failed'))

            setAvatarUrl(null)
            if (userId === session?.user?.id) {
                await update({ avatar: null, image: null, picture: null })
            }
            showToast(t('photo_reset_success'), 'success')
            setShowAvatarModal(false)
            setShowResetConfirm(false)
        } catch (err: any) {
            showToast(err.message || t('photo_reset_failed'), 'error')
        } finally {
            setIsResetting(false)
        }
    }

    const handleAvatarUpload = async (file: File) => {
        setUploadingAvatar(true)
        try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('folder', 'avatars')

            const res = await fetch('/api/upload', { method: 'POST', body: formData })
            const result = await res.json()
            if (result.success) {
                const uploadData = result.data
                // 1. Update DB immediately
                await fetch('/api/users', {
                    method: 'PUT',
                    body: JSON.stringify({ id: userId, avatar: uploadData.url }),
                    headers: { 'Content-Type': 'application/json' }
                })

                // 2. Update UI and Session
                setAvatarUrl(uploadData.url)
                if (userId === session?.user?.id) {
                    await update({
                        avatar: uploadData.url,
                        image: uploadData.url,
                        picture: uploadData.url
                    })
                }
                showToast(t('photo_updated_success'), 'success')
                setShowAvatarModal(false)
            } else {
                throw new Error(result.error || t('photo_upload_failed'))
            }
        } catch (err: any) {
            showToast(err.message || t('photo_upload_failed'), 'error')
        } finally {
            setUploadingAvatar(false)
        }
    }

    if (loading) {
        return <LoadingSpinner />
    }


    return (
        <div className={`glass-card ${highlightId === userId ? 'highlight-shading' : ''}`} style={{ maxWidth: '600px', margin: '0 auto', padding: onClose ? '0' : '2rem', direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {!onClose && (
                <h1 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 'bold', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    {isViewMode ? t('employee_profile') : (userId === session?.user?.id ? t('profile_title') : t('edit_employee_title'))}
                </h1>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem', gap: '1rem' }}>
                <div style={{
                    position: 'relative',
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    background: 'var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '4px solid white',
                    boxShadow: '0 4px 6px -1px var(--shadow-weak)',
                    overflow: 'hidden'
                }}>
                    {avatarUrl ? (
                        <Image
                            src={avatarUrl}
                            alt="Avatar"
                            width={100}
                            height={100}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                    ) : (
                        <span style={{ fontSize: '2.5rem' }}>
                            {gender === 'MALE' ? '👨🏻' : '👩🏻'}
                        </span>
                    )}

                    {uploadingAvatar && (
                        <div style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'var(--panel-70)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}>
                            <div className="loader" style={{ width: '20px', height: '20px' }} />
                        </div>
                    )}
                </div>

                {!isViewMode && (
                    <div style={{ textAlign: 'center' }}>
                        <button
                            type="button"
                            className="btn"
                            style={{
                                background: 'var(--surface-sunk)',
                                color: 'var(--text-strong)',
                                fontSize: '0.8rem',
                                padding: '0.4rem 0.8rem',
                                cursor: 'pointer',
                                display: 'inline-block',
                                border: 'none',
                                fontWeight: '600'
                            }}
                            onClick={() => setShowAvatarModal(true)}
                        >
                            {uploadingAvatar ? t('uploading_photo') : (avatarUrl ? t('view_photo') : t('add_photo'))}
                        </button>
                    </div>
                )}
            </div>

            {/* Avatar Management Modal */}
            {showAvatarModal && createPortal(
                <div style={{
                    position: 'fixed',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'var(--scrim)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000,
                    animation: 'fadeIn 0.2s ease-out'
                }}>
                    <div
                        style={{ position: 'absolute', inset: 0 }}
                        onClick={() => setShowAvatarModal(false)}
                    />
                    <div style={{
                        background: 'var(--surface)',
                        padding: '2rem',
                        borderRadius: '12px',
                        width: 'min(calc(100vw - 3rem), 450px)',
                        textAlign: 'center',
                        position: 'relative',
                        zIndex: 10,
                        boxShadow: '0 20px 25px -5px var(--shadow-weak), 0 10px 10px -5px var(--shadow-faint)',
                        animation: 'slideUp 0.3s ease-out',
                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                    }}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--text-main)', marginBottom: '1.5rem', textAlign: 'center' }}>
                            {avatarUrl ? t('manage_photo_title') : t('add_photo')}
                        </h2>

                        <div style={{
                            width: '160px',
                            height: '160px',
                            borderRadius: '50%',
                            margin: '0 auto 2rem',
                            overflow: 'hidden',
                            border: '4px solid var(--surface-subtle)',
                            background: 'var(--surface-sunk)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 4px 6px -1px var(--shadow-weak)'
                        }}>
                            {avatarUrl ? (
                                <Image
                                    src={avatarUrl}
                                    alt="Avatar Large"
                                    width={160}
                                    height={160}
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                                />
                            ) : (
                                <span style={{ fontSize: '4.5rem' }}>
                                    {gender === 'MALE' ? '👨🏻' : '👩🏻'}
                                </span>
                            )}
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexDirection: 'row' }}>
                            <label
                                className="btn btn-primary"
                                style={{
                                    cursor: 'pointer',
                                    padding: '0.625rem 1.25rem',
                                    fontSize: '0.875rem',
                                    flex: 1
                                }}
                            >
                                {avatarUrl ? t('change_button') : t('upload_button')}
                                <input
                                    type="file"
                                    hidden
                                    accept="image/*"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0]
                                        if (file) handleAvatarUpload(file)
                                    }}
                                />
                            </label>

                            {avatarUrl && (
                                <button
                                    type="button"
                                    onClick={() => setShowResetConfirm(true)}
                                    disabled={uploadingAvatar}
                                    style={{
                                        padding: '0.625rem 1.25rem',
                                        border: 'none',
                                        borderRadius: '0.5rem',
                                        background: 'var(--danger-bg)',
                                        cursor: uploadingAvatar ? 'not-allowed' : 'pointer',
                                        fontSize: '0.875rem',
                                        fontWeight: '500',
                                        color: 'var(--danger-solid-hover)',
                                        transition: 'all 0.2s',
                                        flex: 1,
                                        opacity: uploadingAvatar ? 0.5 : 1
                                    }}
                                    onMouseEnter={(e) => !uploadingAvatar && (e.currentTarget.style.background = 'var(--danger-border)')}
                                    onMouseLeave={(e) => !uploadingAvatar && (e.currentTarget.style.background = 'var(--danger-bg)')}
                                >
                                    {t('reset_button')}
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => setShowAvatarModal(false)}
                                disabled={uploadingAvatar}
                                style={{
                                    padding: '0.625rem 1.25rem',
                                    border: '1px solid var(--border)',
                                    borderRadius: '0.5rem',
                                    background: 'var(--surface)',
                                    cursor: uploadingAvatar ? 'not-allowed' : 'pointer',
                                    fontSize: '0.875rem',
                                    fontWeight: '500',
                                    color: 'var(--text-muted)',
                                    transition: 'all 0.2s',
                                    flex: 1,
                                    opacity: uploadingAvatar ? 0.5 : 1
                                }}
                                onMouseEnter={(e) => !uploadingAvatar && (e.currentTarget.style.background = 'var(--surface-subtle)')}
                                onMouseLeave={(e) => !uploadingAvatar && (e.currentTarget.style.background = 'var(--surface)')}
                            >
                                {t('close_button')}
                            </button>
                        </div>
                        {uploadingAvatar && (
                            <div style={{ marginTop: '1rem', color: 'var(--brand-primary)', fontSize: '0.875rem', fontWeight: 'bold' }}>
                                {t('uploading_in_progress')}
                            </div>
                        )}
                        {isResetting && (
                            <div style={{ marginTop: '1rem', color: 'var(--danger-solid-hover)', fontSize: '0.875rem', fontWeight: 'bold' }}>
                                {t('resetting_in_progress')}
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            <ConfirmModal
                isOpen={showResetConfirm}
                title={t('reset_photo_title')}
                message={t('reset_photo_warning')}
                confirmText={t('yes_reset')}
                onConfirm={handleResetPhoto}
                onCancel={() => setShowResetConfirm(false)}
                variant="danger"
            />

            {pendingRequest && (
                <div style={{
                    background: 'var(--warn-bg-yellow-subtle)',
                    border: '1px solid var(--warn-bg)',
                    padding: '1rem',
                    borderRadius: '0.75rem',
                    marginBottom: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    color: 'var(--warn-fg)',
                    textAlign: locale === 'ar' ? 'right' : 'left'
                }}>
                    <span style={{ fontSize: '1.25rem' }}>⏳</span>
                    <div>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{t('name_change_request_pending')}</div>
                        <div style={{ fontSize: '0.8rem' }}>{t('requested_label')}: {pendingRequest.newFirstName} {pendingRequest.newLastName}</div>
                    </div>
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: locale === 'ar' ? '1fr 1fr' : '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('first_name_label')}</label>
                        <input
                            className="input"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            required
                            disabled={isViewMode}
                            style={isViewMode ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('last_name_label')}</label>
                        <input
                            className="input"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            required
                            disabled={isViewMode}
                            style={isViewMode ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                        />
                    </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('gender_label')}</label>
                    <select
                        className="input"
                        value={gender}
                        onChange={e => setGender(e.target.value)}
                        required
                        disabled={isViewMode}
                        style={isViewMode ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                    >
                        <option value="MALE">{t('male')}</option>
                        <option value="FEMALE">{t('female')}</option>
                    </select>
                </div>

                {(userRole === 'SUPER_ADMIN' || role === 'SUPER_ADMIN') && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('company_label')}</label>
                        {role === 'SUPER_ADMIN' ? (
                            <input
                                className="input"
                                value="SHSD"
                                disabled
                                readOnly
                                style={{ background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' }}
                            />
                        ) : (
                            <select
                                className="input"
                                value={companyId}
                                onChange={e => setCompanyId(e.target.value)}
                                disabled={isViewMode}
                                style={isViewMode ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                            >
                                <option value="">{t('select_company')}</option>
                                {companies.map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                            </select>
                        )}
                    </div>
                )}

                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                    <input
                        type="email"
                        className="input"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        disabled={isViewMode || userId === session?.user?.id}
                        style={(isViewMode || userId === session?.user?.id) ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                    />
                </div>

                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('username_label' as any) || 'Username'}</label>
                    <input
                        className="input"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        disabled={isViewMode || userRole !== 'SUPER_ADMIN'}
                        style={(isViewMode || userRole !== 'SUPER_ADMIN') ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                        placeholder={t('username_placeholder' as any) || 'Username'}
                    />
                </div>

                {/* Salary Field - Visible to Admins and Self, Editable only by Admins (not self). Hidden for Admins and Super Admins. */}
                {
                    (can('salary.view') || userId === session?.user?.id) && !['ADMIN', 'SUPER_ADMIN'].includes(role) && role !== '' && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('monthly_base_salary_label')}</label>
                            <input
                                type="number"
                                className="input"
                                value={salary}
                                onChange={e => setSalary(e.target.value)}
                                disabled={isViewMode || userId === session?.user?.id || !can('salary.edit')}
                                max={1000000000}
                                style={(isViewMode || userId === session?.user?.id || !can('salary.edit')) ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                                placeholder={userId === session?.user?.id && !salary ? t('no_data_available') : (locale === 'ar' ? 'أدخل الراتب' : 'Enter salary')}
                            />
                        </div>
                    )
                }

                {/* Day Off Credit Fields - Visible to Admins and Self, Editable only by Admins (not self). Hidden for Admins and Super Admins. */}
                {
                    (can('dayoff.view') || userId === session?.user?.id) && !['ADMIN', 'SUPER_ADMIN'].includes(role) && role !== '' && (
                        <>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('day_off_credit_assigned')}</label>
                                <input
                                    type="number"
                                    className="input"
                                    value={baseDayOffCredit}
                                    onChange={e => setBaseDayOffCredit(e.target.value)}
                                    disabled={isViewMode || userId === session?.user?.id || !can('dayoff.adjust_credit')}
                                    step="0.5"
                                    style={(isViewMode || userId === session?.user?.id || !can('dayoff.adjust_credit')) ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                                />
                            </div>
                        </>
                    )
                }

                {
                    !isViewMode && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('new_password_optional_label')}</label>
                            <div style={{ position: 'relative' }}>
                                <input
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
                    )
                }

                {/* Password reset for Admin/Super Admin viewing another user (F-02:
                    replaces the old password-reveal feature — admins can no longer
                    see a user's actual password, only issue a new temporary one) */}
                {
                    can('employees.reset_password') && isViewMode && userId !== session?.user?.id && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('password')}</label>
                            {issuedTempPassword ? (
                                <div>
                                    <input
                                        type="text"
                                        className="input"
                                        value={issuedTempPassword}
                                        readOnly
                                        style={{ background: 'var(--surface-sunk)', cursor: 'default', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                    />
                                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--warn-fg-mid)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {t('temp_password_warning' as any)}
                                    </p>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => {
                                        setVerificationCallback({ type: 'RESET_PASSWORD' })
                                        setVerificationModalOpen(true)
                                    }}
                                >
                                    {t('reset_password_button' as any)}
                                </button>
                            )}
                        </div>
                    )
                }
                {
                    can('employees.assign_role') && userId !== session?.user?.id && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('role_label')}</label>
                            <select
                                className="input"
                                value={role}
                                onChange={e => setRole(e.target.value)}
                                required
                                disabled={isViewMode || userId === session?.user?.id || role === 'SUPER_ADMIN'}
                                style={(isViewMode || userId === session?.user?.id || role === 'SUPER_ADMIN') ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
                            >
                                <option value="EMPLOYEE">{t('role_employee')}</option>
                                <option value="TEAM_LEADER">{t('role_team_leader')}</option>
                                {(userRole === 'SUPER_ADMIN' || role === 'ADMIN') && <option value="ADMIN">{t('role_admin')}</option>}
                                {role === 'SUPER_ADMIN' && <option value="SUPER_ADMIN">{t('super_admins')}</option>}
                            </select>
                        </div>
                    )
                }

                {
                    /* Read-only, and only on your own profile. Everywhere else
                       the field above is an Admin's control; here it is simply
                       information, because knowing who manages you is not
                       something you should have to ask a colleague for. */
                    userId === session?.user?.id && role === 'EMPLOYEE' && (
                        <div style={{ marginBottom: '1rem' }}>
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
                    canAssignTeam
                        && userId !== session?.user?.id
                        && role === 'EMPLOYEE' && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('team_leader_label')}</label>
                            <select
                                className="input"
                                value={teamLeaderId}
                                onChange={e => setTeamLeaderId(e.target.value)}
                                disabled={isViewMode}
                                style={isViewMode ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', color: 'var(--text-soft)', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
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
                    can('employees.change_status') && userId !== session?.user?.id && (
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('status_label' as any) || (locale === 'ar' ? 'الحالة' : 'Status')}</label>
                            <select
                                className="input"
                                value={status}
                                onChange={e => setStatus(e.target.value)}
                                required
                                disabled={isViewMode || status === 'ARCHIVED'}
                                style={isViewMode ? { background: 'var(--surface-sunk)', cursor: 'not-allowed', textAlign: locale === 'ar' ? 'right' : 'left' } : { textAlign: locale === 'ar' ? 'right' : 'left' }}
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

                            {/*
                              Deliberately not a fourth option in the dropdown.
                              Ending a contract is not the same kind of act as
                              marking somebody offline: it has a date, it has a
                              settlement that falls one way or the other, and it
                              is the one status change that cannot be undone by
                              picking the previous value again. A separate
                              action, with the settlement shown first.

                              On the profile view, not the edit form: it saves
                              on its own through its own confirmation, so it
                              never needed the form, and next to Update it read
                              as though Update would apply it.
                            */}
                            {isViewMode && (
                                <button
                                    type="button"
                                    className="btn"
                                    onClick={() => setShowEndContract(true)}
                                    style={{
                                        marginTop: '0.75rem',
                                        background: 'transparent',
                                        color: status === 'ARCHIVED' ? 'var(--primary)' : 'var(--danger-solid)',
                                        border: `1px solid ${status === 'ARCHIVED' ? 'var(--primary)' : 'var(--danger-border)'}`,
                                        fontSize: '0.85rem',
                                    }}
                                >
                                    {status === 'ARCHIVED' ? t('reinstate') : t('end_contract')}
                                </button>
                            )}
                        </div>
                    )
                }

                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: isViewMode ? 'flex-end' : 'flex-start', flexDirection: 'row' }}>
                    {!isViewMode && (
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? t('updating_button') : t('update_button')}
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn"
                        style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                        onClick={onClose || (() => router.back())}
                    >
                        {t('close_button')}
                    </button>
                </div>
            </form >

            {
                showEndContract && (
                    <EndContractModal
                        userId={userId}
                        name={`${firstName} ${lastName}`.trim() || email}
                        status={status}
                        onClose={() => setShowEndContract(false)}
                        onDone={() => { setReloadKey(k => k + 1); router.refresh() }}
                    />
                )
            }

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
            {
                verificationModalOpen && createPortal(
                    <div className="modal-overlay">
                        <div className="modal-content" style={{ maxWidth: '400px', width: '90%' }}>
                            <div className="modal-header">
                                <h3 className="modal-title">{t('verify_identity')}</h3>
                                <button
                                    className="modal-close"
                                    onClick={() => {
                                        setVerificationModalOpen(false)
                                        setVerificationPassword('')
                                        setVerificationCallback(null)
                                    }}
                                >
                                    &times;
                                </button>
                            </div>
                            <div className="modal-body" style={{ textAlign: 'center' }}>
                                <div style={{
                                    width: '64px',
                                    height: '64px',
                                    background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    margin: '0 auto 1.5rem',
                                    color: 'var(--primary)'
                                }}>
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                    </svg>
                                </div>
                                <p style={{ marginBottom: '1.5rem', fontSize: '1rem', color: 'var(--text-muted)', fontWeight: '500' }}>
                                    {t('enter_password_confirm')}
                                </p>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type={showVerificationPassword ? "text" : "password"}
                                        className="input"
                                        placeholder={t('enter_your_password')}
                                        value={verificationPassword}
                                        onChange={(e) => setVerificationPassword(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && verificationPassword && !isVerifying) {
                                                if (verificationCallback?.type === 'UPDATE') {
                                                    handleVerifyAndUpdate(verificationPassword)
                                                } else {
                                                    handleResetPassword(verificationPassword)
                                                }
                                            }
                                        }}
                                        autoFocus
                                        style={{
                                            textAlign: locale === 'ar' ? 'right' : 'left',
                                            height: '54px',
                                            fontSize: '1.125rem',
                                            borderRadius: '1.25rem',
                                            paddingRight: (locale === 'ar' ? '1rem' : '3.5rem'),
                                            paddingLeft: (locale === 'ar' ? '3.5rem' : '1rem'),
                                            background: 'var(--surface-subtle)',
                                            border: '2px solid var(--border)',
                                            boxShadow: 'inset 0 2px 4px 0 var(--shadow-faint)'
                                        }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowVerificationPassword(!showVerificationPassword)}
                                        style={{
                                            position: 'absolute',
                                            [locale === 'ar' ? 'left' : 'right']: '1rem',
                                            top: '50%',
                                            transform: 'translateY(-50%)',
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            padding: '0.5rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            color: 'var(--text-soft)'
                                        }}
                                    >
                                        {showVerificationPassword ? (
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                                <line x1="1" y1="1" x2="23" y2="23"></line>
                                            </svg>
                                        ) : (
                                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                                <circle cx="12" cy="12" r="3"></circle>
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </div>
                            <div className="modal-footer" style={{ background: 'var(--surface)', borderTop: 'none', paddingBottom: '2.5rem', justifyContent: 'center' }}>
                                <button
                                    className="btn"
                                    style={{ background: 'var(--surface-sunk)', color: 'var(--text-soft)', minWidth: '100px' }}
                                    onClick={() => {
                                        setVerificationModalOpen(false)
                                        setVerificationPassword('')
                                        setVerificationCallback(null)
                                    }}
                                >
                                    {t('cancel')}
                                </button>
                                <button
                                    className="btn btn-primary"
                                    style={{ minWidth: '140px' }}
                                    onClick={() => {
                                        if (verificationPassword && !isVerifying) {
                                            if (verificationCallback?.type === 'UPDATE') {
                                                handleVerifyAndUpdate(verificationPassword)
                                            } else {
                                                handleResetPassword(verificationPassword)
                                            }
                                        }
                                    }}
                                    disabled={!verificationPassword || isVerifying}
                                >
                                    {isVerifying ? (
                                        <>
                                            <div className="animate-spin" style={{ width: '16px', height: '16px', border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', marginRight: '8px' }}></div>
                                            {t('verifying')}
                                        </>
                                    ) : t('confirm')}
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            }
        </div >
    )
}
