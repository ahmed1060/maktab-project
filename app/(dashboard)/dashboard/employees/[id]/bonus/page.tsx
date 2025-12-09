'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

export default function AddBonusPage() {
    const params = useParams()
    const router = useRouter()
    const [amount, setAmount] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        setSuccess('')

        try {
            const res = await fetch(`/api/users/${params.id}/bonus`, {
                method: 'POST',
                body: JSON.stringify({ amount: parseFloat(amount) }), // Amount is DAYS
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) throw new Error('Failed to add bonus')

            setSuccess('Bonus added successfully! Redirecting...')

            // Wait a moment then redirect
            setTimeout(() => {
                router.push('/dashboard/employees')
                router.refresh()
            }, 1500)
        } catch (err) {
            setError('Failed to add bonus')
            setLoading(false)
        }
    }

    return (
        <div className="card" style={{ maxWidth: '500px', margin: '2rem auto' }}>
            <h1>Add Monthly Bonus (Days)</h1>
            <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
                Enter the number of <strong>days</strong> to add as a bonus for the current month.
            </p>

            {error && (
                <div style={{ color: '#dc2626', background: '#fee2e2', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {success && (
                <div style={{ color: '#166534', background: '#dcfce7', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    {success}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>Bonus Days</label>
                    <input
                        type="number"
                        className="input"
                        value={amount}
                        onChange={e => setAmount(e.target.value)}
                        required
                        min="0"
                        step="0.01"
                        placeholder="e.g. 1.5"
                        autoFocus
                    />
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                    <Link
                        href="/dashboard/employees"
                        className="btn"
                        style={{ background: '#e2e8f0', color: '#0f172a', textAlign: 'center', textDecoration: 'none' }}
                    >
                        Cancel
                    </Link>
                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                        {loading ? 'Adding...' : 'Add Bonus'}
                    </button>
                </div>
            </form>
        </div>
    )
}
