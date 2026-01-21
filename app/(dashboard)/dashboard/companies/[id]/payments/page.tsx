'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'

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
    const { t, locale } = useLanguage()

    const [company, setCompany] = useState<Company | null>(null)
    const [payments, setPayments] = useState<Payment[]>([])
    const [loading, setLoading] = useState(true)
    const [showModal, setShowModal] = useState(false)
    const [formData, setFormData] = useState({
        cost: '',
        subscriptionType: 'MONTHLY'
    })
    const [submitting, setSubmitting] = useState(false)
    const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null)

    const fetchCompanyData = useCallback(async () => {
        try {
            const res = await fetch(`/api/companies?id=${companyId}`)
            if (res.ok) {
                const data = await res.json()
                setCompany(data)
            }
        } catch {
            console.error('Failed to fetch company')
        }
    }, [companyId])

    const fetchPayments = useCallback(async () => {
        try {
            const res = await fetch(`/api/companies/${companyId}/payments`)
            if (res.ok) {
                const data = await res.json()
                setPayments(data)
            }
        } catch {
            console.error('Failed to fetch payments')
        } finally {
            setLoading(false)
        }
    }, [companyId])

    useEffect(() => {
        if (companyId) {
            fetchCompanyData()
            fetchPayments()
        }
    }, [companyId, fetchCompanyData, fetchPayments])

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
                showToast(t('payment_added_success'), 'success')
                setShowModal(false)
                setFormData({ cost: '', subscriptionType: 'MONTHLY' })
                fetchPayments()
            } else {
                showToast(t('error_generic'), 'error')
            }
        } catch (error) {
            showToast(t('error_generic'), 'error')
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
                showToast(t('payment_marked_paid'), 'success')
                fetchPayments()
            } else {
                showToast(t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    const handleDelete = (paymentId: string) => {
        setPaymentToDelete(paymentId)
    }

    const confirmDelete = async () => {
        if (!paymentToDelete) return

        try {
            const res = await fetch(`/api/companies/${companyId}/payments/${paymentToDelete}`, {
                method: 'DELETE'
            })

            if (res.ok) {
                showToast(t('payment_deleted_success'), 'success')
                fetchPayments()
            } else {
                const data = await res.json()
                showToast(data.error || t('error_generic'), 'error')
            }
        } catch (error) {
            showToast(t('error_generic'), 'error')
        } finally {
            setPaymentToDelete(null)
        }
    }

    if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexDirection: 'row' }}>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <button
                        onClick={() => router.push('/dashboard/companies')}
                        className="glass"
                        style={{
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '0.75rem',
                            color: 'var(--primary)',
                            textDecoration: 'none',
                            transition: 'all 0.3s ease',
                            border: '1px solid rgba(255, 255, 255, 0.4)',
                            transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`,
                            float: locale === 'ar' ? 'right' : 'left',
                            cursor: 'pointer'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.transform = `translateY(-4px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.9)'
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.transform = `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.7)'
                        }}
                        title={t('back_to_companies')}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="19" y1="12" x2="5" y2="12"></line>
                            <polyline points="12 19 5 12 12 5"></polyline>
                        </svg>
                    </button>
                    <div style={{ clear: 'both' }}></div>
                    <h1 style={{ margin: 0 }}>{t('payment_history')}</h1>
                    <p style={{ color: '#64748b', marginTop: '0.25rem' }}>{t('management_for')} <strong>{company?.name || t('loading_data')}</strong></p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={() => setShowModal(true)}
                >
                    + {t('add_payment')}
                </button>
            </div>

            {loading ? (
                <div style={{ padding: '4rem', textAlign: 'center' }}>
                    <p style={{ color: '#64748b' }}>{t('loading_payments')}</p>
                </div>
            ) : payments.length === 0 ? (
                <div className="glass" style={{ padding: '4rem', textAlign: 'center', borderRadius: '1rem' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧾</div>
                    <h3 style={{ margin: '0 0 0.5rem' }}>{t('no_payments_found')}</h3>
                    <p style={{ color: '#64748b', margin: 0 }}>{t('no_payments_hint')}</p>
                </div>
            ) : (
                <div className="glass" style={{ borderRadius: '1rem', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: 'rgba(255,255,255,0.5)', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                            <tr>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>{t('subscription_type')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>{t('costs')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>{t('dates_column')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>{t('status_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: '#64748b' }}>{t('quick_actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {payments.map(payment => (
                                <tr key={payment.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                                    <td style={{ padding: '1.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{payment.subscriptionType === 'MONTHLY' ? t('monthly') : t('annually')}</div>
                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{t('created_at')} {new Date(payment.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</div>
                                    </td>
                                    <td style={{ padding: '1.25rem', fontWeight: 'bold', color: '#1e293b', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        ${payment.cost.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {payment.status === 'PAID' ? (
                                            <div style={{ fontSize: '0.85rem' }}>
                                                <div><span style={{ color: '#64748b' }}>{t('start_date')}:</span> {new Date(payment.startDate!).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</div>
                                                <div><span style={{ color: '#64748b' }}>{t('end_date')}:</span> {new Date(payment.endDate!).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</div>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic' }}>{t('pending_activation')}</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <span style={{
                                            padding: '0.4rem 0.75rem',
                                            borderRadius: '999px',
                                            fontSize: '0.7rem',
                                            fontWeight: 'bold',
                                            background: payment.status === 'PAID' ? '#dcfce7' : '#fee2e2',
                                            color: payment.status === 'PAID' ? '#166534' : '#dc2626'
                                        }}>
                                            {payment.status === 'PAID' ? t('status_paid') : t('status_unpaid')}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: locale === 'ar' ? 'left' : 'right' }}>
                                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: locale === 'ar' ? 'flex-start' : 'flex-end', alignItems: 'center', flexDirection: 'row' }}>
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
                                                {payment.status === 'PAID' ? `✅ ${t('status_paid')}` : t('mark_as_paid')}
                                            </button>

                                            {payment.status === 'UNPAID' && (
                                                <button
                                                    onClick={() => handleDelete(payment.id)}
                                                    className="btn"
                                                    style={{
                                                        background: '#fee2e2',
                                                        color: '#dc2626',
                                                        padding: '0.4rem',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        borderRadius: '0.5rem',
                                                        border: 'none',
                                                        cursor: 'pointer'
                                                    }}
                                                    title={t('delete_payment_title')}
                                                >
                                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M3 6h18"></path>
                                                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                                                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                                                    </svg>
                                                </button>
                                            )}
                                        </div>
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
                title={t('add_subscription_title')}
                hideFooter={true}
            >
                <form onSubmit={handleAddPayment} style={{ padding: '0.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{t('subscription_type')}</label>
                        <select
                            className="input"
                            value={formData.subscriptionType}
                            onChange={e => setFormData({ ...formData, subscriptionType: e.target.value as any })}
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        >
                            <option value="MONTHLY">{t('monthly')}</option>
                            <option value="ANNUALLY">{t('annually')}</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '2rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{t('total_cost')}</label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#64748b' }}>$</span>
                            <input
                                type="number"
                                step="0.01"
                                className="input"
                                style={{ [locale === 'ar' ? 'paddingRight' : 'paddingLeft']: '2.5rem', textAlign: locale === 'ar' ? 'right' : 'left' }}
                                required
                                value={formData.cost}
                                onChange={e => setFormData({ ...formData, cost: e.target.value })}
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', flexDirection: 'row' }}>
                        <button type="button" onClick={() => setShowModal(false)} className="btn" style={{ background: '#f1f5f9', color: '#64748b' }}>
                            {t('cancel')}
                        </button>
                        <button type="submit" disabled={submitting} className="btn btn-primary">
                            {submitting ? t('saving') : t('add_payment')}
                        </button>
                    </div>
                </form>
            </Modal>

            <ConfirmModal
                isOpen={!!paymentToDelete}
                title={t('delete_payment_title')}
                message={t('delete_payment_warning_msg')}
                confirmText={t('delete')}
                cancelText={t('cancel')}
                onConfirm={confirmDelete}
                onCancel={() => setPaymentToDelete(null)}
                variant="danger"
            />
        </div>
    )
}
