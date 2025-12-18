'use client'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useRouter } from 'next/navigation'

type Request = {
    id: string
    userId: string
    oldFirstName: string
    oldLastName: string
    newFirstName: string
    newLastName: string
    status: string
    createdAt: string
    user: {
        firstName: string
        lastName: string
        email: string
        role: string
        company?: { name: string }
    }
}

export default function ProfileRequestsPage() {
    const { data: session } = useSession()
    const [requests, setRequests] = useState<Request[]>([])
    const [loading, setLoading] = useState(true)
    const { showToast } = useToast()
    const router = useRouter()
    const [processingId, setProcessingId] = useState<string | null>(null)

    const fetchRequests = async () => {
        try {
            const res = await fetch('/api/profile-requests?status=PENDING')
            if (res.ok) {
                const data = await res.json()
                setRequests(data)
            }
        } catch (e) {
            console.error('Failed to fetch requests', e)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (session?.user?.role === 'ADMIN' || session?.user?.role === 'SUPER_ADMIN') {
            fetchRequests()
        }
    }, [session])

    const handleAction = async (id: string, action: 'approve' | 'reject') => {
        setProcessingId(id)
        try {
            const res = await fetch(`/api/profile-requests/${id}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ adminNote: '' })
            })

            if (res.ok) {
                showToast(`Request ${action}d successfully`, 'success')
                fetchRequests()
                router.refresh()
            } else {
                showToast(`Failed to ${action} request`, 'error')
            }
        } catch (e) {
            showToast('An error occurred', 'error')
        } finally {
            setProcessingId(null)
        }
    }

    if (!session || !['ADMIN', 'SUPER_ADMIN'].includes(session.user.role)) {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500">
            <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button
                    onClick={() => router.back()}
                    style={{
                        background: 'rgba(255, 255, 255, 0.5)',
                        border: '1px solid rgba(255, 255, 255, 0.8)',
                        width: '40px',
                        height: '40px',
                        borderRadius: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        color: '#64748b'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.8)'
                        e.currentTarget.style.color = '#1e293b'
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255, 255, 255, 0.5)'
                        e.currentTarget.style.color = '#64748b'
                    }}
                    title="Go Back"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', margin: 0 }}>Profile Name Requests</h1>
                    <p style={{ color: '#64748b', margin: 0 }}>Review and approve employee name change requests</p>
                </div>
            </div>

            {loading ? <p>Loading requests...</p> : (
                <div style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Employee</th>
                                <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Current Name</th>
                                <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Requested Name</th>
                                <th style={{ textAlign: 'left', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Date</th>
                                <th style={{ textAlign: 'right', padding: '1rem', fontSize: '0.875rem', color: '#64748b' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No pending requests found.</td>
                                </tr>
                            ) : requests.map(req => (
                                <tr key={req.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: '600' }}>{req.user.firstName} {req.user.lastName}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{req.user.email} • {req.user.role}</div>
                                        {req.user.company && <div style={{ fontSize: '0.75rem', color: '#6366f1' }}>{req.user.company.name}</div>}
                                    </td>
                                    <td style={{ padding: '1rem', color: '#64748b' }}>{req.oldFirstName} {req.oldLastName}</td>
                                    <td style={{ padding: '1rem', fontWeight: 'bold', color: '#166534' }}>{req.newFirstName} {req.newLastName}</td>
                                    <td style={{ padding: '1rem', fontSize: '0.8rem', color: '#64748b' }}>{new Date(req.createdAt).toLocaleDateString()}</td>
                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                            <button
                                                disabled={processingId === req.id}
                                                onClick={() => handleAction(req.id, 'approve')}
                                                style={{
                                                    background: '#dcfce7',
                                                    color: '#166534',
                                                    border: 'none',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '0.5rem',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '600',
                                                    cursor: processingId === req.id ? 'not-allowed' : 'pointer',
                                                    opacity: processingId === req.id ? 0.6 : 1
                                                }}
                                            >
                                                Approve
                                            </button>
                                            <button
                                                disabled={processingId === req.id}
                                                onClick={() => handleAction(req.id, 'reject')}
                                                style={{
                                                    background: '#fee2e2',
                                                    color: '#991b1b',
                                                    border: 'none',
                                                    padding: '0.5rem 1rem',
                                                    borderRadius: '0.5rem',
                                                    fontSize: '0.875rem',
                                                    fontWeight: '600',
                                                    cursor: processingId === req.id ? 'not-allowed' : 'pointer',
                                                    opacity: processingId === req.id ? 0.6 : 1
                                                }}
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
