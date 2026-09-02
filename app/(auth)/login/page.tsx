'use client'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import LanguageToggleButton from '@/components/LanguageToggleButton'

export default function LoginPage() {
    const { t, locale } = useLanguage()
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const router = useRouter()

    const [loading, setLoading] = useState(false)
    const [staySignedIn, setStaySignedIn] = useState(false)

    // F-27: 'credentials' -> (if MFA is enabled and this browser isn't a
    // trusted device) 'code', with 'recovery' as a sub-branch of 'code'
    // for the "email me a code instead" fallback. Neither of the latter
    // two is reachable for an account without MFA enabled — authorize()
    // just returns a session directly in that case, same as before this
    // phase existed.
    const [stage, setStage] = useState<'credentials' | 'code' | 'recovery'>('credentials')
    const [mfaCode, setMfaCode] = useState('')
    const [rememberDevice, setRememberDevice] = useState(false)
    const [recoverySending, setRecoverySending] = useState(false)
    const isAr = locale === 'ar'

    const finishLogin = async () => {
        if (rememberDevice) {
            // Best-effort — a failed trust-device call just means being
            // asked for a code again next time, not a login failure.
            try {
                await fetch('/api/account/mfa/trust-device', { method: 'POST' })
            } catch { /* non-fatal */ }
        }
        router.push('/dashboard')
        router.refresh()
    }

    const handleCredentialsSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        try {
            const res = await signIn('credentials', {
                email,
                password,
                remember: staySignedIn.toString(),
                redirect: false,
            })

            if (res?.error === 'MFA_REQUIRED') {
                setStage('code')
                setLoading(false)
                return
            }

            if (res?.error) {
                if (res.error.includes('suspended')) {
                    setError(t('error_suspended'))
                } else if (res.error.includes('Company access restricted')) {
                    setError(t('error_banned'))
                } else if (res.error.includes('This user does not belong')) {
                    setError('Access Denied.')
                } else {
                    setError(t('error_invalid_credentials'))
                }
                setLoading(false)
            } else if (res?.ok) {
                await finishLogin()
            } else {
                setError(t('error_generic'))
                setLoading(false)
            }
        } catch (err: any) {
            console.error('Login error:', err)
            setError(`Error: ${err?.message || JSON.stringify(err)}`)
            setLoading(false)
        }
    }

    const handleCodeSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        try {
            const res = await signIn('credentials', {
                email,
                password,
                remember: staySignedIn.toString(),
                ...(stage === 'recovery' ? { mfaRecoveryCode: mfaCode } : { mfaCode }),
                redirect: false,
            })

            if (res?.ok) {
                await finishLogin()
                return
            }

            setError(
                res?.error === 'INVALID_MFA_CODE'
                    ? (isAr ? 'رمز غير صالح' : 'Invalid code')
                    : (isAr ? 'حدث خطأ' : 'Something went wrong')
            )
            setLoading(false)
        } catch (err: any) {
            setError(`Error: ${err?.message || JSON.stringify(err)}`)
            setLoading(false)
        }
    }

    const requestRecoveryCode = async () => {
        setError('')
        setRecoverySending(true)
        try {
            const res = await fetch('/api/auth/mfa-recovery/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            })
            const data = await res.json()
            if (!res.ok || !data.success) {
                throw new Error(data.error || (isAr ? 'حدث خطأ' : 'Something went wrong'))
            }
            setStage('recovery')
            setMfaCode('')
        } catch (err: any) {
            setError(err.message)
        } finally {
            setRecoverySending(false)
        }
    }

    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            position: 'relative',
            overflow: 'hidden'
        }}>
            {/* Animated background elements */}
            <div style={{
                position: 'absolute',
                top: '-50%',
                left: '-50%',
                width: '200%',
                height: '200%',
                background: 'radial-gradient(circle, rgba(255,255,255,0.1) 1px, transparent 1px)',
                backgroundSize: '50px 50px',
                animation: 'float 20s linear infinite',
                pointerEvents: 'none'
            }} />
            <div style={{
                width: '100%',
                maxWidth: '420px',
                position: 'relative',
                zIndex: 1,
                padding: '0 1rem'
            }}>
                <div style={{
                    background: 'rgba(255, 255, 255, 0.95)',
                    backdropFilter: 'blur(20px)',
                    borderRadius: '24px',
                    padding: '2.5rem',
                    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>
                    <h1 style={{
                        marginBottom: '0.5rem',
                        textAlign: 'center',
                        fontSize: '2rem',
                        fontWeight: '700',
                        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text'
                    }}>{stage === 'credentials' ? t('welcome_back') : (isAr ? 'التحقق المطلوب' : 'Verification required')}</h1>
                    <p style={{
                        textAlign: 'center',
                        color: '#64748b',
                        marginBottom: '2rem',
                        fontSize: '0.875rem'
                    }}>
                        {stage === 'credentials'
                            ? t('sign_in_subtitle')
                            : stage === 'recovery'
                                ? (isAr ? 'أدخل الرمز المرسل إلى بريدك الإلكتروني.' : 'Enter the code sent to your email.')
                                : (isAr ? 'أدخل الرمز من تطبيق المصادقة الخاص بك.' : 'Enter the code from your authenticator app.')}
                    </p>
                    {error && (
                        <div style={{
                            padding: '1rem',
                            marginBottom: '1.5rem',
                            background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
                            color: '#991b1b',
                            borderRadius: '12px',
                            fontSize: '0.875rem',
                            textAlign: 'center',
                            border: '1px solid #fca5a5',
                            fontWeight: '500'
                        }}>{error}</div>
                    )}

                    {stage === 'credentials' ? (
                        <form onSubmit={handleCredentialsSubmit}>
                            <div style={{ marginBottom: '1.25rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('email')}</label>
                                <input
                                    type="email"
                                    className="input"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value.slice(0, 254))}
                                    required
                                    placeholder={locale === 'ar' ? 'أدخل البريد الإلكتروني' : 'Enter Email'}
                                    maxLength={254}
                                    style={{
                                        padding: '0.625rem 1rem',
                                        height: '42px',
                                        textAlign: locale === 'ar' ? 'right' : 'left',
                                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                                    }}
                                />
                            </div>
                            <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>{t('password')}</label>
                                <input
                                    type={showPassword ? "text" : "password"}
                                    className="input"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value.slice(0, 72))}
                                    required
                                    placeholder={locale === 'ar' ? 'أدخل كلمة المرور' : 'Enter Password'}
                                    maxLength={72}
                                    style={{
                                        padding: '0.625rem 1rem',
                                        height: '42px',
                                        [locale === 'ar' ? 'paddingLeft' : 'paddingRight']: '2.5rem',
                                        textAlign: locale === 'ar' ? 'right' : 'left',
                                        direction: locale === 'ar' ? 'rtl' : 'ltr'
                                    }}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    style={{
                                        position: 'absolute',
                                        [locale === 'ar' ? 'left' : 'right']: '0.75rem',
                                        top: '2.25rem',
                                        background: 'none',
                                        border: 'none',
                                        cursor: 'pointer',
                                        padding: '0.25rem',
                                        display: 'flex',
                                        alignItems: 'center',
                                        color: '#64748b'
                                    }}
                                >
                                    {showPassword ? (
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                            <line x1="1" y1="1" x2="23" y2="23"></line>
                                        </svg>
                                    ) : (
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                            <circle cx="12" cy="12" r="3"></circle>
                                        </svg>
                                    )}
                                </button>
                            </div>

                            {/* Stay Signed In Checkbox */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.5rem',
                                marginBottom: '1.5rem',
                                cursor: 'pointer',
                                userSelect: 'none',
                                justifyContent: locale === 'ar' ? 'flex-end' : 'flex-start'
                            }}
                                onClick={() => setStaySignedIn(!staySignedIn)}
                            >
                                <div style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '4px',
                                    border: '2px solid #667eea',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: staySignedIn ? '#667eea' : 'transparent',
                                    transition: 'all 0.2s ease',
                                    flexShrink: 0
                                }}>
                                    {staySignedIn && (
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                    )}
                                </div>
                                <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                                    {t('stay_signed_in')}
                                </span>
                            </div>

                            <button
                                type="submit"
                                disabled={loading}
                                style={{
                                    width: '100%',
                                    padding: '0.875rem',
                                    background: loading ? '#9ca3af' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '12px',
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: loading ? 'none' : '0 4px 15px rgba(102, 126, 234, 0.4)',
                                }}
                            >
                                {loading ? (
                                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                                        <span style={{
                                            width: '16px',
                                            height: '16px',
                                            border: '2px solid rgba(255,255,255,0.3)',
                                            borderTopColor: 'white',
                                            borderRadius: '50%',
                                            animation: 'spin 0.6s linear infinite'
                                        }}></span>
                                        {t('signing_in')}
                                    </span>
                                ) : t('sign_in')}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleCodeSubmit}>
                            <div style={{ marginBottom: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                                    {isAr ? 'الرمز' : 'Code'}
                                </label>
                                <input
                                    type="text"
                                    inputMode="numeric"
                                    className="input"
                                    value={mfaCode}
                                    onChange={(e) => setMfaCode(e.target.value)}
                                    maxLength={6}
                                    minLength={6}
                                    required
                                    autoFocus
                                    style={{ padding: '0.625rem 1rem', height: '42px', textAlign: 'center', letterSpacing: '0.2em', fontSize: '1.1rem' }}
                                />
                            </div>

                            {stage === 'code' && (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0.5rem',
                                    marginBottom: '1.25rem',
                                    cursor: 'pointer',
                                    userSelect: 'none'
                                }}
                                    onClick={() => setRememberDevice(!rememberDevice)}
                                >
                                    <div style={{
                                        width: '18px',
                                        height: '18px',
                                        borderRadius: '4px',
                                        border: '2px solid #667eea',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        background: rememberDevice ? '#667eea' : 'transparent',
                                        flexShrink: 0
                                    }}>
                                        {rememberDevice && (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                <polyline points="20 6 9 17 4 12"></polyline>
                                            </svg>
                                        )}
                                    </div>
                                    <span style={{ fontSize: '0.875rem', color: '#64748b' }}>
                                        {isAr ? 'تذكر هذا الجهاز لمدة 30 يومًا' : 'Remember this device for 30 days'}
                                    </span>
                                </div>
                            )}

                            {stage === 'recovery' && (
                                <p style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: '1.25rem' }}>
                                    {isAr ? 'لم يصلك؟ تحقق من مجلد الرسائل غير المرغوب فيها.' : "Didn't get it? Check your spam folder."}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                style={{
                                    width: '100%',
                                    padding: '0.875rem',
                                    background: loading ? '#9ca3af' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '12px',
                                    fontSize: '1rem',
                                    fontWeight: '600',
                                    cursor: loading ? 'not-allowed' : 'pointer',
                                    marginBottom: '0.75rem'
                                }}
                            >
                                {loading ? (isAr ? 'جارٍ التحقق...' : 'Verifying...') : (isAr ? 'تحقق' : 'Verify')}
                            </button>

                            {stage === 'code' ? (
                                <button
                                    type="button"
                                    onClick={requestRecoveryCode}
                                    disabled={recoverySending}
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem',
                                        background: 'transparent',
                                        color: '#667eea',
                                        border: 'none',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        cursor: recoverySending ? 'not-allowed' : 'pointer',
                                    }}
                                >
                                    {recoverySending
                                        ? (isAr ? 'جارٍ الإرسال...' : 'Sending...')
                                        : (isAr ? 'إرسال رمز عبر البريد الإلكتروني بدلاً من ذلك' : 'Email me a code instead')}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => { setStage('code'); setMfaCode(''); setError('') }}
                                    style={{
                                        width: '100%',
                                        padding: '0.6rem',
                                        background: 'transparent',
                                        color: '#64748b',
                                        border: 'none',
                                        fontSize: '0.85rem',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                    }}
                                >
                                    {isAr ? 'استخدام تطبيق المصادقة بدلاً من ذلك' : 'Use my authenticator app instead'}
                                </button>
                            )}

                            <button
                                type="button"
                                onClick={() => { setStage('credentials'); setMfaCode(''); setError(''); setPassword('') }}
                                style={{
                                    width: '100%',
                                    padding: '0.6rem',
                                    background: 'transparent',
                                    color: '#94a3b8',
                                    border: 'none',
                                    fontSize: '0.8rem',
                                    cursor: 'pointer',
                                }}
                            >
                                {isAr ? 'رجوع' : 'Back'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
            <LanguageToggleButton variant="fixed" />
        </div>
    )
}
