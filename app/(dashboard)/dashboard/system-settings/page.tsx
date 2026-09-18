'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { DEFAULT_POWERED_BY_NAME } from '@/lib/services/system-settings.service'

type SystemSettings = {
    id: string
    locationVerifyRadiusMeters: number
    showPoweredBy: boolean
    poweredByName: string
    defaultTimezone: string
    updatedAt: string
}

export default function SystemSettingsPage() {
    const { data: session } = useSession()
    const { showToast } = useToast()
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()

    const [settings, setSettings] = useState<SystemSettings | null>(null)
    const [radiusInput, setRadiusInput] = useState('')
    const [showPoweredBy, setShowPoweredBy] = useState(true)
    const [poweredByName, setPoweredByName] = useState('')
    const [defaultTimezone, setDefaultTimezone] = useState('Africa/Cairo')
    const [loading, setLoading] = useState(true)
    // One per card. A single flag would disable both Save buttons whenever
    // either was in flight, which reads as the page having frozen.
    const [savingSection, setSavingSection] = useState<null | 'location' | 'calendar' | 'branding'>(null)

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
                setShowPoweredBy(data.showPoweredBy ?? true)
                setPoweredByName(data.poweredByName ?? '')
                setDefaultTimezone(data.defaultTimezone ?? 'Africa/Cairo')
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

    /**
     * Each card sends only its own fields. Sending the whole settings object
     * from either would let a stale value in the card you did not touch
     * overwrite a change somebody else just made from the other.
     */
    const persist = async (section: 'location' | 'calendar' | 'branding', patch: Record<string, unknown>) => {
        setSavingSection(section)
        try {
            const res = await fetch('/api/system-settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            })
            if (res.ok) {
                const result = await res.json()
                const data = result.data || result
                // The server's copy wins on every field, not just the ones this
                // card sent, so the other card reflects reality after a save.
                setSettings(data)
                setRadiusInput(String(data.locationVerifyRadiusMeters))
                setShowPoweredBy(data.showPoweredBy ?? true)
                setPoweredByName(data.poweredByName ?? '')
                setDefaultTimezone(data.defaultTimezone ?? 'Africa/Cairo')
                showToast(t('settings_saved_success') || 'Settings saved', 'success')
            } else {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSavingSection(null)
        }
    }

    const handleSaveLocation = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!settings) return

        const radius = parseInt(radiusInput, 10)
        if (!Number.isFinite(radius) || radius < 1 || radius > 10000) {
            showToast(t('invalid_radius_value') || 'Enter a radius between 1 and 10000 meters', 'error')
            return
        }

        await persist('location', { locationVerifyRadiusMeters: radius })
    }

    // Its own section rather than a field on the location form: the calendar
    // decides which month a record belongs to, which has nothing to do with how
    // far from a target somebody stood.
    const handleSaveCalendar = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!settings) return
        await persist('calendar', { defaultTimezone })
    }

    const handleSaveBranding = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!settings) return

        await persist('branding', {
            showPoweredBy,
            // Trimmed here and defaulted on the way out, so a field cleared by
            // accident restores the default name rather than rendering
            // "Powered by" followed by nothing.
            poweredByName: poweredByName.trim() || DEFAULT_POWERED_BY_NAME,
        })
    }

    if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            {loading ? (
                <div style={{ padding: '4rem', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-soft)' }}>{t('loading_data')}</p>
                </div>
            ) : (
                /* Two independent cards rather than one panel with a divider.
                   Each owns its own Save, because a card is a unit: sharing one
                   button leaves it belonging to neither, and makes changing a
                   name resubmit a distance nobody touched.

                   Side by side once there is room for both at a comfortable
                   reading width, stacked below that. The old single column left
                   most of a wide screen empty. */
                <div style={{
                    display: 'grid',
                    gap: '1.25rem',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))',
                    alignItems: 'start',
                    maxWidth: '64rem',
                    textAlign: locale === 'ar' ? 'right' : 'left',
                }}>
                    <form
                        onSubmit={handleSaveLocation}
                        className="glass"
                        style={{ padding: '1.5rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column' }}
                    >
                        <h3 style={{ margin: '0 0 0.35rem' }}>{t('location_verification_settings') || 'Location Verification'}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0 0 1.25rem' }}>
                            {t('location_verify_radius_hint') || 'A submitted task location within this distance of the task location is auto-approved, for companies that have auto-verify turned on.'}
                        </p>

                        <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500 }}>
                            {t('location_verify_radius_label') || 'Auto-verify distance (meters)'}
                        </label>
                        <input
                            type="number"
                            min={1}
                            max={10000}
                            value={radiusInput}
                            disabled={savingSection === 'location'}
                            onChange={(e) => setRadiusInput(e.target.value)}
                            className="input-field"
                            style={{ width: '100%', maxWidth: '12rem', padding: '0.6rem 0.85rem', borderRadius: '0.6rem', border: '1px solid var(--hairline-firm)' }}
                        />

                        {/* Pushed to the bottom so both cards' buttons line up
                            when they sit side by side at unequal heights. */}
                        <div style={{ marginTop: 'auto', paddingTop: '1.5rem' }}>
                            <button type="submit" className="btn btn-primary" disabled={savingSection !== null}>
                                {savingSection === 'location' ? t('saving') : t('save_changes_button')}
                            </button>
                        </div>
                    </form>

                    <form
                        onSubmit={handleSaveCalendar}
                        className="glass"
                        style={{ padding: '1.5rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column' }}
                    >
                        <h3 style={{ margin: '0 0 0.35rem' }}>{t('default_timezone_label')}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0 0 1.25rem' }}>
                            {t('default_timezone_hint')}
                        </p>
                        <input
                            id="default-timezone"
                            className="input"
                            value={defaultTimezone}
                            onChange={e => setDefaultTimezone(e.target.value)}
                            disabled={savingSection === 'calendar'}
                            style={{ maxWidth: '18rem', marginBottom: '1rem' }}
                        />
                        <div>
                            <button type="submit" className="btn btn-primary" disabled={savingSection !== null}>
                                {savingSection === 'calendar' ? t('saving') : t('save_changes_button')}
                            </button>
                        </div>
                    </form>

                    <form
                        onSubmit={handleSaveBranding}
                        className="glass"
                        style={{ padding: '1.5rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column' }}
                    >
                        <h3 style={{ margin: '0 0 0.35rem' }}>{t('branding_settings' as any)}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0 0 1.25rem' }}>
                            {t('powered_by_hint' as any)}
                        </p>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={showPoweredBy}
                                disabled={savingSection === 'branding'}
                                onChange={(e) => setShowPoweredBy(e.target.checked)}
                                style={{ width: '1.05rem', height: '1.05rem', cursor: 'pointer' }}
                            />
                            <span style={{ fontWeight: 500 }}>{t('show_powered_by_label' as any)}</span>
                        </label>

                        <label style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500, opacity: showPoweredBy ? 1 : 0.5 }}>
                            {t('powered_by_name_label' as any)}
                        </label>
                        <input
                            type="text"
                            maxLength={40}
                            value={poweredByName}
                            /* Disabled rather than hidden when the mark is off:
                               the field vanishing would suggest the name was
                               lost, when it is only not being shown. */
                            disabled={savingSection === 'branding' || !showPoweredBy}
                            placeholder={DEFAULT_POWERED_BY_NAME}
                            onChange={(e) => setPoweredByName(e.target.value)}
                            className="input-field"
                            style={{ width: '100%', maxWidth: '16rem', padding: '0.6rem 0.85rem', borderRadius: '0.6rem', border: '1px solid var(--hairline-firm)' }}
                        />

                        {/* What it will actually look like, so the result is
                            checkable before saving rather than after. */}
                        <div style={{ marginTop: '1rem', padding: '0.85rem 1rem', borderRadius: '0.6rem', background: 'var(--hairline)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.1rem', opacity: showPoweredBy ? 1 : 0.35 }}>
                            {showPoweredBy ? (
                                <>
                                    <span style={{ fontSize: '0.45rem', color: 'var(--text-soft)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                        {t('powered_by')}
                                    </span>
                                    <span style={{ fontSize: '1.35rem', color: 'var(--text-main)', fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                                        {poweredByName.trim() || DEFAULT_POWERED_BY_NAME}
                                    </span>
                                </>
                            ) : (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-soft)' }}>{t('powered_by_hidden' as any)}</span>
                            )}
                        </div>

                        <div style={{ marginTop: 'auto', paddingTop: '1.5rem' }}>
                            <button type="submit" className="btn btn-primary" disabled={savingSection !== null}>
                                {savingSection === 'branding' ? t('saving') : t('save_changes_button')}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    )
}
