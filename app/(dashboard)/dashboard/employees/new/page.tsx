'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

type Company = {
    id: string
    name: string
}

export default function NewEmployeePage() {
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('EMPLOYEE')
    const [companyId, setCompanyId] = useState('')
    const [salary, setSalary] = useState('')
    const [companies, setCompanies] = useState<Company[]>([])
    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({})
    const [loading, setLoading] = useState(false)
    const [showPassword, setShowPassword] = useState(false)
    const router = useRouter()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''

    useEffect(() => {
        if (userRole === 'SUPER_ADMIN') {
            fetch('/api/companies')
                .then(res => res.json())
                .then(data => setCompanies(data))
                .catch(err => console.error('Failed to fetch companies', err))
        }
    }, [userRole])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setFieldErrors({})
        setLoading(true)

        // Regex: ^ (start) [^@]{1,20} (1-20 chars user) @ [^@]{1,10} (1-10 chars domain) \.com$
        const emailRegex = /^[^@]{1,20}@[^@]{1,10}\.com$/

        const errors: { [key: string]: string } = {}
        if (!emailRegex.test(email)) {
            errors.email = "Email must be in format: user(max 20)@domain(max 10).com"
        }
        if (!firstName || firstName.length > 15) errors.firstName = "First Name max 15 chars"
        if (!lastName || lastName.length > 15) errors.lastName = "Last Name max 15 chars"
        if (!password || password.length < 6 || password.length > 20) errors.password = "Password must be 6-20 chars"

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
            const body: any = { firstName, lastName, email, password, role }
            if (userRole === 'SUPER_ADMIN' && companyId) {
                body.companyId = companyId
            }
            if (salary) {
                body.salary = parseFloat(salary)
            }

            const res = await fetch('/api/users', {
                method: 'POST',
                body: JSON.stringify(body),
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) {
                const text = await res.text()
                setError(text || 'Failed to create user')
                setLoading(false)
                return
            }

            router.push('/dashboard/employees')
            router.refresh()
        } catch (err) {
            setError('An error occurred')
            setLoading(false)
        }
    }

    return (
        <div className="card" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <h1 style={{ marginBottom: '1.5rem' }}>
                {userRole === 'SUPER_ADMIN' ? 'Add New User' : 'Add New Employee'}
            </h1>
            {error && (
                <div style={{
                    padding: '0.75rem',
                    marginBottom: '1rem',
                    background: '#fee2e2',
                    color: '#991b1b',
                    borderRadius: '0.5rem'
                }}>
                    {error}
                </div>
            )}
            <form onSubmit={handleSubmit}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>First Name</label>
                        <input
                            className="input"
                            value={firstName}
                            onChange={e => {
                                setFirstName(e.target.value)
                                if (fieldErrors.firstName) setFieldErrors({ ...fieldErrors, firstName: '' })
                            }}
                            style={fieldErrors.firstName ? { borderColor: '#ef4444' } : {}}
                            required
                            maxLength={15}
                            placeholder="John"
                        />
                        {fieldErrors.firstName && (
                            <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                                {fieldErrors.firstName}
                            </div>
                        )}
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Last Name</label>
                        <input
                            className="input"
                            value={lastName}
                            onChange={e => {
                                setLastName(e.target.value)
                                if (fieldErrors.lastName) setFieldErrors({ ...fieldErrors, lastName: '' })
                            }}
                            style={fieldErrors.lastName ? { borderColor: '#ef4444' } : {}}
                            required
                            maxLength={15}
                            placeholder="Doe"
                        />
                        {fieldErrors.lastName && (
                            <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                                {fieldErrors.lastName}
                            </div>
                        )}
                    </div>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Email</label>
                    <input
                        type="email"
                        className="input"
                        value={email}
                        onChange={e => {
                            setEmail(e.target.value)
                            if (fieldErrors.email) setFieldErrors({ ...fieldErrors, email: '' })
                        }}
                        style={fieldErrors.email ? { borderColor: '#ef4444' } : {}}
                        required
                        placeholder="john@example.com"
                    />
                    {fieldErrors.email && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.email}
                        </div>
                    )}
                </div>
                <div style={{ position: 'relative' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Password</label>
                    <input
                        type={showPassword ? "text" : "password"}
                        className="input"
                        value={password}
                        onChange={e => {
                            setPassword(e.target.value)
                            if (fieldErrors.password) setFieldErrors({ ...fieldErrors, password: '' })
                        }}
                        style={{
                            ...(fieldErrors.password ? { borderColor: '#ef4444' } : {}),
                            paddingRight: '2.5rem'
                        }}
                        required
                        minLength={6}
                        maxLength={20}
                        placeholder="Minimum 6 characters"
                    />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        style={{
                            position: 'absolute',
                            right: '0.75rem',
                            top: '2.25rem',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '0.25rem',
                            display: 'flex',
                            alignItems: 'center',
                            color: '#64748b'
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
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldErrors.password}
                        </div>
                    )}
                </div>

                {/* Salary Input */}
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Monthly Salary ($)</label>
                    <input
                        type="number"
                        className="input"
                        value={salary}
                        onChange={e => setSalary(e.target.value)}
                        min="0"
                        placeholder="0.00"
                    />
                </div>

                {/* Company Selection for Super Admin */}
                {userRole === 'SUPER_ADMIN' && (
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Company</label>
                        <select
                            className="input"
                            value={companyId}
                            onChange={e => setCompanyId(e.target.value)}
                            required
                        >
                            <option value="">Select a Company</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                        </select>
                    </div>
                )}

                {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && (
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Role</label>
                        <select
                            className="input"
                            value={role}
                            onChange={e => setRole(e.target.value)}
                            required
                        >
                            <option value="EMPLOYEE">Employee</option>
                            <option value="TEAM_LEADER">Team Leader</option>
                            {userRole === 'SUPER_ADMIN' && <option value="ADMIN">Admin</option>}
                        </select>
                    </div>
                )}
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Creating...' : userRole === 'SUPER_ADMIN' ? 'Create User' : 'Create Employee'}
                    </button>
                    <button
                        type="button"
                        className="btn"
                        style={{ background: '#e2e8f0', color: '#0f172a' }}
                        onClick={() => router.push('/dashboard/employees')}
                    >
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    )
}
