'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { HourglassIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import AccessDenied from '@/components/AccessDenied'
import CompanySettingsTabs, { type CompanySettings } from '@/components/CompanySettingsTabs'
import { Button, EmptyState, Page, PageHeader } from '@/components/ui'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import type { CompanySettingsTabKey } from '@/lib/company-settings-tabs'

/**
 * A company's own settings, for its people (ATTENDANCE_PLAN.md §5.2): the tabs
 * the Super Admin shows the company, to whoever holds settings.view. The same
 * tabs the Super Admin uses, filtered by the server.
 *
 * On the building blocks (UI_PLAN.md §5 step 5, company settings part 1):
 * the page header, and loading and failing each saying so.
 */
export default function CompanyOwnSettingsPage() {
    const { t } = useLanguage()
    const { data: session } = useSession()
    // The Super Admin has no company of their own: they reach every company's
    // settings from the company list, so there is nothing to ask for here.
    const superAdmin = session?.user?.role === 'SUPER_ADMIN'
    const { data, error, isLoading, isValidating, mutate } = useSWR(session && !superAdmin ? '/api/company-settings' : null, fetcher)

    // A refusal is the answer, not a failure: there is nothing to try again.
    const status = (error as SWRError | undefined)?.status
    const refused = status === 401 || status === 403
    if (superAdmin || refused) return <AccessDenied />

    const header = <PageHeader title={t('company_settings_title')} subtitle={t('company_settings_own_hint')} />
    if (error && !data?.data) return (
        <Page>
            {header}
            <div className="ui-panel">
                <EmptyState icon={WarningCircleIcon} title={t('settings_load_failed')} detail={(error as SWRError).info?.error}
                    action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
            </div>
        </Page>
    )
    if (isLoading || !data?.data) return (
        <Page>
            {header}
            <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>
        </Page>
    )

    const { company, tabs, canEdit } = data.data as { company: CompanySettings; tabs: CompanySettingsTabKey[]; canEdit: boolean }
    return (
        <Page>
            {header}
            <CompanySettingsTabs
                company={company}
                tabs={tabs}
                readOnly={!canEdit}
                superAdmin={false}
                onSaved={next => mutate({ data: { ...data.data, company: { ...company, ...next } } }, { revalidate: false })}
            />
        </Page>
    )
}
