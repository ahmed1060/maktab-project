'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useToast } from '@/context/ToastContext'

type EmployeeProfileFormProps = {
    userId: string
    isViewMode?: boolean
    onClose?: () => void
}

export default function EmployeeProfileForm({ userId, isViewMode = false, onClose }: EmployeeProfileFormProps) {
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
    const router = useRouter()
    const { data: session, update } = useSession()
    const { showToast } = useToast()
    const userRole = session?.user?.role || ''

    useEffect(() => {
        const fetchEmployee = async () => {
            try {
                // Determine API endpoint: If fetching DELETED user, we might need special handling?
                // The current GET /api/users?id=... handles finding user by ID regardless of status if caller is admin.
                // However, the LIST endpoint filters out deleted. The ID endpoint (lines 31-50 of route.ts) does findUnique, which typically finds even deleted records unless using soft-delete middleware (not used here).
                // So it should work.
                const res = await fetch(`/api/users?id=${userId}`, { cache: 'no-store' })
                if (!res.ok) throw new Error('Failed to fetch employee')
                const employee = await res.json()

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
            } catch {
                showToast('Failed to load employee data', 'error')
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

        if (userId) fetchEmployee()
        if (userRole === 'SUPER_ADMIN') {
            fetchCompanies()
        }
    }, [userId, userRole, showToast])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)

        // Validation
        const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/
        if (!emailRegex.test(email)) {
            showToast('Email must be in format: user(max 20)@domain(max 10).com', 'error')
            setSaving(false)
            return
        }

        if (salary && parseFloat(salary) > 1000000000) {
            showToast('Salary cannot exceed 1 billion EGP', 'error')
            setSaving(false)
            return
        }

        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                body: JSON.stringify({
                    id: userId,
                    firstName,
                    lastName,
                    email,
                    password: password || undefined,
                    role,
                    gender,
                    companyId: userRole === 'SUPER_ADMIN' ? companyId : undefined,
                    salary: (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') && userId !== session?.user?.id ? parseFloat(salary) || 0 : undefined
                }),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Failed to update employee')
            }

            // Sync Logic
            if (userId === session?.user?.id) {
                await update({
                    firstName,
                    lastName,
                    gender,
                    // If avatar was updated (not currently handled in form but good practice)
                })
                showToast('Profile updated successfully!', 'success')
                showToast('Log out and back in to see avatar changes in sidebar.', 'info')
                setSaving(false)
                router.refresh()
            } else {
                showToast('Employee updated successfully!', 'success')
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
            showToast(err.message || 'Failed to update employee', 'error')
            setSaving(false)
        }
    }

    if (loading) return <div>Loading...</div>


    return (
        <div className="glass-card" style={{ maxWidth: '600px', margin: '0 auto', padding: onClose ? '0' : '2rem' }}>
            {!onClose && (
                <h1 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', fontWeight: 'bold' }}>
                    {isViewMode ? 'Employee Profile' : (userId === session?.user?.id ? 'Profile' : 'Edit Employee')}
                </h1>
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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>First Name</label>
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
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Last Name</label>
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
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Gender</label>
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
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Company</label>
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
                <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Email</label>
                    <input
                        type="email"
                        className="input"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        disabled={isViewMode || userId === session?.user?.id}
                        style={(isViewMode || userId === session?.user?.id) ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                    />
                </div>

                {/* Salary Field - Visible to Admins and Self, Editable only by Admins (not self) */}
                {(['ADMIN', 'SUPER_ADMIN'].includes(userRole) || userId === session?.user?.id) && role !== 'SUPER_ADMIN' && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Monthly Base Salary (EGP)</label>
                        <input
                            type="number"
                            className="input"
                            value={salary}
                            onChange={e => setSalary(e.target.value)}
                            disabled={isViewMode || userId === session?.user?.id || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)}
                            max={1000000000}
                            style={(isViewMode || userId === session?.user?.id || !['ADMIN', 'SUPER_ADMIN'].includes(userRole)) ? { background: '#f1f5f9', cursor: 'not-allowed' } : {}}
                            placeholder={userId === session?.user?.id && !salary ? 'Not set' : ''}
                        />
                    </div>
                )}

                {!isViewMode && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>New Password (optional)</label>
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
                {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && userId !== session?.user?.id && (
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Role</label>
                        <select
                            className="input"
                            value={role}
                            onChange={e => setRole(e.target.value)}
                            required
                            disabled={isViewMode || userId === session?.user?.id || role === 'SUPER_ADMIN'}
                            style={(isViewMode || userId === session?.user?.id || role === 'SUPER_ADMIN') ? { background: '#f1f5f9', cursor: 'not-allowed', color: '#64748b' } : {}}
                        >
                            <option value="EMPLOYEE">Employee</option>
                            <option value="TEAM_LEADER">Team Leader</option>
                            {userRole === 'SUPER_ADMIN' && <option value="ADMIN">Admin</option>}
                            {role === 'SUPER_ADMIN' && <option value="SUPER_ADMIN">Super Admin</option>}
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
                        onClick={onClose || (() => router.back())}
                    >
                        {onClose ? 'Close' : 'Close'}
                    </button>
                </div>
            </form>
        </div>
    )
}
