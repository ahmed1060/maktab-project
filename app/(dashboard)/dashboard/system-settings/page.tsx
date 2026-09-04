'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'

type SystemSettings = {
    id: string
    locationVerifyRadiusMeters: number
    updatedAt: string
}

export default function SystemSettingsPage() {
    const { data: session } = useSession()
    const { showToast } = useToast()
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()

    const [settings, setSettings] = useState<SystemSettings | null>(null)
    const [radiusInput, setRadiusInput] = useState('')
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        setTitle(t('system_settings') || 'System Settings')
        setSubtitle(t('system_settings_subtitle') || 'Platform-wide defaults that apply across all companies')
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    const fetchSettings = useCallback(async () => {
        try {
            const res = await fetch('/api/system-settings')
            if (res.ok) {
                const result = await res.json()
                const data = result.data || result
                setSettings(data)
                setRadiusInput(String(data.locationVerifyRadiusMeters))
            } else {
                showToast(t('failed_fetch_data'), 'error')
            }
        } catch {
            showToast(t('failed_fetch_data'), 'error')
        } finally {
            setLoading(false)
        }
        // t isn't memoized by LanguageContext — listing it here would
        // recreate this callback (and the effect below that depends on its
        // identity) on every render, refetching on every render with it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showToast])

    useEffect(() => {
        fetchSettings()
    }, [fetchSettings])

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!settings) return

        const radius = parseInt(radiusInput, 10)
        if (!Number.isFinite(radius) || radius < 1 || radius > 10000) {
            showToast(t('invalid_radius_value') || 'Enter a radius between 1 and 10000 meters', 'error')
            return
        }

        setSaving(true)
        try {
            const res = await fetch('/api/system-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locationVerifyRadiusMeters: radius })
            })
            if (res.ok) {
                const result = await res.json()
                const data = result.data || result
                setSettings(data)
                setRadiusInput(String(data.locationVerifyRadiusMeters))
                showToast(t('settings_saved_success') || 'Settings saved', 'success')
            } else {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSaving(false)
        }
    }

    if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {loading ? (
                <div style={{ padding: '4rem', textAlign: 'center' }}>
                    <p style={{ color: '#64748b' }}>{t('loading_data')}</p>
                </div>
            ) : (
                <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', maxWidth: '32rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                    <h3 style={{ margin: '0 0 1rem' }}>{t('location_verification_settings') || 'Location Verification'}</h3>
                    <form onSubmit={handleSave}>
                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                            {t('location_verify_radius_label') || 'Auto-verify distance (meters)'}
                        </label>
                        <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 0, marginBottom: '0.75rem' }}>
                            {t('location_verify_radius_hint') || 'A submitted task location within this distance of the task location is auto-approved, for companies that have auto-verify turned on.'}
                        </p>
                        <input
                            type="number"
                            min={1}
                            max={10000}
                            value={radiusInput}
                            disabled={saving}
                            onChange={(e) => setRadiusInput(e.target.value)}
                            className="input-field"
                            style={{ width: '100%', maxWidth: '12rem', padding: '0.6rem 0.85rem', borderRadius: '0.6rem', border: '1px solid rgba(0,0,0,0.1)' }}
                        />
                        <div style={{ marginTop: '1.25rem' }}>
                            <button type="submit" className="btn btn-primary" disabled={saving}>
                                {saving ? t('saving') : t('save_changes_button')}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    )
}
