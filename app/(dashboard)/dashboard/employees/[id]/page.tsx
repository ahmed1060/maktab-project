'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'

export default function EditEmployeePage({ params, searchParams }: { params: { id: string }, searchParams: { mode?: string } }) {
    const isViewMode = searchParams.mode === 'view'
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('')
    const [gender, setGender] = useState('MALE')
    const [salary, setSalary] = useState<string>('')
    const [companyId, setCompanyId] = useState('')
    const [companies, setCompanies] = useState<{ id: string, name: string }[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(false)
    const router = useRouter()
    const { data: session, update } = useSession()
    const userRole = session?.user?.role || ''

    useEffect(() => {
        const fetchEmployee = async () => {
            try {
                const res = await fetch(`/api/users?id=${params.id}`, { cache: 'no-store' })
                if (!res.ok) throw new Error('Failed to fetch employee')
                const employee = await res.json()
                // Handle both old name field (if exists) and new fields
                if (employee.firstName) {
                    setFirstName(employee.firstName)
                    setLastName(employee.lastName)
                } else if (employee.name) {
                    const parts = employee.name.split(' ')
                    setFirstName(parts[0] || '')
                    setLastName(parts.slice(1).join(' ') || '')
                }
                setEmail(employee.email)
                setRole(employee.role)
                setGender(employee.gender || 'MALE')
                setSalary(employee.salary !== undefined && employee.salary !== null ? employee.salary.toString() : '')
                setCompanyId(employee.companyId || '')
            } catch (err) {
                setError('Failed to load employee data')
            } finally {
                setLoading(false)
            }
        }

        const fetchCompanies = async () => {
            try {
                const res = await fetch('/api/companies')
                if (res.ok) {
                    const data = await res.json()
                    setCompanies(data)
                }
            } catch (e) {
                console.error('Failed to fetch companies', e)
            }
        }

        fetchEmployee()
        if (userRole === 'SUPER_ADMIN') {
            fetchCompanies()
        }
    }, [params.id, userRole])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        setError('')
        setSuccess(false)

        // Validation
        const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/
        if (!emailRegex.test(email)) {
            setError('Email must be in format: user(max 20)@domain(max 10).com')
            setSaving(false)
            return
        }

        if (salary && parseFloat(salary) > 1000000000) {
            setError('Salary cannot exceed 1 billion EGP')
            setSaving(false)
            return
        }

        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                body: JSON.stringify({
                    id: params.id,
                    firstName,
                    lastName,
                    email,
                    password: password || undefined,

                    role,
                    gender,
                    companyId: userRole === 'SUPER_ADMIN' ? companyId : undefined,
                    salary: (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') && params.id !== session?.user?.id ? parseFloat(salary) || 0 : undefined
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to update employee')
            }


            // If user is editing their own profile, update session to refresh sidebar
            if (params.id === session?.user?.id) {
                setSuccess(true)
                setSaving(false)
                // Scroll to top to show success message
                window.scrollTo({ top: 0, behavior: 'smooth' })

                // Trigger session update - this will refetch from the database
                setTimeout(async () => {
                    await update()
                    window.location.reload()
                }, 1000)
            } else {
                // Show success message then redirect
                setSuccess(true)
                setSaving(false)
                window.scrollTo({ top: 0, behavior: 'smooth' })

                setTimeout(() => {
                    router.push('/dashboard/employees')
                    router.refresh()
                }, 1500)
            }
        } catch (err: any) {
            setError(err.message || 'Failed to update employee')
            setSaving(false)
        }
    }

    if (loading) return <div>Loading...</div>
    if (error) return (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <div style={{ color: '#991b1b', background: '#fee2e2', padding: '1rem', borderRadius: '0.5rem' }}>
                Error: {error}
            </div>
            <button
                onClick={() => router.push('/dashboard/employees')}
                className="btn"
                style={{ marginTop: '1rem', background: '#e2e8f0', color: '#0f172a' }}
            >
                Back to Employees
            </button>
        </div>
    )

    return (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h1 style={{ marginBottom: '1.5rem' }}>
                {isViewMode ? 'Employee Profile' : (params.id === session?.user?.id ? 'Profile' : 'Edit Employee')}
            </h1>

            {success && (
                <div style={{
                    padding: '1rem',
                    marginBottom: '1.5rem',
                    background: '#d1fae5',
                    color: '#065f46',
                    borderRadius: '0.5rem',
                    border: '1px solid #10b981',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                }}>
                    <span style={{ fontSize: '1.25rem' }}>✓</span>
                    <div>
                        <div>Profile updated successfully!</div>
                        {params.id === session?.user?.id && (
                            <div style={{ fontSize: '0.875rem', marginTop: '0.25rem', opacity: 0.8 }}>
                                Log out and back in to see your avatar changes in the sidebar.
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '2rem' }}>
                <div style={{
                    width: '100px',
                    height: '100px',
                    borderRadius: '50%',
                    background: '#e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '4px solid white',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
                }}>
                    <span style={{ fontSize: '2.5rem' }}>
                        {gender === 'MALE' ? '👨🏻' : '👩🏻'}
                    </span>
                </div>
            </div>

            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>First Name</label>
                        <input
                            className="input"
                            value={firstName}
                            onChange={e => setFirstName(e.target.value)}
                            required
                            disabled={isViewMode}
                            style={isViewMode ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                        />

                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Last Name</label>
                        <input
                            className="input"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            required
                            disabled={isViewMode}
                            style={isViewMode ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                        />

                    </div>
                </div>

                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Gender</label>
                    <select
                        className="input"
                        value={gender}
                        onChange={e => setGender(e.target.value)}

                        required
                        disabled={isViewMode}
                        style={isViewMode ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                    >
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                    </select>
                </div>

                {userRole === 'SUPER_ADMIN' && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Company</label>
                        <select
                            className="input"
                            value={companyId}
                            onChange={e => setCompanyId(e.target.value)}
                            disabled={isViewMode}
                            style={isViewMode ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                        >
                            <option value="">Select Company</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Email</label>
                    <input
                        type="email"
                        className="input"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        disabled={isViewMode || params.id === session?.user?.id}
                        style={(isViewMode || params.id === session?.user?.id) ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                    />
                </div>

                {/* Salary Field - Visible to Admins and Self, Editable only by Admins (not self) */}
                {/* Salary Field - Visible to Admins and Self, Editable only by Admins (not self) - HIDDEN for Super Admins */}
                {(['ADMIN', 'SUPER_ADMIN'].includes(userRole) || params.id === session?.user?.id) && role !== 'SUPER_ADMIN' && (
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Monthly Base Salary (EGP)</label>
                        <input
                            type="number"
                            className="input"
                            value={salary}
                            onChange={e => setSalary(e.target.value)}
                            // Disabled if:
                            // 1. View Mode
                            // 2. User is viewing their own profile
                            // 3. User is NOT an Admin (Employee viewing self).
                            disabled={isViewMode || params.id === session?.user?.id || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)}
                            max={1000000000}
                            style={(isViewMode || params.id === session?.user?.id || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                            placeholder={params.id === session?.user?.id && !salary ? 'Not set' : ''}
                        />
                    </div>
                )}

                {!isViewMode && (
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>New Password (optional)</label>
                        <input
                            type="password"
                            className="input"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            minLength={6}
                            maxLength={20}
                            placeholder="Leave empty to keep current password"
                        />
                    </div>
                )}
                {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && params.id !== session?.user?.id && (
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Role</label>
                        <select
                            className="input"
                            value={role}
                            onChange={e => setRole(e.target.value)}
                            required
                            disabled={isViewMode || params.id === session?.user?.id}
                            style={(isViewMode || params.id === session?.user?.id) ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                        >
                            <option value="EMPLOYEE">Employee</option>
                            <option value="TEAM_LEADER">Team Leader</option>
                            {userRole === 'SUPER_ADMIN' && <option value="ADMIN">Admin</option>}
                            {userRole === 'SUPER_ADMIN' && <option value="SUPER_ADMIN">Super Admin</option>}
                        </select>
                    </div>
                )}
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: isViewMode ? 'flex-end' : 'flex-start' }}>
                    {!isViewMode && (
                        <button type="submit" className="btn btn-primary" disabled={saving}>
                            {saving ? 'Updating...' : 'Update'}
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn"
                        style={{ background: '#e2e8f0', color: '#0f172a' }}
                        onClick={() => router.push('/dashboard/employees')}
                    >
                        Close
                    </button>
                </div>
            </form>
        </div>
    )
}
