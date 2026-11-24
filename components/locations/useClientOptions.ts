'use client'

import useSWR from 'swr'
import { useCompany } from '@/context/CompanyContext'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useLanguage } from '@/context/LanguageContext'
import { companyNameIn } from '@/lib/company-name'
import { clientName, clientsInOrder, type ClientName } from '@/lib/client-list'
import type { ClientOption } from './types'

/**
 * The company's clients by name, for the Locations page's filter and its Add
 * location (CLIENTS_PLAN.md §2.4): a Super Admin's chosen company's, or every
 * company's, each with its company named. Not another company's once a
 * Super Admin picks another: a location could be added to the last one's
 * client. Each in the page's language, in the page's order (PR 412).
 */
export function useClientOptions(on: boolean, withArchived = false) {
    const { selectedCompanyId } = useCompany()
    const { locale } = useLanguage()
    // A filter keeps archived clients; a form adds only to those in use (CLIENTS_PLAN.md §4.3).
    const params = new URLSearchParams()
    if (selectedCompanyId) params.set('companyId', selectedCompanyId)
    if (withArchived) params.set('archived', 'all')
    const url = `/api/clients${params.size ? `?${params}` : ''}`
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(on ? scopedKey(url, selectedCompanyId) : null, scopedFetcher)
    const failed = loadFailed(scoped, error, on ? url : null)
    const rows = failed ? undefined : forScope<{ data: (ClientName & { id: string; company?: { name: string; nameAr?: string | null }; archivedAt?: string | null })[] }>(scoped, selectedCompanyId)
    // Each client's company in the page's language (PR 411), and the client too (PR 412).
    const clients: ClientOption[] = clientsInOrder(rows?.data ?? [], locale).map(c => ({ id: c.id, name: clientName(c, locale), company: c.company ? companyNameIn(locale, c.company) : undefined, archived: !!c.archivedAt }))
    return {
        clients,
        loading: on && isLoading && !rows,
        failed,
        retrying: isValidating,
        retry: () => { void mutate() },
    }
}
