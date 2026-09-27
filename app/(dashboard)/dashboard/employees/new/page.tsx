'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useCan } from '@/lib/useCan'
import RoleSelect from '@/components/RoleSelect'

type Company = {
    id: string
    name: string
}

export const dynamic = 'force-dynamic'

export default function NewEmployeePage() {
    const { t, locale } = useLanguage()
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
    const [companies, setCompanies] = useState<Company[]>([])
    const [teamLeaderId, setTeamLeaderId] = useState('')
    const [leaders, setLeaders] = useState<{ id: string; firstName: string; lastName: string }[]>([])
    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const router = useRouter()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const { can } = useCan()
    const canAssignTeam = can('employees.assign_team')
    const canAssignRole = can('employees.assign_role')

    useEffect(() => {
        if (userRole === 'SUPER_ADMIN') {
            fetch('/api/companies?limit=1000')
                .then(res => res.json())
                .then(result => {
                    const companiesData = result.data?.data || []
                    setCompanies(Array.isArray(companiesData) ? companiesData : [])
                })
                .catch(err => console.error('Failed to fetch companies', err))
        }
        // Asked for by role rather than fetched wholesale and filtered here.
        if (canAssignTeam) {
            fetch('/api/users?role=TEAM_LEADER&limit=1000')
                .then(res => res.json())
                .then(result => setLeaders(result.data?.data || []))
                .catch(err => console.error('Failed to fetch team leaders', err))
        }
    }, [userRole, canAssignTeam])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setFieldErrors({})
        setLoading(true)

        // Was /^[^@]{1,20}@[^@]{1,10}\.com$/, which rejected most real
        // addresses (subdomains, non-.com TLDs, longer local parts). The
        // backend already validates properly (user.schema.ts), this is just
        // a quick client-side check before that round trip.
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

        const errors: { [key: string]: string } = {}
        if (!emailRegex.test(email)) {
            errors.email = "Email must be in format: user(max 20)@domain(max 10).com"
        }
        if (!firstName || firstName.length > 15) errors.firstName = "First Name max 15 chars"
        if (!lastName || lastName.length > 15) errors.lastName = "Last Name max 15 chars"
        if (!password || password.length < 12 || password.length > 72) errors.password = "Password must be 12-72 chars"

        if (Object.keys(errors).length > 0) {
            setFieldErrors(errors)
            setLoading(false)
            return
        }

        if (userRole === 'SUPER_ADMIN' && !companyId) {
            setError('Company is required for Super Admin')
            setLoading(false)
            return
        }

        try {
            const body: any = { firstName, lastName, email, password, role: roleId ? role : 'EMPLOYEE', ...(roleId ? { roleId } : {}) }
            if (userRole === 'SUPER_ADMIN' && companyId) {
                body.companyId = companyId
            }
            if (salary) {
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
                body: JSON.stringify({
                    ...body,
                    dayOffCredit: parseFloat(dayOffCredit) || 0
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const text = await res.text()
                if (text.includes("Username already in use")) {
                    setError(locale === 'ar' ? 'اسم المستخدم مستخدم بالفعل' : 'Username already in use')
                } else {
                    setError(text || 'Failed to create user')
                }
                setLoading(false)
                return
            }

            router.push('/dashboard/employees')
            router.refresh()
        } catch {
            setError('An error occurred')
            setLoading(false)
        }
    }

    return (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h1 style={{ marginBottom: '1.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                {userRole === 'SUPER_ADMIN' ? t('add_new_user_title') : t('add_employee')}
            </h1>
            {error && (
                <div style={{
                    padding: '0.75rem',
                    marginBottom: '1rem',
                    background: 'var(--danger-bg)',
                    color: 'var(--danger-fg)',
                    borderRadius: '0.5rem'
                }}>
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('first_name_label')}</label>
                        <input
                            className="input"
                            value={firstName}
                            onChange={e => {
                                setFirstName(e.target.value)
                                if (fieldErrors.firstName) setFieldErrors({ ...fieldErrors, firstName: '' })
                            }}
                            style={{
                                ...(fieldErrors.firstName ? { borderColor: 'var(--danger-solid)' } : {}),
                                textAlign: locale === 'ar' ? 'right' : 'left'
                            }}
                            required
                            maxLength={15}
                            placeholder={locale === 'ar' ? 'جون' : "John"}
                        />
                        {fieldErrors.firstName && (
                            <div style={{ color: 'var(--danger-solid)', fontSize: '0.85rem', marginTop: '0.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                {fieldErrors.firstName}
                            </div>
                        )}
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('last_name_label')}</label>
                        <input
                            className="input"
                            value={lastName}
                            onChange={e => {
                                setLastName(e.target.value)
                                if (fieldErrors.lastName) setFieldErrors({ ...fieldErrors, lastName: '' })
                            }}
                            style={{
                                ...(fieldErrors.lastName ? { borderColor: 'var(--danger-solid)' } : {}),
                                textAlign: locale === 'ar' ? 'right' : 'left'
                            }}
                            required
                            maxLength={15}
                            placeholder={locale === 'ar' ? 'دو' : "Doe"}
                        />
                        {fieldErrors.lastName && (
                            <div style={{ color: 'var(--danger-solid)', fontSize: '0.85rem', marginTop: '0.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                {fieldErrors.lastName}
                            </div>
                        )}
                    </div>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                    <input
                        type="email"
                        className="input"
                        value={email}
                        onChange={e => {
                            setEmail(e.target.value)
                            if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' })
                        }}
                        style={{
                            ...(fieldErrors.email ? { borderColor: 'var(--danger-solid)' } : {}),
                            textAlign: locale === 'ar' ? 'right' : 'left'
                        }}
                        required
                        placeholder="john@example.com"
                    />
                    {fieldErrors.email && (
                        <div style={{ color: 'var(--danger-solid)', fontSize: '0.85rem', marginTop: '0.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            {fieldErrors.email}
                        </div>
                    )}
                </div>

                <div style={{ position: 'relative' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('password')}</label>
                    <input
                        type={showPassword ? "text" : "password"}
                        className="input"
                        value={password}
                        onChange={e => {
                            setPassword(e.target.value)
                            if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' })
                        }}
                        style={{
                            ...(fieldErrors.password ? { borderColor: 'var(--danger-solid)' } : {}),
                            paddingRight: locale === 'ar' ? '1rem' : '2.5rem',
                            paddingLeft: locale === 'ar' ? '2.5rem' : '1rem',
                            textAlign: locale === 'ar' ? 'right' : 'left'
                        }}
                        required
                        minLength={12}
                        maxLength={72}
                        placeholder={locale === 'ar' ? '١٢ حرفًا على الأقل' : "Minimum 12 characters"}
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                            position: 'absolute',
                            [locale === 'ar' ? 'left' : 'right']: '0.75rem',
                            top: '2.25rem',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '0.25rem',
                            display: 'flex',
                            alignItems: 'center',
                            color: 'var(--text-soft)'
                        }}
                    >
                        {showPassword ? (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                            </svg>
                        ) : (
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                <circle cx="12" cy="12" r="3"></circle>
                            </svg>
                        )}
                    </button>
                    {fieldErrors.password && (
                        <div style={{ color: 'var(--danger-solid)', fontSize: '0.85rem', marginTop: '0.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                            {fieldErrors.password}
                        </div>
                    )}
                </div>

                {!['ADMIN', 'SUPER_ADMIN'].includes(role) && role !== '' && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('monthly_base_salary_label')}</label>
                        <input
                            type="number"
                            className="input"
                            value={salary}
                            onChange={e => setSalary(e.target.value)}
                            min="0"
                            placeholder="0.00"
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        />
                    </div>
                )}

                {(role === 'EMPLOYEE' || role === 'TEAM_LEADER') && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('day_off_credit')}</label>
                        <input
                            type="number"
                            className="input"
                            value={dayOffCredit}
                            onChange={e => setDayOffCredit(e.target.value)}
                            min="0"
                            step="0.5"
                            placeholder="0"
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        />
                    </div>
                )}

                {userRole === 'SUPER_ADMIN' && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('company_label')}</label>
                        <select
                            className="input"
                            value={companyId}
                            onChange={e => { setCompanyId(e.target.value); setRoleId(''); setRole('EMPLOYEE') }}
                            required
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        >
                            <option value="">{t('select_company_placeholder')}</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {canAssignRole && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('role_label')}</label>
                        <RoleSelect
                            companyId={companyId}
                            value={roleId}
                            allowDefault
                            onChange={(id, chosen) => { setRoleId(id); setRole(chosen?.baseRole ?? 'EMPLOYEE') }}
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        />
                    </div>
                )}
                {role === 'EMPLOYEE' && canAssignTeam && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('team_leader_label')}</label>
                        <select
                            className="input"
                            value={teamLeaderId}
                            onChange={e => setTeamLeaderId(e.target.value)}
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        >
                            <option value="">{t('team_leader_none')}</option>
                            {leaders.map(l => (
                                <option key={l.id} value={l.id}>{l.firstName} {l.lastName}</option>
                            ))}
                        </select>
                        <p style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: 'var(--text-faint)', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('team_leader_hint')}</p>
                    </div>
                )}
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? t('creating') : userRole === 'SUPER_ADMIN' ? t('create_user_button') : t('create_employee_button')}
                    </button>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: 'var(--border)', color: 'var(--text-strong)' }}
                        onClick={() => router.push('/dashboard/employees')}
                    >
                        {t('cancel')}
                    </button>
                </div>
            </form>
        </div>
    )
}
