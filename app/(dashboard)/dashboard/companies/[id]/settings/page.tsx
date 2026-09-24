'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import CompanyModulesCard from '@/components/CompanyModulesCard'
import CompanyLogoCard from '@/components/CompanyLogoCard'
import CompanyPayrollCard from '@/components/CompanyPayrollCard'
import type { ModuleOverrides } from '@/lib/modules'

type Company = {
    id: string
    name: string
    autoVerifyLocation: boolean
    moduleLabels: unknown
    moduleIcons: unknown
    logoUrl: string | null
    payrollDay: number
    payslipsVisible: boolean
    timezone: string
    debtRecoveryPercent: number
}

export default function CompanySettingsPage() {
    const params = useParams()
    const router = useRouter()
    const { id: companyId } = params as { id: string }
    const { data: session } = useSession()
    const { showToast } = useToast()
    const { t, locale } = useLanguage()

    const { data: companyResult, isLoading: loading, mutate } = useSWR(
        companyId ? `/api/companies?id=${companyId}` : null,
        fetcher,
        { onError: () => showToast(t('failed_fetch_data'), 'error') },
    )
    const company: Company | null = companyResult ? (companyResult.data || companyResult) : null
    // The cards report what they saved; that becomes the cached copy without
    // asking the server again for what it just said.
    const setCompany = (next: Company) => { mutate({ data: next }, { revalidate: false }) }
    const [savingSettings, setSavingSettings] = useState(false)

    const handleToggleAutoVerify = async () => {
        if (!company) return
        const next = !company.autoVerifyLocation
        setSavingSettings(true)
        try {
            const res = await fetch('/api/companies', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: companyId, autoVerifyLocation: next })
            })
            if (res.ok) {
                setCompany({ ...company, autoVerifyLocation: next })
                showToast(t('settings_saved_success') || 'Settings saved', 'success')
            } else {
                const data = await res.json().catch(() => ({}))
                showToast(data.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setSavingSettings(false)
        }
    }

    if (!session?.user || session.user.role !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ marginBottom: '2rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                <button
                    onClick={() => router.push('/dashboard/companies')}
                    className="glass"
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '0.75rem',
                        color: 'var(--primary)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        border: '1px solid var(--veil-40)',
                        transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`,
                        float: locale === 'ar' ? 'right' : 'left',
                        cursor: 'pointer'
                    }}
                    onMouseOver={(e) => {
                        e.currentTarget.style.transform = `translateY(-4px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        e.currentTarget.style.background = 'var(--panel-90)'
                    }}
                    onMouseOut={(e) => {
                        e.currentTarget.style.transform = `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`
                        e.currentTarget.style.background = 'var(--panel-70)'
                    }}
                    title={t('back_to_companies')}
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="19" y1="12" x2="5" y2="12"></line>
                        <polyline points="12 19 5 12 12 5"></polyline>
                    </svg>
                </button>
                <div style={{ clear: 'both' }}></div>
                {/* The company is the heading, not a strong tag in the line
                    under it. This page is the only answer to "whose settings am
                    I changing" now that opening it no longer moves the global
                    switcher, so the answer belongs where the eye lands first. */}
                <h1 style={{ margin: 0 }}>{company?.name || t('company_settings_title') || 'Company Settings'}</h1>
                <p style={{ color: 'var(--text-soft)', marginTop: '0.25rem' }}>{t('company_settings_title') || 'Company Settings'}</p>
            </div>

            {loading ? (
                <div style={{ padding: '4rem', textAlign: 'center' }}>
                    <p style={{ color: 'var(--text-soft)' }}>{t('loading_data')}</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxWidth: '40rem' }}>
                    <div className="glass" style={{ padding: '1.5rem', borderRadius: '1rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                        {/* Not a <label> wrapping the whole row on purpose — a label
                            wrapping the description text means clicking anywhere in
                            the row toggles a live setting, which is too easy to hit
                            by accident. Only the checkbox itself is interactive. */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', flexDirection: locale === 'ar' ? 'row-reverse' : 'row' }}>
                            <input
                                type="checkbox"
                                checked={!!company?.autoVerifyLocation}
                                disabled={savingSettings || !company}
                                onChange={handleToggleAutoVerify}
                                style={{ width: '1.1rem', height: '1.1rem', marginTop: '0.15rem', cursor: savingSettings ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                            />
                            <div>
                                <div style={{ fontWeight: 500 }}>{t('auto_verify_location_label') || 'Auto-verify submitted task locations'}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-soft)', marginTop: '0.15rem' }}>
                                    {t('auto_verify_location_hint') || 'When on, a location submitted within the system’s distance setting is marked correct automatically. When off, every submitted location needs manual review.'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {company && (
                        <CompanyLogoCard
                            companyId={companyId}
                            companyName={company.name}
                            logoUrl={company.logoUrl}
                            onChanged={(logoUrl: string | null) => setCompany({ ...company, logoUrl })}
                        />
                    )}

                    {company && (
                        <CompanyPayrollCard
                            companyId={companyId}
                            payrollDay={company.payrollDay}
                            payslipsVisible={company.payslipsVisible}
                            timezone={company.timezone}
                            debtRecoveryPercent={company.debtRecoveryPercent}
                            onSaved={next => setCompany({ ...company, ...next })}
                        />
                    )}

                    {/* Replaces the Vendors-only rename this screen used to
                        carry: every module can be renamed now, and Vendors is
                        just one of the nine. */}
                    {company && (
                        <CompanyModulesCard
                            companyId={companyId}
                            moduleLabels={company.moduleLabels}
                            moduleIcons={company.moduleIcons}
                            onSaved={(labels: ModuleOverrides | null, icons: ModuleOverrides | null) =>
                                setCompany({ ...company, moduleLabels: labels, moduleIcons: icons })
                            }
                        />
                    )}
                </div>
            )}
        </div>
    )
}
