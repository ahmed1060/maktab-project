'use client'
import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useLanguage } from '@/context/LanguageContext'

export default function AddBonusPage() {
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
            setFieldError(t('bonus_limit_error' as any))
            setLoading(false)
            return
        }

        try {
            const res = await fetch(`/api/users/${params.id}/bonus`, {
                method: 'POST',
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    reason: reason.trim()
                }), // Amount is DAYS
                headers: { 'Content-Type': 'application/json' }
            })

            if (!res.ok) throw new Error(t('failed_add_bonus' as any))

            setSuccess(t('bonus_added_success' as any))

            // Wait a moment then redirect
            setTimeout(() => {
                router.push('/dashboard/employees')
                router.refresh()
            }, 1500)
        } catch (err: any) {
            setError(err.message || t('failed_add_bonus' as any))
            setLoading(false)
        }
    }

    const containerStyle: React.CSSProperties = {
        direction: locale === 'ar' ? 'rtl' : 'ltr',
        textAlign: locale === 'ar' ? 'right' : 'left'
    }

    return (
        <div className="card" style={{ maxWidth: '500px', margin: '2rem auto', ...containerStyle }}>
            <h1>{t('add_monthly_bonus_title' as any)}</h1>
            <p style={{ color: 'var(--text-soft)', marginBottom: '1.5rem' }}>
                {t('bonus_days_hint' as any)}
            </p>

            {error && (
                <div style={{ color: 'var(--danger-fg-strong)', background: 'var(--danger-bg)', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    {error}
                </div>
            )}

            {success && (
                <div style={{ color: 'var(--ok-fg)', background: 'var(--ok-bg)', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem' }}>
                    {success}
                </div>
            )}

            <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>{t('bonus_days_label' as any)}</label>
                    <input aria-label={t('bonus_days_label' as any)}
                        type="number"
                        className="input"
                        value={amount}
                        onChange={e => {
                            setAmount(e.target.value)
                            setFieldError('')
                        }}
                        style={fieldError ? { borderColor: 'var(--danger-solid)' } : {}}
                        required
                        min="0"
                        max="1000"
                        step="0.01"
                        placeholder={t('example_bonus' as any)}
                        autoFocus
                    />
                    {fieldError && (
                        <div style={{ color: 'var(--danger-fg-strong)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                            {fieldError}
                        </div>
                    )}
                </div>

                <div style={{ marginBottom: '1.5rem' }}>
                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>{t('reason_label')}</label>
                    <textarea aria-label={t('reason_label')}
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
                        style={{ background: 'var(--border)', color: 'var(--text-strong)', textAlign: 'center', textDecoration: 'none' }}
                    >
                        {t('cancel')}
                    </Link>
                    <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                        {loading ? t('adding' as any) : t('add_bonus' as any)}
                    </button>
                </div>
            </form>
        </div>
    )
}
