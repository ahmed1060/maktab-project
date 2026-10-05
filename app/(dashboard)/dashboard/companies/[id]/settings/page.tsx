'use client'

import useSWR from 'swr'
import { fetcher } from '@/lib/swr-fetcher'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useViewer } from '@/lib/useCan'
import AccessDenied from '@/components/AccessDenied'
import { useToast } from '@/context/ToastContext'
import { useLanguage } from '@/context/LanguageContext'
import CompanySettingsTabs, { type CompanySettings } from '@/components/CompanySettingsTabs'
import { existingSettingsTabs, type SettingsExposure } from '@/lib/company-settings-access'

export default function CompanySettingsPage() {
    const params = useParams()
    const { id: companyId } = params as { id: string }
    // Who is looking comes from the layout on the first paint (useViewer), so a
    // Super Admin never sees "Access Restricted" while the session loads.
    const viewer = useViewer()
    const { showToast } = useToast()
    const { t, locale } = useLanguage()

    const { data: companyResult, isLoading: loading, mutate } = useSWR(
        companyId ? `/api/companies?id=${companyId}` : null,
        fetcher,
        { onError: () => showToast(t('failed_fetch_data'), 'error') },
    )
    // With its package, which decides which tabs exist for it.
    const company: (CompanySettings & Pick<SettingsExposure, 'package'>) | null = companyResult ? (companyResult.data || companyResult) : null
    // The cards report what they saved; that becomes the cached copy without
    // asking the server again for what it just said.
    const setCompany = (next: CompanySettings & Pick<SettingsExposure, 'package'>) => { mutate({ data: next }, { revalidate: false }) }

    if (viewer?.role !== 'SUPER_ADMIN') {
        return <AccessDenied />
    }

    return (
        <div className="animate-in fade-in duration-500" style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <div style={{ marginBottom: '2rem', textAlign: locale === 'ar' ? 'right' : 'left' }}>
                {/* A link, so leaving with unsaved edits asks first like any other. */}
                <Link
                    href="/dashboard/companies"
                    className="glass"
                    style={{
                        width: '40px',
                        height: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: '0.75rem',
                        color: 'var(--brand-primary-text)',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                        border: '1px solid var(--veil-40)',
                        transform: `translateY(-2px)${locale === 'ar' ? ' scaleX(-1)' : ''}`,
                        float: locale === 'ar' ? 'right' : 'left',
                        cursor: 'pointer',
                        boxSizing: 'border-box'
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
                </Link>
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
            ) : company && (
                <CompanySettingsTabs
                    company={company}
                    onSaved={next => setCompany({ ...company, ...next })}
                    // Only the tabs that exist for this company: a module's tab
                    // (Attendance) only when its package holds the module, as the
                    // server's own check and the company's admins already have it.
                    // Before, it showed every tab, and a module tab could only fail.
                    tabs={existingSettingsTabs(company)}
                    superAdmin
                />
            )}
        </div>
    )
}
