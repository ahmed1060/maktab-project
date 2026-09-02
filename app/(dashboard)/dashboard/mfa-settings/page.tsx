'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'

// F-27, Phase 4: enrollment + toggle. Opt-in and toggleable for everyone
// except a protected SuperAdmin, for whom enabling is still voluntary but
// disabling is a permanent one-way door (see /api/account/mfa/disable) —
// that's what "enforced" actually means for that account, not a separate
// flag flipped elsewhere later.
export default function MfaSettingsPage() {
    const { locale } = useLanguage()
    const { data: session, update } = useSession()
    const { showToast } = useToast()
    const isAr = locale === 'ar'

    const mfaEnabled = !!session?.user?.mfaEnabled
    const isProtectedActor = session?.user?.role === 'SUPER_ADMIN' && !!session?.user?.isProtected

    // Enrollment state
    const [enrolling, setEnrolling] = useState(false)
    const [secret, setSecret] = useState('')
    const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
    const [code, setCode] = useState('')
    const [confirming, setConfirming] = useState(false)

    // Disable state
    const [disabling, setDisabling] = useState(false)
    const [password, setPassword] = useState('')
    const [submittingDisable, setSubmittingDisable] = useState(false)

    const [error, setError] = useState('')

    const startEnroll = async () => {
        setError('')
        setEnrolling(true)
        try {
            const res = await fetch('/api/account/mfa/enroll', { method: 'POST' })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || (isAr ? 'حدث خطأ' : 'Something went wrong'))
            setSecret(data.data.secret)
            setQrCodeDataUrl(data.data.qrCodeDataUrl)
        } catch (err: any) {
            setError(err.message)
            setEnrolling(false)
        }
    }

    const confirmEnroll = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setConfirming(true)
        try {
            const res = await fetch('/api/account/mfa/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret, code }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || (isAr ? 'رمز غير صالح' : 'Invalid code'))
            await update({ mfaEnabled: true })
            showToast(isAr ? 'تم تفعيل المصادقة الثنائية.' : 'Two-factor authentication enabled.', 'success')
            setEnrolling(false)
            setCode('')
            setSecret('')
            setQrCodeDataUrl('')
        } catch (err: any) {
            setError(err.message)
        } finally {
            setConfirming(false)
        }
    }

    const confirmDisable = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setSubmittingDisable(true)
        try {
            const res = await fetch('/api/account/mfa/disable', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || (isAr ? 'كلمة مرور غير صحيحة' : 'Incorrect password'))
            await update({ mfaEnabled: false })
            showToast(isAr ? 'تم إيقاف المصادقة الثنائية.' : 'Two-factor authentication disabled.', 'success')
            setDisabling(false)
            setPassword('')
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSubmittingDisable(false)
        }
    }

    return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem', direction: isAr ? 'rtl' : 'ltr' }}>
            <div className="glass-card" style={{ maxWidth: '460px', width: '100%', padding: '2rem' }}>
                <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
                    {isAr ? 'المصادقة الثنائية' : 'Two-factor authentication'}
                </h2>

                <div style={{
                    display: 'inline-block', margin: '0 0 1.5rem', padding: '0.2rem 0.6rem',
                    borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700,
                    background: mfaEnabled ? '#e1f1e6' : '#eae9df',
                    color: mfaEnabled ? '#2f7a4f' : '#5b6660'
                }}>
                    {mfaEnabled ? (isAr ? 'مفعّلة' : 'Enabled') : (isAr ? 'غير مفعّلة' : 'Not enabled')}
                </div>

                {error && <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: '#ef4444' }}>{error}</div>}

                {mfaEnabled ? (
                    isProtectedActor ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {isAr
                                ? 'المصادقة الثنائية مفعّلة ومطلوبة لهذا الحساب. لا يمكن إيقافها.'
                                : 'MFA is enabled and required for this account. It cannot be disabled.'}
                        </p>
                    ) : !disabling ? (
                        <button className="btn" onClick={() => setDisabling(true)} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444' }}>
                            {isAr ? 'إيقاف المصادقة الثنائية' : 'Disable two-factor authentication'}
                        </button>
                    ) : (
                        <form onSubmit={confirmDisable}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                                    {isAr ? 'أدخل كلمة المرور للتأكيد' : 'Enter your password to confirm'}
                                </label>
                                <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required autoFocus />
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem' }}>
                                <button type="button" className="btn" onClick={() => { setDisabling(false); setPassword(''); setError('') }} style={{ flex: 1, background: 'transparent', border: '1px solid #e2e8f0' }}>
                                    {isAr ? 'رجوع' : 'Back'}
                                </button>
                                <button type="submit" className="btn" disabled={submittingDisable} style={{ flex: 1, background: '#ef4444' }}>
                                    {submittingDisable ? (isAr ? 'جارٍ الإيقاف...' : 'Disabling...') : (isAr ? 'إيقاف' : 'Disable')}
                                </button>
                            </div>
                        </form>
                    )
                ) : !enrolling ? (
                    <>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
                            {isAr
                                ? 'أضف طبقة حماية إضافية لحسابك باستخدام تطبيق مصادقة مثل Google Authenticator.'
                                : 'Add an extra layer of protection to your account using an authenticator app like Google Authenticator.'}
                        </p>
                        <button className="btn" onClick={startEnroll} style={{ width: '100%' }}>
                            {isAr ? 'تفعيل المصادقة الثنائية' : 'Enable two-factor authentication'}
                        </button>
                    </>
                ) : (
                    <form onSubmit={confirmEnroll}>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                            {isAr
                                ? 'امسح هذا الرمز باستخدام تطبيق المصادقة الخاص بك، ثم أدخل الرمز المكوّن من 6 أرقام.'
                                : 'Scan this with your authenticator app, then enter the 6-digit code it shows.'}
                        </p>
                        {qrCodeDataUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={qrCodeDataUrl} alt="QR code" style={{ display: 'block', margin: '0 auto 1rem', width: '200px', height: '200px' }} />
                        )}
                        <details style={{ marginBottom: '1rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            <summary style={{ cursor: 'pointer' }}>{isAr ? "لا يمكنك المسح؟ أدخل الرمز يدويًا" : "Can't scan? Enter the code manually"}</summary>
                            <code style={{ display: 'block', marginTop: '0.5rem', wordBreak: 'break-all' }}>{secret}</code>
                        </details>
                        <div style={{ marginBottom: '1rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                                {isAr ? 'رمز التحقق' : 'Verification code'}
                            </label>
                            <input type="text" inputMode="numeric" className="input" value={code} onChange={e => setCode(e.target.value)} maxLength={6} minLength={6} required autoFocus />
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button type="button" className="btn" onClick={() => { setEnrolling(false); setCode(''); setError('') }} style={{ flex: 1, background: 'transparent', border: '1px solid #e2e8f0' }}>
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button type="submit" className="btn" disabled={confirming} style={{ flex: 1 }}>
                                {confirming ? (isAr ? 'جارٍ التحقق...' : 'Verifying...') : (isAr ? 'تحقق وتفعيل' : 'Verify & enable')}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
