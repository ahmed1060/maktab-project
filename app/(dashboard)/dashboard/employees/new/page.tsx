'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

export default function NewEmployeePage() {
    const [firstName, setFirstName] = useState('')
    const [lastName, setLastName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [role, setRole] = useState('EMPLOYEE')
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const router = useRouter()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setLoading(true)

        try {
            const res = await fetch('/api/users', {
                method: 'POST',
                body: JSON.stringify({ firstName, lastName, email, password, role }),
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
                            onChange={e => setFirstName(e.target.value)}
                            required
                            placeholder="John"
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem' }}>Last Name</label>
                        <input
                            className="input"
                            value={lastName}
                            onChange={e => setLastName(e.target.value)}
                            required
                            placeholder="Doe"
                        />
                    </div>
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Email</label>
                    <input
                        type="email"
                        className="input"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        required
                        placeholder="john@example.com"
                    />
                </div>
                <div>
                    <label style={{ display: 'block', marginBottom: '0.5rem' }}>Password</label>
                    <input
                        type="password"
                        className="input"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        required
                        minLength={6}
                        placeholder="Minimum 6 characters"
                    />
                </div>
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
