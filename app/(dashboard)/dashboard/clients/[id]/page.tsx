'use client'

import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { useParams, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { PlusIcon, StorefrontIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import AccessDenied from '@/components/AccessDenied'
import LoadingSpinner from '@/components/LoadingSpinner'
import { Button, Card, Details, EmptyState, Page, PageHeader, Section } from '@/components/ui'
import RecordsList from '@/components/records/RecordsList'
import SectionsCard from '@/components/records/SectionsCard'
import type { SectionItem } from '@/components/records/types'
import { fetcher } from '@/lib/swr-fetcher'
import { useModules } from '@/lib/useModules'
import { useCan } from '@/lib/useCan'

type Client = {
    id: string
    name: string
    ownerName: string
    mobileNumber: string
    locationName: string
    locationLink: string | null
}

/**
 * A client's own page (CLIENTS_PLAN.md §0.2): its details, for whoever may
 * see clients, and its records, for whoever may see records. Someone who may
 * see only records, as an ordinary employee may, still gets the client's
 * name and its records.
 */
export default function ClientPage() {
    const { t } = useLanguage()
    const modules = useModules()
    const { id } = useParams<{ id: string }>()
    const params = useSearchParams()
    const openRecordId = params.get('record')
    const { data: session } = useSession()
    const { can } = useCan()
    const seesClient = can('clients.view')
    const seesRecords = can('records.view')
    const [adding, setAdding] = useState(false)
    const { mutate } = useSWRConfig()

    const { data: clientBody, error: clientError, isLoading: clientLoading, mutate: reloadClient } = useSWR<{ data: Client }>(seesClient ? `/api/clients?id=${encodeURIComponent(id)}` : null, fetcher)
    const { data: sectionsBody, error: sectionsError, isLoading: sectionsLoading, mutate: reloadSections } = useSWR<{ data: { client: { id: string; name: string }; sections: SectionItem[] } }>(
        seesRecords ? `/api/records/sections?clientId=${encodeURIComponent(id)}` : null, fetcher,
    )

    if (!session?.user) return <LoadingSpinner />
    if (!seesClient && !seesRecords) return <AccessDenied />
    if ((clientLoading && !clientBody) || (sectionsLoading && !sectionsBody)) return <LoadingSpinner />

    const client = clientBody?.data
    const name = client?.name ?? sectionsBody?.data.client.name
    const sections = sectionsBody?.data.sections ?? []
    // Its details didn't load, though its name came with its sections: said, not left out.
    const detailsFailed = seesClient && !clientBody
    // Its sections didn't load: not "none", which would have the form start a first one.
    const sectionsFailed = seesRecords && !sectionsBody
    const back = seesClient ? { href: '/dashboard/clients', label: modules.label('clients') } : { href: '/dashboard/records', label: modules.label('records') }

    if (!name) {
        const missing = (clientError as { status?: number } | undefined)?.status === 404 || (sectionsError as { status?: number } | undefined)?.status === 404
        return (
            <Page>
                <PageHeader title={modules.label('clients')} back={back} />
                <div className="ui-panel">
                    {missing
                        ? <EmptyState icon={StorefrontIcon} title={t('client_not_found')} />
                        : <EmptyState icon={WarningCircleIcon} title={t('client_load_failed')} action={<Button onClick={() => { void reloadClient(); void reloadSections() }}>{t('try_again')}</Button>} />}
                </div>
            </Page>
        )
    }

    return (
        <Page>
            <PageHeader
                title={<bdi>{name}</bdi>}
                back={back}
                action={seesRecords && !sectionsFailed && can('records.contribute') && <Button variant="primary" icon={PlusIcon} onClick={() => setAdding(true)}>{t('records_add')}</Button>}
            />

            {client && (
                <Card title={t('client_details')}>
                    <Details items={[
                        { label: t('client_owner_name'), value: client.ownerName },
                        { label: t('client_mobile_number'), value: <a href={`tel:${client.mobileNumber.replace(/[^0-9+]/g, '')}`}><bdi>{client.mobileNumber}</bdi></a> },
                        {
                            label: t('client_location'),
                            value: client.locationLink
                                ? <a href={client.locationLink} target="_blank" rel="noopener noreferrer">{client.locationName}<span className="ui-visually-hidden"> {t('ui_opens_new_tab')}</span></a>
                                : client.locationName,
                        },
                    ]} />
                </Card>
            )}

            {detailsFailed && (
                <Card title={t('client_details')}>
                    <EmptyState icon={WarningCircleIcon} title={t('client_details_failed')} action={<Button onClick={() => { void reloadClient() }}>{t('try_again')}</Button>} />
                </Card>
            )}

            {sectionsFailed && (
                <Section title={modules.label('records')}>
                    <div className="ui-panel">
                        <EmptyState icon={WarningCircleIcon} title={t('records_load_failed')} action={<Button onClick={() => { void reloadSections() }}>{t('try_again')}</Button>} />
                    </div>
                </Section>
            )}
            {seesRecords && !sectionsFailed && (
                <>
                    <Section title={modules.label('records')}>
                        <RecordsList
                            clientId={id}
                            sections={sections}
                            adding={adding && can('records.contribute')}
                            onAddingChange={setAdding}
                            onChanged={() => { void reloadSections() }}
                            openRecordId={openRecordId}
                        />
                    </Section>
                    {/* A renamed or deleted section changes the records listed above too. */}
                    <SectionsCard clientId={id} sections={sections} onChanged={() => {
                        void reloadSections()
                        void mutate(key => Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/api/records?'))
                    }} />
                </>
            )}
        </Page>
    )
}
