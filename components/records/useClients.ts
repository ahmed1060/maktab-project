'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { useCompany } from '@/context/CompanyContext'
import { scopedKey, scopedFetcher, forScope } from '@/lib/swr-scoped'

export type ClientOption = { id: string; name: string; company?: string }

/**
 * The clients a record can be added to from the Records page (CLIENTS_PLAN.md
 * §0.2): the first ones by name, and whether there are more, which a search
 * by name finds. Someone who may add records but not see the vendors list, as
 * an ordinary employee, reaches a client without records yet this way.
 */
export function useClients(on: boolean) {
    const { selectedCompanyId } = useCompany()
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
    const url = `/api/records/clients${params.toString() ? `?${params}` : ''}`
    // The clients already listed stay while a search loads, rather than
    // flashing away, but not another company's: a Super Admin who picks
    // another company meanwhile could add a record to the last one's client.
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(on ? scopedKey(url, selectedCompanyId) : null, scopedFetcher, { keepPreviousData: true })
    const data = forScope<{ data: { clients: ClientOption[]; more: boolean } }>(scoped, selectedCompanyId)
    return {
        query,
        setQuery,
        /** A search typed, or still being typed: no match then isn't "no clients". */
        searching: query.trim() !== '' || search !== '',
        clients: data?.data.clients ?? [],
        more: data?.data.more ?? false,
        loading: isLoading && !data,
        failed: !!error && !data,
        retrying: isValidating,
        retry: () => { void mutate() },
    }
}
