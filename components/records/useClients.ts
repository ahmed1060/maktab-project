'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { scopedKey, scopedFetcher, forScope, loadFailed } from '@/lib/swr-scoped'
import { clientName, clientsInOrder, type ClientName } from '@/lib/client-list'

/** A client to pick, its name in the page's language. */
export type ClientOption = { id: string; name: string; company?: string; companyAr?: string | null }

/**
 * The clients a record can be added to from the Records page (CLIENTS_PLAN.md
 * §0.2): the first ones by name, and whether there are more, which a search
 * by name finds. Someone who may add records but not see the clients list, as
 * an ordinary employee, reaches a client without records yet this way. Each
 * in the page's language, in the page's order, found by either language; an
 * Arabic page's first ones are the first by their Arabic (PR 416).
 */
export function useClients(on: boolean) {
    const { selectedCompanyId } = useCompany()
    const { locale } = useLanguage()
    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => setSearch(query.trim()), 400)
        return () => clearTimeout(timer)
    }, [query, search])
    const params = new URLSearchParams()
    if (selectedCompanyId) params.set('companyId', selectedCompanyId)
    if (search) params.set('search', search)
    params.set('locale', locale)
    const url = `/api/records/clients?${params}`
    // The clients already listed stay while a search loads, rather than
    // flashing away, but not another company's: a Super Admin who picks
    // another company meanwhile could add a record to the last one's client.
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(on ? scopedKey(url, selectedCompanyId) : null, scopedFetcher, { keepPreviousData: true })
    // A search that failed says so, rather than leaving the last list's
    // clients up as if they matched it.
    const failed = loadFailed(scoped, error, on ? url : null)
    const data = failed ? undefined : forScope<{ data: { clients: (ClientName & Omit<ClientOption, 'name'>)[]; more: boolean } }>(scoped, selectedCompanyId)
    const clients: ClientOption[] = clientsInOrder(data?.data.clients ?? [], locale).map(({ nameAr, ...c }) => ({ ...c, name: clientName({ name: c.name, nameAr }, locale) }))
    return {
        query,
        setQuery,
        /** A search typed, or still being typed: no match then isn't "no clients". */
        searching: query.trim() !== '' || search !== '',
        clients,
        more: data?.data.more ?? false,
        loading: isLoading && !data,
        failed,
        retrying: isValidating,
        retry: () => { void mutate() },
    }
}
