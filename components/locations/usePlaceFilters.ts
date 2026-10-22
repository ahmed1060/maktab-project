'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { locationLabel } from '@/lib/locations'
import { NO_CLIENT } from '@/lib/place-filters'
import type { BulkPlace } from '@/lib/bulk-locations'

type Option = { value: string; label: string }

/** A select in the filter bar's panel (components/EmployeeFilter.tsx). */
export type ExtraFilter = {
    key: string
    label: string
    value: string
    /** Its options, or, for one that follows another, its options for what's picked there. */
    options: Option[] | ((picked: Record<string, string>) => Option[])
}

/**
 * The client and location filters (CLIENTS_PLAN.md §3) for the Tasks and
 * Costs pages' filter bar, from the address's `clientId` and `locationId`:
 * the client filter for whoever may see clients, with "No client"; the
 * location filter for whoever may see locations, offering the picked
 * client's and the shared ones. A Super Admin picks a company first.
 */
export function usePlaceFilters(picked: { clientId: string; locationId: string }): ExtraFilter[] {
    const { t } = useLanguage()
    const { can } = useCan()
    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const waits = !session || (superAdmin && !selectedCompanyId)
    const company = superAdmin && selectedCompanyId ? `companyId=${encodeURIComponent(selectedCompanyId)}` : ''

    const seesClients = can('clients.view') && !waits
    const seesLocations = can('locations.view') && !waits
    const { data: clientsBody } = useSWR<{ data: { id: string; name: string }[] }>(seesClients ? `/api/clients${company ? `?${company}` : ''}` : null, fetcher)
    const { data: placesBody } = useSWR<{ data: { locations: BulkPlace[] } }>(seesLocations ? `/api/locations?pick=all${company ? `&${company}` : ''}` : null, fetcher)
    const clients = clientsBody?.data ?? []
    // A location with no pin has no task to find.
    const places = (placesBody?.data.locations ?? []).filter(p => !p.needsPin)
    const clientName = (id: string | null) => (id ? clients.find(c => c.id === id)?.name : undefined)

    const filters: ExtraFilter[] = []
    if (seesClients) {
        filters.push({
            key: 'clientId',
            label: t('location_client'),
            value: picked.clientId,
            options: [{ value: '', label: t('filter_all_clients') }, { value: NO_CLIENT, label: t('task_no_client') }, ...clients.map(c => ({ value: c.id, label: c.name }))],
        })
    }
    if (seesLocations) {
        filters.push({
            key: 'locationId',
            label: t('task_location'),
            value: picked.locationId,
            options: chosen => [
                { value: '', label: t('locations_filter_all') },
                ...places
                    // The picked client's and the shared ones; only the shared with "No client".
                    .filter(p => !chosen.clientId || !p.clientId || p.clientId === chosen.clientId)
                    .map(p => ({ value: p.id, label: locationLabel(p.name, clientName(p.clientId)) }))
                    .sort((a, b) => a.label.localeCompare(b.label)),
            ],
        })
    }
    return filters
}
