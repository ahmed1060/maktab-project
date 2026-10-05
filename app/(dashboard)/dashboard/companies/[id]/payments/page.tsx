'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useParams, useRouter } from 'next/navigation'
import { useViewer } from '@/lib/useCan'
import AccessDenied from '@/components/AccessDenied'
import Modal from '@/components/Modal'
import ConfirmModal from '@/components/ConfirmModal'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'

type Payment = {
    id: string
    cost: number
    subscriptionType: 'MONTHLY' | 'ANNUALLY' | 'LIFETIME'
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

// Keyed by the stored value rather than a ternary, so adding a fourth type is
// a one-line change here instead of a conditional that silently mislabels it.
const SUBSCRIPTION_LABEL_KEY = {
    MONTHLY: 'monthly',
    ANNUALLY: 'annually',
    LIFETIME: 'lifetime',
} as const

export default function CompanyPaymentsPage() {
    const params = useParams()
    const router = useRouter()
    const { id: companyId } = params as { id: string }
    // Who is looking comes from the layout on the first paint (useViewer), so a
    // Super Admin never sees "Access Restricted" while the session loads.
    const viewer = useViewer()
    const { showToast } = useToast()
    const { t, locale } = useLanguage()

    const [showModal, setShowModal] = useState(false)
    const [formData, setFormData] = useState({
        cost: '',
        subscriptionType: 'MONTHLY'
    })
    const [submitting, setSubmitting] = useState(false)
    const [paymentToDelete, setPaymentToDelete] = useState<string | null>(null)

    const onLoadError = () => showToast(t('failed_fetch_data'), 'error')
    const { data: companyResult } = useSWR(companyId ? `/api/companies?id=${companyId}` : null, fetcher, { onError: onLoadError })
    const company: Company | null = companyResult ? (companyResult.data || companyResult) : null
    const { data: paymentsResult, isLoading: loading, mutate: fetchPayments } = useSWR(
        companyId ? `/api/companies/${companyId}/payments` : null, fetcher, { onError: onLoadError },
    )
    const payments: Payment[] = paymentsResult ? (paymentsResult.data?.data || paymentsResult.data || []) : []

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
        } catch {
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
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setPaymentToDelete(null)
        }
    }

    if (viewer?.role !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexDirection: 'row' }}>
                <div style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <button aria-label={t('back_to_companies')}
                        onClick={() => router.push('/dashboard/companies')}
                        className="glass"
                        style={{
                            width: '40px',
                            height: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            marginBottom: '0.75rem',
                            color: 'var(--brand-primary-text)',
                            textDecoration: 'none',
                            transition: 'all 0.3s ease',
                            border: '1px solid var(--veil-40)',
                            transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`,
                            float: locale === 'ar' ? 'right' : 'left',
                            cursor: 'pointer'
                        }}
                        onMouseOver={(e) => {
                            e.currentTarget.style.transform = `translateY(-4px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                            e.currentTarget.style.background = 'var(--panel-90)'
                        }}
                        onMouseOut={(e) => {
                            e.currentTarget.style.transform = `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                            e.currentTarget.style.background = 'var(--panel-70)'
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
                    <p style={{ color: 'var(--text-soft)', marginTop: '0.25rem' }}>{t('management_for')} <strong>{company?.name || t('loading_data')}</strong></p>
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
                    <p style={{ color: 'var(--text-soft)' }}>{t('loading_payments')}</p>
                </div>
            ) : payments.length === 0 ? (
                <div className="glass" style={{ padding: '4rem', textAlign: 'center', borderRadius: '1rem' }}>
                    <div aria-hidden="true" style={{ fontSize: '3rem', marginBottom: '1rem' }}>🧾</div>
                    <h3 style={{ margin: '0 0 0.5rem' }}>{t('no_payments_found')}</h3>
                    <p style={{ color: 'var(--text-soft)', margin: 0 }}>{t('no_payments_hint')}</p>
                </div>
            ) : (
                <div className="glass" style={{ borderRadius: '1rem', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: 'var(--veil-50)', borderBottom: '1px solid var(--hairline)' }}>
                            <tr>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-soft)' }}>{t('subscription_type')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-soft)' }}>{t('costs')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-soft)' }}>{t('dates_column')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'right' : 'left', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-soft)' }}>{t('status_label')}</th>
                                <th style={{ textAlign: locale === 'ar' ? 'left' : 'right', padding: '1.25rem', fontSize: '0.8rem', textTransform: 'uppercase', color: 'var(--text-soft)' }}>{t('quick_actions')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {payments.map(payment => (
                                <tr key={payment.id} style={{ borderBottom: '1px solid var(--hairline)' }}>
                                    <td style={{ padding: '1.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <div style={{ fontWeight: '600', fontSize: '0.9rem' }}>{t(SUBSCRIPTION_LABEL_KEY[payment.subscriptionType] ?? 'annually')}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-faint)' }}>{t('created_at')} {new Date(payment.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</div>
                                    </td>
                                    <td style={{ padding: '1.25rem', fontWeight: 'bold', color: 'var(--text-main)', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        ${payment.cost.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        {payment.status === 'PAID' ? (
                                            <div style={{ fontSize: '0.85rem' }}>
                                                <div><span style={{ color: 'var(--text-soft)' }}>{t('start_date')}:</span> {new Date(payment.startDate!).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')}</div>
                                                <div>
                                                    <span style={{ color: 'var(--text-soft)' }}>{t('end_date')}:</span>{' '}
                                                    {/* A lifetime subscription has no end date. new Date(null)
                                                        is the epoch, so rendering it unguarded would print
                                                        1 January 1970 to the customer who paid the most. */}
                                                    {payment.endDate
                                                        ? new Date(payment.endDate).toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-US')
                                                        : <span style={{ color: 'var(--lifetime-fg)', fontWeight: 600 }}>∞ {t('never_expires')}</span>}
                                                </div>
                                            </div>
                                        ) : (
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-faint)', fontStyle: 'italic' }}>{t('pending_activation')}</span>
                                        )}
                                    </td>
                                    <td style={{ padding: '1.25rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                                        <span style={{
                                            padding: '0.4rem 0.75rem',
                                            borderRadius: '999px',
                                            fontSize: '0.7rem',
                                            fontWeight: 'bold',
                                            background: payment.status === 'PAID' ? 'var(--ok-bg)' : 'var(--danger-bg)',
                                            color: payment.status === 'PAID' ? 'var(--ok-fg)' : 'var(--danger-solid-hover)'
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
                                                    background: payment.status === 'PAID' ? 'var(--surface-sunk)' : 'var(--brand-primary)',
                                                    color: payment.status === 'PAID' ? 'var(--text-faint)' : 'var(--text-on-accent)',
                                                    padding: '0.4rem 0.8rem',
                                                    fontSize: '0.8rem',
                                                    cursor: payment.status === 'PAID' ? 'not-allowed' : 'pointer',
                                                    border: payment.status === 'PAID' ? '1px solid var(--border)' : 'none'
                                                }}
                                            >
                                                {payment.status === 'PAID' ? <><span aria-hidden="true">✅</span> {t('status_paid')}</> : t('mark_as_paid')}
                                            </button>

                                            {payment.status === 'UNPAID' && (
                                                <button aria-label={t('delete')}
                                                    onClick={() => handleDelete(payment.id)}
                                                    className="btn"
                                                    style={{
                                                        background: 'var(--danger-bg)',
                                                        color: 'var(--danger-fg-strong)',
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
                        <select aria-label={t('subscription_type')}
                            className="input"
                            value={formData.subscriptionType}
                            onChange={e => setFormData({ ...formData, subscriptionType: e.target.value as any })}
                            style={{ textAlign: locale === 'ar' ? 'right' : 'left' }}
                        >
                            <option value="MONTHLY">{t('monthly')}</option>
                            <option value="ANNUALLY">{t('annually')}</option>
                            <option value="LIFETIME">{t('lifetime')}</option>
                        </select>
                    </div>

                    <div style={{ marginBottom: '2rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{t('total_cost')}</label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', [locale === 'ar' ? 'right' : 'left']: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-soft)' }}>$</span>
                            <input aria-label={t('total_cost')}
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
                        <button type="button" onClick={() => setShowModal(false)} className="btn" style={{ background: 'var(--surface-sunk)', color: 'var(--text-soft)' }}>
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
