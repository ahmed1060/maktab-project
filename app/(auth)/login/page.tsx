'use client'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const router = useRouter()

    const [loading, setLoading] = useState(false)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        try {
            console.log('Attempting login with:', email)
            const res = await signIn('credentials', {
                email,
                password,
                redirect: false,
            })
            console.log('Login response:', res)

            if (res?.error) {
                // Check if it's a suspension error
                if (res.error.includes('suspended')) {
                    setError('Your account has been suspended. Please contact an administrator.')
                } else {
                    setError('Invalid email or password')
                }
                setLoading(false)
            } else if (res?.ok) {
                router.push('/dashboard')
                router.refresh()
            } else {
                setError('Something went wrong')
                setLoading(false)
            }
        } catch (err: any) {
            console.error('Login error:', err)
            // Show the actual error message to help debugging
            setError(`Error: ${err?.message || JSON.stringify(err)}`)
            setLoading(false)
        }
    }

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: 'var(--secondary)' }}>
            <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
                <h1 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Login</h1>
                {error && <div style={{ color: 'red', marginBottom: '1rem', textAlign: 'center' }}>{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Email</label>
                        <input
                            type="email"
                            className="input"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>Password</label>
                        <input
                            type="password"
                            className="input"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>
            </div>
        </div>
    )
}
