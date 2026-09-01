'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'

// Shown when an admin has issued a one-time temporary password for this
// account (F-02, replaces the old password-reveal feature). Middleware
// redirects here and blocks the rest of the dashboard until the password
// is changed.
export default function ChangePasswordPage() {
    const { locale } = useLanguage()
    const { data: session, update } = useSession()
    const { showToast } = useToast()
    const router = useRouter()

    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [submitting, setSubmitting] = useState(false)

    const isAr = locale === 'ar'

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (newPassword.length < 8 || newPassword.length > 72) {
            showToast(isAr ? 'يجب أن تتكون كلمة المرور من 8 إلى 72 حرفًا' : 'Password must be 8–72 characters', 'error')
            return
        }
        if (newPassword !== confirmPassword) {
            showToast(isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match', 'error')
            return
        }

        setSubmitting(true)
        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: session?.user?.id, password: newPassword })
            })
            const result = await res.json()

            if (!res.ok || !result.success) {
                throw new Error(result.error || (isAr ? 'فشل تحديث كلمة المرور' : 'Failed to update password'))
            }

            // Clear the flag on the live JWT so middleware stops redirecting here.
            await update({ mustChangePassword: false })
            showToast(isAr ? 'تم تحديث كلمة المرور' : 'Password updated', 'success')
            router.replace('/dashboard')
        } catch (err: any) {
            showToast(err.message || (isAr ? 'حدث خطأ' : 'Something went wrong'), 'error')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem 1rem', direction: isAr ? 'rtl' : 'ltr' }}>
            <div className="glass-card" style={{ maxWidth: '420px', width: '100%', padding: '2rem' }}>
                <h2 style={{ margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
                    {isAr ? 'يجب تغيير كلمة المرور' : 'You must change your password'}
                </h2>
                <p style={{ margin: '0 0 1.5rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                    {isAr
                        ? 'تم تعيين كلمة مرور مؤقتة لحسابك. اختر كلمة مرور جديدة للمتابعة.'
                        : 'A temporary password was set on your account. Choose a new password to continue.'}
                </p>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                            {isAr ? 'كلمة المرور الجديدة' : 'New password'}
                        </label>
                        <input
                            type="password"
                            className="input"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            minLength={8}
                            maxLength={72}
                            required
                            autoFocus
                        />
                    </div>
                    <div style={{ marginBottom: '1.5rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                            {isAr ? 'تأكيد كلمة المرور' : 'Confirm password'}
                        </label>
                        <input
                            type="password"
                            className="input"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            minLength={8}
                            maxLength={72}
                            required
                        />
                    </div>
                    <button type="submit" className="btn" disabled={submitting} style={{ width: '100%' }}>
                        {submitting ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : (isAr ? 'تحديث كلمة المرور' : 'Update password')}
                    </button>
                </form>
            </div>
        </div>
    )
}
