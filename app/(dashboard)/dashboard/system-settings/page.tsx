'use client'

import { useState, useEffect, useCallback } from 'react'
import { useViewer } from '@/lib/useCan'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { DEFAULT_POWERED_BY_NAME } from '@/lib/branding-defaults'
import FaceSystemSwitch from '@/components/FaceSystemSwitch'
import BrandColourCard from '@/components/BrandColourCard'
import { DEFAULT_BRAND } from '@/lib/brand-colour'
import { fetchRetrying } from '@/lib/swr-fetcher'

type SystemSettings = {
    id: string
    locationVerifyRadiusMeters: number
    showPoweredBy: boolean
    poweredByName: string
    defaultTimezone: string
    stepUpMinutes: number
    brandColour: string
    updatedAt: string
}

export default function SystemSettingsPage() {
    // Who is looking comes from the layout on the first paint (useViewer), so a
    // Super Admin never sees "Access Restricted" while the session loads.
    const viewer = useViewer()
    const { showToast } = useToast()
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()

    const [settings, setSettings] = useState<SystemSettings | null>(null)
    const [radiusInput, setRadiusInput] = useState('')
    const [showPoweredBy, setShowPoweredBy] = useState(true)
    const [poweredByName, setPoweredByName] = useState('')
    const [defaultTimezone, setDefaultTimezone] = useState('Africa/Cairo')
    const [stepUpInput, setStepUpInput] = useState('60')
    const [loading, setLoading] = useState(true)
    // One per card. A single flag would disable both Save buttons whenever
    // either was in flight, which reads as the page having frozen.
    const [savingSection, setSavingSection] = useState<null | 'location' | 'calendar' | 'branding' | 'stepUp'>(null)

    useEffect(() => {
        setTitle(t('system_settings') || 'System Settings')
        setSubtitle(t('system_settings_subtitle') || 'Platform-wide defaults that apply across all companies')
        return () => {
            setTitle(null)
            setSubtitle(null)
        }
    }, [setTitle, setSubtitle, t])

    // The server's copy, into every card. Only setters inside, so it is
    // stable and safe to list as an effect dependency.
    const applySettings = useCallback((data: SystemSettings) => {
        setSettings(data)
        setRadiusInput(String(data.locationVerifyRadiusMeters))
        setShowPoweredBy(data.showPoweredBy ?? true)
        setPoweredByName(data.poweredByName ?? '')
        setDefaultTimezone(data.defaultTimezone ?? 'Africa/Cairo')
        setStepUpInput(String(data.stepUpMinutes ?? 60))
    }, [])

    useEffect(() => {
        // Ignored once the page has gone, so a slow answer does not write into
        // a component that is no longer there.
        let ignore = false
        fetchRetrying('/api/system-settings')
            .then(async res => {
                if (!res.ok) throw new Error(String(res.status))
                const result = await res.json()
                if (!ignore) applySettings(result.data || result)
            })
            .catch(() => { if (!ignore) showToast(t('failed_fetch_data'), 'error') })
            .finally(() => { if (!ignore) setLoading(false) })
        return () => { ignore = true }
        // t isn't memoized by LanguageContext — listing it here would re-run
        // this on every render, refetching on every render with it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [applySettings, showToast])

    /**
     * Each card sends only its own fields. Sending the whole settings object
     * from either would let a stale value in the card you did not touch
     * overwrite a change somebody else just made from the other.
     */
    const persist = async (section: 'location' | 'calendar' | 'branding' | 'stepUp', patch: Record<string, unknown>) => {
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
                applySettings(data)
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

    // How long a step-up confirmation lasts (ROLES_PLAN.md §6.15).
    const handleSaveStepUp = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!settings) return
        const minutes = parseInt(stepUpInput, 10)
        if (!Number.isFinite(minutes) || minutes < 5 || minutes > 480) {
            showToast(t('step_up_minutes_invalid'), 'error')
            return
        }
        await persist('stepUp', { stepUpMinutes: minutes })
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

    if (viewer?.role !== 'SUPER_ADMIN') {
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
                        <input aria-label={t('location_verify_radius_label') || 'Auto-verify distance (meters)'}
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
                        <h3 id="default-timezone-label" style={{ margin: '0 0 0.35rem' }}>{t('default_timezone_label')}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0 0 1.25rem' }}>
                            {t('default_timezone_hint')}
                        </p>
                        <input
                            id="default-timezone"
                            aria-labelledby="default-timezone-label"
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
                        onSubmit={handleSaveStepUp}
                        className="glass"
                        style={{ padding: '1.5rem', borderRadius: '1rem', display: 'flex', flexDirection: 'column' }}
                    >
                        <h3 id="step-up-minutes-label" style={{ margin: '0 0 0.35rem' }}>{t('step_up_minutes_label')}</h3>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-soft)', margin: '0 0 1.25rem' }}>
                            {t('step_up_minutes_hint')}
                        </p>
                        <input
                            id="step-up-minutes"
                            aria-labelledby="step-up-minutes-label"
                            className="input"
                            type="number"
                            min={5}
                            max={480}
                            value={stepUpInput}
                            onChange={e => setStepUpInput(e.target.value)}
                            disabled={savingSection === 'stepUp'}
                            style={{ maxWidth: '8rem', marginBottom: '1rem' }}
                        />
                        <div>
                            <button type="submit" className="btn btn-primary" disabled={savingSection !== null}>
                                {savingSection === 'stepUp' ? t('saving') : t('save_changes_button')}
                            </button>
                        </div>
                    </form>

                    <FaceSystemSwitch />

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
                        <input aria-label={t('powered_by_name_label' as any)}
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

                    {/* The default brand colour (UI_PLAN.md §4.6), beside the
                        "Powered by" branding. */}
                    <BrandColourCard
                        saved={settings?.brandColour ?? DEFAULT_BRAND}
                        hint={t('brand_colour_system_hint')}
                        onSave={async brandColour => {
                            if (!brandColour) return false
                            const res = await fetch('/api/system-settings', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ brandColour }),
                            }).catch(() => null)
                            if (!res?.ok) return false
                            const result = await res.json().catch(() => null)
                            if (result?.data) applySettings(result.data)
                            return true
                        }}
                    />
                </div>
            )}
        </div>
    )
}
