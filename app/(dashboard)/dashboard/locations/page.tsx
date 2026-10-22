'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { PlusIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import AccessDenied from '@/components/AccessDenied'
import { Button, Page, PageHeader } from '@/components/ui'
import LocationsList from '@/components/locations/LocationsList'
import { useModules } from '@/lib/useModules'
import { useCan } from '@/lib/useCan'

/**
 * Every place tasks happen at (CLIENTS_PLAN.md §2.4): each client's HQ and
 * its other locations, and the shared ones no client owns. Add location
 * here asks whose it is in the same form.
 */
export default function LocationsPage() {
    const { t } = useLanguage()
    const modules = useModules()
    const { data: session } = useSession()
    const { can } = useCan()
    const [adding, setAdding] = useState(false)

    // Once the session is known: before it loads nobody holds anything.
    if (session?.user && !can('locations.view')) return <AccessDenied />

    return (
        <Page>
            <PageHeader
                title={modules.label('locations')}
                subtitle={t('locations_subtitle')}
                action={can('locations.add') && <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{t('locations_add')}</Button>}
            />
            <LocationsList adding={adding && can('locations.add')} onAddingChange={setAdding} />
        </Page>
    )
}
