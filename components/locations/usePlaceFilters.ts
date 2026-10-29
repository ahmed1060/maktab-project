'use client'

import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { fetcher } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { locationLabel } from '@/lib/locations'
import { NO_CLIENT, locationFilterChoices, type FilterPlace } from '@/lib/place-filters'

type Option = { value: string; label: string }

/** A select in the filter bar's panel (components/EmployeeFilter.tsx). */
export type ExtraFilter = {
    key: string
    label: string
    value: string
    /** Its options, or, for one that follows another, its options for what's picked there. */
    options: Option[] | ((picked: Record<string, string>) => Option[])
    /**
     * One the address sets that its viewer can't pick, from a link someone
     * shared: it has no select, but it's counted and Reset clears it, as it
     * still narrows the list.
     */
    hidden?: boolean
}

/**
 * The client and location filters (CLIENTS_PLAN.md §3) for the Tasks and
 * Costs pages' filter bar, from the address's `clientId` and `locationId`:
 * the client filter for whoever may see clients, with "No client"; the
 * location filter for whoever may see locations, offering the picked
 * client's and the shared ones, the archived ones last. A Super Admin
 * picks a company first. Either, set in the address for someone who can't
 * pick it, is hidden, so it can be cleared.
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
    // Archived clients too: a filter keeps them (CLIENTS_PLAN.md §4.3).
    const { data: clientsBody } = useSWR<{ data: { id: string; name: string; archivedAt?: string | null }[] }>(seesClients ? `/api/clients?archived=all${company ? `&${company}` : ''}` : null, fetcher)
    const { data: placesBody } = useSWR<{ data: { locations: FilterPlace[] } }>(seesLocations ? `/api/locations?pick=filters${company ? `&${company}` : ''}` : null, fetcher)
    const clients = clientsBody?.data ?? []
    const places = placesBody?.data.locations ?? []
    const clientName = (id: string | null) => (id ? clients.find(c => c.id === id)?.name : undefined)

    const filters: ExtraFilter[] = []
    if (seesClients) {
        filters.push({
            key: 'clientId',
            label: t('location_client'),
            value: picked.clientId,
            options: [{ value: '', label: t('filter_all_clients') }, { value: NO_CLIENT, label: t('task_no_client') }, ...clients.map(c => ({ value: c.id, label: c.archivedAt ? `${c.name} · ${t('clients_archived_mark')}` : c.name }))],
        })
    }
    if (!seesClients && picked.clientId) filters.push({ key: 'clientId', label: t('location_client'), value: picked.clientId, options: [], hidden: true })
    if (seesLocations) {
        filters.push({
            key: 'locationId',
            label: t('task_location'),
            value: picked.locationId,
            options: chosen => [
                { value: '', label: t('locations_filter_all') },
                ...locationFilterChoices(places, chosen.clientId ?? '', p => locationLabel(p.name, clientName(p.clientId)), l => `${l} · ${t('locations_archived_mark')}`),
            ],
        })
    }
    if (!seesLocations && picked.locationId) filters.push({ key: 'locationId', label: t('task_location'), value: picked.locationId, options: [], hidden: true })
    return filters
}
