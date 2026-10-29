'use client'

import useSWR from 'swr'
import { useCompany } from '@/context/CompanyContext'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import type { ClientOption } from './types'

/**
 * The company's clients by name, for the Locations page's filter and its Add
 * location (CLIENTS_PLAN.md §2.4): a Super Admin's chosen company's, or every
 * company's, each with its company named. Not another company's once a
 * Super Admin picks another: a location could be added to the last one's
 * client.
 */
export function useClientOptions(on: boolean) {
    const { selectedCompanyId } = useCompany()
    const url = selectedCompanyId ? `/api/clients?companyId=${encodeURIComponent(selectedCompanyId)}` : '/api/clients'
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(on ? scopedKey(url, selectedCompanyId) : null, scopedFetcher)
    const failed = loadFailed(scoped, error, on ? url : null)
    const rows = failed ? undefined : forScope<{ data: { id: string; name: string; company?: { name: string } }[] }>(scoped, selectedCompanyId)
    const clients: ClientOption[] = (rows?.data ?? []).map(c => ({ id: c.id, name: c.name, company: c.company?.name }))
    return {
        clients,
        loading: on && isLoading && !rows,
        failed,
        retrying: isValidating,
        retry: () => { void mutate() },
    }
}
