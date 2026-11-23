'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { PlusIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import AccessDenied from '@/components/AccessDenied'
import { Button, Page, PageHeader } from '@/components/ui'
import SavedLists from '@/components/lists/SavedLists'
import { useCan } from '@/lib/useCan'

/**
 * The company's saved lists of cost names and task titles, to manage
 * (CLIENTS_PLAN.md §5.6), for whoever renames, merges or archives names
 * (PR 379). Adding one is lists.add's, which none of those includes.
 */
export default function SavedListsPage() {
    const { t } = useLanguage()
    const { data: session } = useSession()
    const { can } = useCan()
    const [adding, setAdding] = useState(false)

    // Once the session is known: before it loads nobody holds anything.
    if (session?.user && !(can('lists.rename') || can('lists.merge') || can('lists.archive'))) return <AccessDenied />

    return (
        <Page>
            <PageHeader
                title={t('saved_lists_title')}
                subtitle={t('saved_lists_subtitle')}
                action={can('lists.add') && <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{t('lists_add_name')}</Button>}
            />
            <SavedLists adding={adding && can('lists.add')} onAddingChange={setAdding} />
        </Page>
    )
}
