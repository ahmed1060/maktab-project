'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { fetcher } from '@/lib/swr-fetcher'

type TrustedDevice = {
    id: string
    label: string | null
    createdAt: string
    lastUsedAt: string
    expiresAt: string
}

// F-27, Phase 4: enrollment + toggle. Opt-in and toggleable for everyone
// except a protected SuperAdmin, for whom enabling is still voluntary but
// disabling is a permanent one-way door (see /api/account/mfa/disable) —
// that's what "enforced" actually means for that account, not a separate
// flag flipped elsewhere later.
//
// Was app/(dashboard)/dashboard/mfa-settings/page.tsx until Security Settings
// merged it with the email screen. Moved, not rewritten — the enrollment flow
// and the one-way door for a protected Super Admin are the parts of this app
// least worth retyping from memory.
export default function MfaSection() {
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

    // F-27, Phase 6
    const devicesQuery = mfaEnabled ? '/api/account/mfa/trusted-devices' : null
    const { data: devicesResult, mutate: mutateDevices } = useSWR(devicesQuery, fetcher)
    const devices: TrustedDevice[] = devicesResult?.data?.devices || []
    const [revokingId, setRevokingId] = useState<string | null>(null)
    const [revokingAll, setRevokingAll] = useState(false)

    const formatDate = (iso: string) => new Date(iso).toLocaleDateString(isAr ? 'ar' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' })

    const revokeDevice = async (id: string) => {
        setRevokingId(id)
        try {
            const res = await fetch(`/api/account/mfa/trusted-devices/${id}`, { method: 'DELETE' })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || (isAr ? 'حدث خطأ' : 'Something went wrong'))
            mutateDevices()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setRevokingId(null)
        }
    }

    const revokeAllDevices = async () => {
        setRevokingAll(true)
        try {
            const res = await fetch('/api/account/mfa/trusted-devices/revoke-all', { method: 'POST' })
            const data = await res.json()
            if (!res.ok || !data.success) throw new Error(data.error || (isAr ? 'حدث خطأ' : 'Something went wrong'))
            mutateDevices()
        } catch (err: any) {
            setError(err.message)
        } finally {
            setRevokingAll(false)
        }
    }

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="glass-card" style={{ padding: '2rem' }}>
                <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
                    {isAr ? 'المصادقة الثنائية' : 'Two-factor authentication'}
                </h2>

                <div style={{
                    display: 'inline-block', margin: '0 0 1.5rem', padding: '0.2rem 0.6rem',
                    borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700,
                    background: mfaEnabled ? 'var(--ok-bg)' : 'var(--surface-sunk)',
                    color: mfaEnabled ? 'var(--ok-fg)' : 'var(--text-soft)'
                }}>
                    {mfaEnabled ? (isAr ? 'مفعّلة' : 'Enabled') : (isAr ? 'غير مفعّلة' : 'Not enabled')}
                </div>

                {error && <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--danger-solid)' }}>{error}</div>}

                {mfaEnabled ? (
                    isProtectedActor ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {isAr
                                ? 'المصادقة الثنائية مفعّلة ومطلوبة لهذا الحساب. لا يمكن إيقافها.'
                                : 'MFA is enabled and required for this account. It cannot be disabled.'}
                        </p>
                    ) : !disabling ? (
                        <button className="btn" onClick={() => setDisabling(true)} style={{ background: 'transparent', border: '1px solid var(--danger-solid)', color: 'var(--danger-solid)' }}>
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
                                <button type="button" className="btn" onClick={() => { setDisabling(false); setPassword(''); setError('') }} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)' }}>
                                    {isAr ? 'رجوع' : 'Back'}
                                </button>
                                <button type="submit" className="btn" disabled={submittingDisable} style={{ flex: 1, background: 'var(--danger-solid)' }}>
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
                            <button type="button" className="btn" onClick={() => { setEnrolling(false); setCode(''); setError('') }} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)' }}>
                                {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                            <button type="submit" className="btn" disabled={confirming} style={{ flex: 1 }}>
                                {confirming ? (isAr ? 'جارٍ التحقق...' : 'Verifying...') : (isAr ? 'تحقق وتفعيل' : 'Verify & enable')}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {mfaEnabled && (
                <div className="glass-card" style={{ padding: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.05rem' }}>
                            {isAr ? 'الأجهزة الموثوقة' : 'Trusted devices'}
                        </h3>
                        {devices.length > 0 && (
                            <button
                                onClick={revokeAllDevices}
                                disabled={revokingAll}
                                style={{ background: 'none', border: 'none', color: 'var(--danger-solid)', fontSize: '0.8rem', fontWeight: 600, cursor: revokingAll ? 'not-allowed' : 'pointer' }}
                            >
                                {revokingAll ? (isAr ? 'جارٍ الإلغاء...' : 'Revoking...') : (isAr ? 'إلغاء الكل' : 'Revoke all')}
                            </button>
                        )}
                    </div>

                    {devices.length === 0 ? (
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            {isAr ? 'لا توجد أجهزة موثوقة' : 'No trusted devices'}
                        </p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {devices.map(device => (
                                <div key={device.id} style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                    padding: '0.75rem 0.9rem', border: '1px solid var(--border)', borderRadius: '8px'
                                }}>
                                    <div>
                                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-main)' }}>
                                            {device.label || (isAr ? 'جهاز غير معروف' : 'Unknown device')}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                                            {(isAr ? 'آخر استخدام' : 'Last used')}: {formatDate(device.lastUsedAt)} · {(isAr ? 'تنتهي الصلاحية' : 'Expires')}: {formatDate(device.expiresAt)}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => revokeDevice(device.id)}
                                        disabled={revokingId === device.id}
                                        style={{ background: 'none', border: 'none', color: 'var(--danger-solid)', fontSize: '0.8rem', fontWeight: 600, cursor: revokingId === device.id ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                                    >
                                        {revokingId === device.id ? (isAr ? 'جارٍ...' : '...') : (isAr ? 'إلغاء' : 'Revoke')}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
