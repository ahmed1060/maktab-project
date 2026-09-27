'use client'

import { useEffect } from 'react'
import useSWR from 'swr'
import AccessDenied from '@/components/AccessDenied'
import CompanySettingsTabs, { type CompanySettings } from '@/components/CompanySettingsTabs'
import { useLanguage } from '@/context/LanguageContext'
import { useHeader } from '@/context/HeaderContext'
import { fetcher } from '@/lib/swr-fetcher'
import type { CompanySettingsTabKey } from '@/lib/company-settings-tabs'

/**
 * A company's own settings, for its people (ATTENDANCE_PLAN.md §5.2): the tabs
 * the Super Admin shows the company, to whoever holds settings.view. The same
 * tabs the Super Admin uses, filtered by the server.
 */
export default function CompanyOwnSettingsPage() {
    const { t, locale } = useLanguage()
    const { setTitle, setSubtitle } = useHeader()
    const { data, error, isLoading, mutate } = useSWR('/api/company-settings', fetcher, { shouldRetryOnError: false })

    useEffect(() => {
        setTitle(t('company_settings_title'))
        setSubtitle(t('company_settings_own_hint'))
        return () => { setTitle(null); setSubtitle(null) }
    }, [t, setTitle, setSubtitle])

    if (error) return <AccessDenied />
    if (isLoading || !data?.data) {
        return <p style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-soft)' }}>{t('loading_data')}</p>
    }

    const { company, tabs, canEdit } = data.data as { company: CompanySettings; tabs: CompanySettingsTabKey[]; canEdit: boolean }
    return (
        <div style={{ direction: locale === 'ar' ? 'rtl' : 'ltr' }}>
            <CompanySettingsTabs
                company={company}
                tabs={tabs}
                readOnly={!canEdit}
                superAdmin={false}
                onSaved={next => mutate({ data: { ...data.data, company: { ...company, ...next } } }, { revalidate: false })}
            />
        </div>
    )
}
