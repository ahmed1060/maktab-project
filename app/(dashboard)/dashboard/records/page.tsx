'use client'

import { useSession } from 'next-auth/react'
import { useLanguage } from '@/context/LanguageContext'
import AccessDenied from '@/components/AccessDenied'
import { Page, PageHeader } from '@/components/ui'
import RecordsList from '@/components/records/RecordsList'
import { useModules } from '@/lib/useModules'
import { useCan } from '@/lib/useCan'

/**
 * Every record across the company's clients (CLIENTS_PLAN.md §0.2), with
 * search and an "Expiring soon" filter. Records are added on each client's
 * page, where their sections are.
 */
export default function RecordsPage() {
    const { t } = useLanguage()
    const modules = useModules()
    const { data: session } = useSession()
    const { can } = useCan()

    // Once the session is known: before it loads nobody holds anything.
    if (session?.user && !can('records.view')) return <AccessDenied />

    return (
        <Page>
            <PageHeader title={modules.label('records')} subtitle={t('records_subtitle')} />
            <RecordsList />
        </Page>
    )
}
