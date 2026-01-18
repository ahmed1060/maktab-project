'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'

export default function AddDeductionPage() {
    const { t, locale } = useLanguage()
    const params = useParams()
    const router = useRouter()
    const [amount, setAmount] = useState('')
    const [reason, setReason] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [fieldError, setFieldError] = useState('')
    const [success, setSuccess] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        setSuccess('')

        if (parseFloat(amount) > 1000) {
            setFieldError(t('deduction_limit_error' as any))
            setLoading(false)
            return
        }

        try {
            const res = await fetch(`/api/users/${params.id}/deduction`, {
                method: 'POST',
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    reason: reason.trim()
                }), // Amount is DAYS (e.g. 1 for 1 day)
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) throw new Error(t('failed_add_deduction' as any))

            setSuccess(t('deduction_added_success' as any))

            // Wait a moment then redirect
            setTimeout(() => {
                router.push('/dashboard/employees')
                router.refresh()
            }, 1500)
        } catch (err: any) {
            setError(err.message || t('failed_add_deduction' as any))
            setLoading(false)
        }
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    return (
        <div className="card" style={{ maxWidth: '500px', margin: '2rem auto', ...containerStyle }}>
            <h1>{t('add_monthly_deduction_title' as any)}</h1>
            <p style={{ color: '#64748b', marginBottom: '1.5rem' }}>
                {t('deduction_days_hint' as any)}
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
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>{t('deduction_days_label' as any)}</label>
                    <input
                        type="number"
                        className="input"
                        value={amount}
                        onChange={e => {
                            setAmount(e.target.value)
                            setFieldError('')
                        }}
                        style={fieldError ? { borderColor: '#ef4444' } : {}}
                        required
                        min="0"
                        max="1000"
                        step="0.01"
                        placeholder={t('example_deduction' as any)}
                        autoFocus
                    />
                    {fieldError && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldError}
                        </div>
                    )}
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>{t('reason_label')}</label>
                    <textarea
                        className="input"
                        value={reason}
                        onChange={e => setReason(e.target.value)}
                        placeholder={t('reason_placeholder')}
                        style={{ width: '100%', minHeight: '100px', padding: '0.75rem' }}
                    />
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                    <Link
                        href="/dashboard/employees"
                        className="btn"
                        style={{ background: '#e2e8f0', color: '#0f172a', textAlign: 'center', textDecoration: 'none' }}
                    >
                        {t('cancel')}
                    </Link>
                    <button type="submit" className="btn btn-danger" disabled={loading} style={{ flex: 1, background: '#ef4444', color: 'white' }}>
                        {loading ? t('adding' as any) : t('add_deduction')}
                    </button>
                </div>
            </form>
        </div>
    )
}
