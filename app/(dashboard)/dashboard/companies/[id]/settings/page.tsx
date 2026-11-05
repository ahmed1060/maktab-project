'use client'

import useSWR from 'swr'
import { useParams } from 'next/navigation'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { fetcher, type SWRError } from '@/lib/swr-fetcher'
import { useViewer } from '@/lib/useCan'
import AccessDenied from '@/components/AccessDenied'
import { Button, EmptyState, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import CompanySettingsTabs, { type CompanySettings } from '@/components/CompanySettingsTabs'
import { existingSettingsTabs, type SettingsExposure } from '@/lib/company-settings-access'

/**
 * A company's settings, as the Super Admin opens them from the company list:
 * every tab that exists for it (ATTENDANCE_PLAN.md §5.2).
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 1):
 * the page header names the company, under a link back to Companies, and
 * loading and failing each say so.
 */
export default function CompanySettingsPage() {
    const params = useParams()
    const { id: companyId } = params as { id: string }
    // Who is looking comes from the layout on the first paint (useViewer), so a
    // Super Admin never sees "Access Restricted" while the session loads.
    const viewer = useViewer()
    const { t } = useLanguage()

    const { data: companyResult, error, isLoading, isValidating, mutate } = useSWR(companyId ? `/api/companies?id=${companyId}` : null, fetcher)
    // With its package, which decides which tabs exist for it.
    const company: (CompanySettings & Pick<SettingsExposure, 'package'>) | null = companyResult ? (companyResult.data || companyResult) : null
    // The cards report what they saved; that becomes the cached copy without
    // asking the server again for what it just said.
    const setCompany = (next: CompanySettings & Pick<SettingsExposure, 'package'>) => { mutate({ data: next }, { revalidate: false }) }

    if (viewer?.role !== 'SUPER_ADMIN') {
        return <AccessDenied superAdmins />
    }

    // The company is the heading: this page is the only answer to "whose
    // settings am I changing", now that opening it no longer moves the global
    // switcher, so the answer belongs where the eye lands first. The back
    // link is a link, so leaving with unsaved edits asks first like any other.
    const header = (
        <PageHeader
            back={{ href: '/dashboard/companies', label: t('companies') }}
            title={company?.name ? <bdi>{company.name}</bdi> : t('company_settings_title')}
            subtitle={company?.name ? t('company_settings_title') : undefined}
        />
    )
    return (
        <Page>
            {header}
            {company ? (
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
            ) : error ? (
                <div className="ui-panel">
                    <EmptyState icon={WarningCircleIcon} title={t('settings_load_failed')} detail={(error as SWRError).info?.error}
                        action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                </div>
            ) : isLoading ? (
                <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
            ) : null}
        </Page>
    )
}
