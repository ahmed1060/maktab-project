'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import { useToast } from '@/context/ToastContext'

type Payment = {
    id: string
    cost: number
    subscriptionType: 'MONTHLY' | 'ANNUALLY'
    status: 'PAID' | 'UNPAID'
    paidAt: string | null
    startDate: string | null
    endDate: string | null
    createdAt: string
}

type Company = {
    id: string
    name: string
}

export default function CompanyPaymentsPage() {
    const params = useParams()
    const router = useRouter()
    const { id: companyId } = params as { id: string }
    const { data: session } = useSession()
    const { showToast } = useToast()

    const [company, setCompany] = useState<Company | null>(null)
    const [payments, setPayments] = useState<Payment[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [formData, setFormData] = useState({
        cost: '',
        subscriptionType: 'MONTHLY'
    })
    const [submitting, setSubmitting] = useState(false)

    const fetchCompanyData = async () => {
        try {
            const res = await fetch(`/api/companies?id=${companyId}`)
            if (res.ok) {
                const data = await res.json()
                setCompany(data)
            }
        } catch (error) {
            console.error('Failed to fetch company')
        }
    }

    const fetchPayments = async () => {
        try {
            const res = await fetch(`/api/companies/${companyId}/payments`)
            if (res.ok) {
                const data = await res.json()
                setPayments(data)
            }
        } catch (error) {
            console.error('Failed to fetch payments')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (companyId) {
            fetchCompanyData()
            fetchPayments()
        }
    }, [companyId])

    const handleAddPayment = async (e: React.FormEvent) => {
        e.preventDefault()
        setSubmitting(true)
        try {
            const res = await fetch(`/api/companies/${companyId}/payments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            })

            if (res.ok) {
                showToast('Payment record added successfully!', 'success')
                setShowModal(false)
                setFormData({ cost: '', subscriptionType: 'MONTHLY' })
                fetchPayments()
            } else {
                showToast('Failed to add payment', 'error')
            }
        } catch (error) {
            showToast('Error adding payment', 'error')
        } finally {
            setSubmitting(false)
        }
    }

    const markAsPaid = async (paymentId: string) => {
        try {
            const res = await fetch(`/api/companies/${companyId}/payments/${paymentId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'PAID' })
            })

            if (res.ok) {
                showToast('Payment marked as PAID!', 'success')
                fetchPayments()
            } else {
                showToast('Failed to update payment status', 'error')
            }
        } catch (error) {
            showToast('Error updating status', 'error')
        }
    }

    if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                <div>
                    <button
                        onClick={() => router.push('/dashboard/companies')}
                        style={{ border: 'none', background: 'none', color: '#6366f1', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontWeight: '600', marginBottom: '0.5rem' }}
                    >
                        ← Back to Companies
                    </button>
                    <h1 style={{ margin: 0 }}>Payment History</h1>
                    <p style={{ color: '#64748b', marginTop: '0.25rem' }}>Management for <strong>{company?.name || 'Loading...'}</strong></p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setShowModal(true)}
                >
                    + Add Payment
                </button>
            </div>

            {loading ? (
                <div style={{ padding: '4rem', textAlign: 'center' }}>
                    <p style={{ color: '#64748b' }}>Loading payments...</p>
                </div>
            ) : payments.length === 0 ? (
                <div className="glass" style={{ padding: '4rem', textAlign: 'center', borderRadius: '1rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧾</div>
                    <h3 style={{ margin: '0 0 0.5rem' }}>No payments found</h3>
                    <p style={{ color: '#64748b', margin: 0 }}>You haven't added any payment records for this company yet.</p>
                </div>
            ) : (
                <div className="glass" style={{ borderRadius: '1rem', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>Type</th>
                                <th style={{ textAlign: 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>Cost</th>
                                <th style={{ textAlign: 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>Dates</th>
                                <th style={{ textAlign: 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>Status</th>
                                <th style={{ textAlign: 'right', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            {payments.map(payment => (
                                <tr key={payment.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                                    <td style={{ padding: '1.25rem' }}>
                                        <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{payment.subscriptionType}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Created {new Date(payment.createdAt).toLocaleDateString()}</div>
                                    </td>
                                    <td style={{ padding: '1.25rem', fontWeight: 'bold', color: '#1e293b' }}>
                                        ${payment.cost.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '1.25rem' }}>
                                        {payment.status === 'PAID' ? (
                                            <div style={{ fontSize: '0.85rem' }}>
                                                <div><span style={{ color: '#64748b' }}>Start:</span> {new Date(payment.startDate!).toLocaleDateString()}</div>
                                                <div><span style={{ color: '#64748b' }}>End:</span> {new Date(payment.endDate!).toLocaleDateString()}</div>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>Pending Activation</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '1.25rem' }}>
                                        <span style={{
                                            padding: '0.4rem 0.75rem',
                                            borderRadius: '999px',
                                            fontSize: '0.7rem',
                                            fontWeight: 'bold',
                                            background: payment.status === 'PAID' ? '#dcfce7' : '#fee2e2',
                                            color: payment.status === 'PAID' ? '#166534' : '#dc2626'
                                        }}>
                                            {payment.status}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: 'right' }}>
                                        <button
                                            onClick={() => payment.status === 'UNPAID' && markAsPaid(payment.id)}
                                            className="btn"
                                            disabled={payment.status === 'PAID'}
                                            style={{
                                                background: payment.status === 'PAID' ? '#f1f5f9' : '#6366f1',
                                                color: payment.status === 'PAID' ? '#94a3b8' : 'white',
                                                padding: '0.4rem 0.8rem',
                                                fontSize: '0.8rem',
                                                cursor: payment.status === 'PAID' ? 'not-allowed' : 'pointer',
                                                border: payment.status === 'PAID' ? '1px solid #e2e8f0' : 'none'
                                            }}
                                        >
                                            {payment.status === 'PAID' ? '✅ Paid' : 'Mark as Paid'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal
                isOpen={showModal}
                onClose={() => setShowModal(false)}
                title="Add New Subscription Payment"
                hideFooter={true}
            >
                <form onSubmit={handleAddPayment} style={{ padding: '0.5rem' }}>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>Subscription Type</label>
                        <select
                            className="input"
                            value={formData.subscriptionType}
                            onChange={e => setFormData({ ...formData, subscriptionType: e.target.value as any })}
                        >
                            <option value="MONTHLY">Monthly</option>
                            <option value="ANNUALLY">Annually</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '2rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>Total Cost</label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>$</span>
                            <input
                                type="number"
                                step="0.01"
                                className="input"
                                style={{ paddingLeft: '2.5rem' }}
                                required
                                value={formData.cost}
                                onChange={e => setFormData({ ...formData, cost: e.target.value })}
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                        <button type="button" onClick={() => setShowModal(false)} className="btn" style={{ background: '#f1f5f9', color: '#64748b' }}>
                            Cancel
                        </button>
                        <button type="submit" disabled={submitting} className="btn btn-primary">
                            {submitting ? 'Adding...' : 'Add Record'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    )
}
