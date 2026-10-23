'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { PlusIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import AccessDenied from '@/components/AccessDenied'
import { Button, Page, PageHeader } from '@/components/ui'
import RecordsList from '@/components/records/RecordsList'
import { useModules } from '@/lib/useModules'
import { useCan } from '@/lib/useCan'

/**
 * Every record across the company's clients (CLIENTS_PLAN.md §0.2), with
 * search and an "Expiring soon" filter. Add record here asks which client
 * it's for in the same form, and the record is added without leaving.
 */
export default function RecordsPage() {
    const { t } = useLanguage()
    const modules = useModules()
    const { data: session } = useSession()
    const { can } = useCan()
    const [adding, setAdding] = useState(false)

    // Once the session is known: before it loads nobody holds anything.
    if (session?.user && !can('records.view')) return <AccessDenied />

    return (
        <Page>
            <PageHeader
                title={modules.label('records')}
                subtitle={t('records_subtitle')}
                action={can('records.contribute') && <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{t('records_add')}</Button>}
            />
            <RecordsList adding={adding && can('records.contribute')} onAddingChange={setAdding} />
        </Page>
    )
}
