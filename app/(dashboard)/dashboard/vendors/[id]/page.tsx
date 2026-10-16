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

type Vendor = {
    id: string
    name: string
    ownerName: string
    mobileNumber: string
    locationName: string
    locationLink: string | null
}

/**
 * A client's own page (CLIENTS_PLAN.md §0.2): its details, for whoever may
 * see vendors, and its records, for whoever may see records. Someone who may
 * see only records, as an ordinary employee may, still gets the client's
 * name and its records.
 */
export default function VendorPage() {
    const { t } = useLanguage()
    const modules = useModules()
    const { id } = useParams<{ id: string }>()
    const params = useSearchParams()
    const openRecordId = params.get('record')
    const { data: session } = useSession()
    const { can } = useCan()
    const seesVendor = can('vendors.view')
    const seesRecords = can('records.view')
    // Arriving from the Records page's Add record (?add=1), with the form open.
    const [adding, setAdding] = useState(params.get('add') === '1')
    const { mutate } = useSWRConfig()

    const { data: vendorBody, error: vendorError, isLoading: vendorLoading, mutate: reloadVendor } = useSWR<{ data: Vendor }>(seesVendor ? `/api/vendors?id=${encodeURIComponent(id)}` : null, fetcher)
    const { data: sectionsBody, error: sectionsError, isLoading: sectionsLoading, mutate: reloadSections } = useSWR<{ data: { client: { id: string; name: string }; sections: SectionItem[] } }>(
        seesRecords ? `/api/records/sections?vendorId=${encodeURIComponent(id)}` : null, fetcher,
    )

    if (!session?.user) return <LoadingSpinner />
    if (!seesVendor && !seesRecords) return <AccessDenied />
    if ((vendorLoading && !vendorBody) || (sectionsLoading && !sectionsBody)) return <LoadingSpinner />

    const vendor = vendorBody?.data
    const name = vendor?.name ?? sectionsBody?.data.client.name
    const sections = sectionsBody?.data.sections ?? []
    // Its sections didn't load: not "none", which would have the form start a first one.
    const sectionsFailed = seesRecords && !sectionsBody
    const back = seesVendor ? { href: '/dashboard/vendors', label: modules.label('vendors') } : { href: '/dashboard/records', label: modules.label('records') }

    if (!name) {
        const missing = (vendorError as { status?: number } | undefined)?.status === 404 || (sectionsError as { status?: number } | undefined)?.status === 404
        return (
            <Page>
                <PageHeader title={modules.label('vendors')} back={back} />
                <div className="ui-panel">
                    {missing
                        ? <EmptyState icon={StorefrontIcon} title={t('vendor_not_found')} />
                        : <EmptyState icon={WarningCircleIcon} title={t('vendor_load_failed')} action={<Button onClick={() => { void reloadVendor(); void reloadSections() }}>{t('try_again')}</Button>} />}
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

            {vendor && (
                <Card title={t('vendor_details')}>
                    <Details items={[
                        { label: t('vendor_owner_name'), value: vendor.ownerName },
                        { label: t('vendor_mobile_number'), value: <a href={`tel:${vendor.mobileNumber.replace(/[^0-9+]/g, '')}`}><bdi>{vendor.mobileNumber}</bdi></a> },
                        {
                            label: t('vendor_location'),
                            value: vendor.locationLink
                                ? <a href={vendor.locationLink} target="_blank" rel="noopener noreferrer">{vendor.locationName}<span className="ui-visually-hidden"> {t('ui_opens_new_tab')}</span></a>
                                : vendor.locationName,
                        },
                    ]} />
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
                            vendorId={id}
                            sections={sections}
                            adding={adding && can('records.contribute')}
                            onAddingChange={setAdding}
                            onChanged={() => { void reloadSections() }}
                            openRecordId={openRecordId}
                        />
                    </Section>
                    {/* A renamed or deleted section changes the records listed above too. */}
                    <SectionsCard vendorId={id} sections={sections} onChanged={() => {
                        void reloadSections()
                        void mutate(key => Array.isArray(key) && typeof key[0] === 'string' && key[0].startsWith('/api/records?'))
                    }} />
                </>
            )}
        </Page>
    )
}
