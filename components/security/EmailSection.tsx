'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'

// F-27: one component, two doors in. Reached two ways —
// (a) forced, via middleware.ts's redirect, whenever emailVerified is
//     false: the email field is editable here on purpose, since a user
//     blocked from the rest of the dashboard has no other way to fix a
//     wrong/dead address before verifying it.
// (b) voluntary, from Security Settings, once already verified — the same
//     component, just no forced framing.
// The protected super admin reaches the same gate to verify their (fixed)
// email once, but can't edit it — the field is disabled, and the backend
// (/api/account/email/*) enforces this independently regardless.
//
// Was app/(dashboard)/dashboard/email-settings/page.tsx until Security
// Settings merged it with MFA. Moved rather than rewritten: everything below
// the outer wrapper is the code that was already working, and a gate screen
// that a person cannot get past is the wrong place to be clever.
export default function EmailSection() {
    const { locale } = useLanguage()
    const { data: session, update } = useSession()
    const { showToast } = useToast()
    const router = useRouter()

    const isAr = locale === 'ar'
    const currentEmail = session?.user?.email || ''
    const isVerified = !!session?.user?.emailVerified
    const isProtectedActor = session?.user?.role === 'SUPER_ADMIN' && !!session?.user?.isProtected

    const [email, setEmail] = useState(currentEmail)
    const [code, setCode] = useState('')
    const [codeSent, setCodeSent] = useState(false)
    const [sending, setSending] = useState(false)
    const [verifying, setVerifying] = useState(false)
    const [error, setError] = useState('')

    // session.user.email can arrive after this component's first render
    // (the session hook resolves asynchronously); keep the editable field
    // in sync until the user actually starts typing.
    const [touched, setTouched] = useState(false)
    if (!touched && currentEmail && email !== currentEmail && !codeSent) {
        setEmail(currentEmail)
    }

    const handleSendCode = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setSending(true)
        try {
            const res = await fetch('/api/account/email/request-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || (isAr ? 'حدث خطأ' : 'Something went wrong'))
            }
            setCodeSent(true)
            showToast(isAr ? 'تم إرسال الرمز — تحقق من بريدك الوارد.' : 'Code sent — check your inbox.', 'success')
        } catch (err: any) {
            setError(err.message)
        } finally {
            setSending(false)
        }
    }

    const handleVerifyCode = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setVerifying(true)
        try {
            const res = await fetch('/api/account/email/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || (isAr ? 'رمز غير صالح أو منتهي الصلاحية' : 'Invalid or expired code'))
            }

            const changed = email !== currentEmail
            await update({ emailVerified: true, email: data.data.email })
            showToast(
                changed
                    ? (isAr ? 'تم تحديث البريد الإلكتروني وتأكيده.' : 'Email updated and verified.')
                    : (isAr ? 'تم تأكيد البريد الإلكتروني.' : 'Email verified.'),
                'success'
            )
            setCodeSent(false)
            setCode('')
            router.replace('/dashboard')
        } catch (err: any) {
            setError(err.message)
        } finally {
            setVerifying(false)
        }
    }

    return (
        <div className="glass-card" style={{ padding: '2rem' }}>
                {!isVerified && (
                    <>
                        <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
                            {isAr ? 'يجب عليك تأكيد بريدك الإلكتروني' : 'You must verify your email'}
                        </h2>
                        <p style={{ margin: '0 0 1.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                            {isAr
                                ? 'هذا يؤكد أنك تتحكم فعليًا في هذا العنوان — وهو مطلوب قبل استخدام باقي لوحة التحكم، وهو ما يُرسل إليه رمز تسجيل الدخول إذا فقدت الوصول إلى تطبيق المصادقة الخاص بك.'
                                : "This confirms you actually control this address — it's needed before you can use the rest of the dashboard, and it's what a sign-in code gets sent to if you're ever locked out of your authenticator app."}
                        </p>
                    </>
                )}
                {isVerified && (
                    <>
                        <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
                            {isAr ? 'إعدادات البريد الإلكتروني' : 'Email settings'}
                        </h2>
                        <div style={{
                            display: 'inline-block', margin: '0 0 1.5rem', padding: '0.2rem 0.6rem',
                            borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700,
                            background: 'var(--ok-bg)', color: 'var(--ok-fg)'
                        }}>
                            {isAr ? 'موثّق' : 'Verified'}
                        </div>
                    </>
                )}

                {error && (
                    <div style={{ marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--danger-solid)' }}>{error}</div>
                )}

                {isProtectedActor ? (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
                        {isAr ? 'بريد هذا الحساب محمي ولا يمكن تغييره.' : "This account's email is protected and can't be changed."}
                    </p>
                ) : null}

                {!codeSent ? (
                    <form onSubmit={handleSendCode}>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                                {isAr ? 'عنوان البريد الإلكتروني' : 'Email address'}
                            </label>
                            <input aria-label={isAr ? 'عنوان البريد الإلكتروني' : 'Email address'}
                                type="email"
                                className="input"
                                value={email}
                                onChange={e => { setTouched(true); setEmail(e.target.value) }}
                                disabled={isProtectedActor}
                                style={isProtectedActor ? { background: 'var(--surface-sunk)', cursor: 'not-allowed' } : undefined}
                                required
                            />
                        </div>
                        <button type="submit" className="btn" disabled={sending} style={{ width: '100%' }}>
                            {sending ? (isAr ? 'جارٍ الإرسال...' : 'Sending...') : (isAr ? 'إرسال الرمز' : 'Send code')}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleVerifyCode}>
                        <div style={{ marginBottom: '0.5rem' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                                {isAr ? 'رمز التحقق' : 'Verification code'}
                            </label>
                            <input aria-label={isAr ? 'رمز التحقق' : 'Verification code'}
                                type="text"
                                inputMode="numeric"
                                className="input"
                                value={code}
                                onChange={e => setCode(e.target.value)}
                                maxLength={6}
                                minLength={6}
                                required
                                autoFocus
                            />
                        </div>
                        <p style={{ margin: '0 0 1.5rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            {isAr ? 'لم يصلك؟ تحقق من مجلد الرسائل غير المرغوب فيها.' : "Didn't get it? Check your spam folder."}
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem' }}>
                            <button type="button" className="btn" onClick={() => { setCodeSent(false); setCode(''); setError('') }} style={{ flex: 1, background: 'transparent', border: '1px solid var(--border)' }}>
                                {isAr ? 'رجوع' : 'Back'}
                            </button>
                            <button type="submit" className="btn" disabled={verifying} style={{ flex: 1 }}>
                                {verifying ? (isAr ? 'جارٍ التحقق...' : 'Verifying...') : (isAr ? 'تحقق' : 'Verify')}
                            </button>
                        </div>
                    </form>
                )}
        </div>
    )
}
