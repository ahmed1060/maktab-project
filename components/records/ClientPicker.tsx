'use client'

import { useEffect, useId, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { StorefrontIcon, WarningCircleIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import { Button, Dialog, EmptyState, Field, SearchInput, Select } from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'

type Client = { id: string; name: string; company?: string }

/**
 * Adding a record from the Records page (CLIENTS_PLAN.md §0.2): which client
 * it's for, and then that client's page, where the form opens with its
 * sections. Someone who may add records but not see the vendors list, as an
 * ordinary employee, reaches a client without records yet this way. The first
 * clients by name are listed; a search by name finds any of the others.
 */
export default function ClientPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
    if (!open) return null
    return <Picker onClose={onClose} />
}

function Picker({ onClose }: { onClose: () => void }) {
    const { t, locale } = useLanguage()
    const router = useRouter()
    const { selectedCompanyId } = useCompany()
    const formId = useId()
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
    // The clients already listed stay while a search loads, rather than flashing away.
    const { data, error, isLoading, mutate } = useSWR<{ data: { clients: Client[]; more: boolean } }>(url, fetcher, { keepPreviousData: true })
    const clients = data?.data.clients ?? []
    const more = data?.data.more ?? false
    const [chosen, setChosen] = useState('')
    // What was chosen, while a search still lists it; otherwise the first it lists.
    const clientId = clients.some(c => c.id === chosen) ? chosen : clients[0]?.id ?? ''
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')

    const go = (e: React.FormEvent) => {
        e.preventDefault()
        if (clientId) router.push(`/dashboard/vendors/${encodeURIComponent(clientId)}?add=1`)
    }

    return (
        <Dialog
            open
            onClose={onClose}
            title={t('records_add')}
            actions={<>
                <Button onClick={onClose}>{t('cancel')}</Button>
                <Button type="submit" form={formId} variant="primary" disabled={!clientId}>{t('records_continue')}</Button>
            </>}
        >
            <form id={formId} onSubmit={go} className="ui-dialog-body" noValidate>
                {error
                    ? <EmptyState icon={WarningCircleIcon} title={t('records_vendors_failed')} action={<Button onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    : isLoading && !data
                        ? <p className="ui-hint" role="status">{t('loading')}</p>
                        : clients.length === 0 && !search && !query
                            ? <EmptyState icon={StorefrontIcon} title={t('records_no_vendors')} />
                            : <>
                                <Field label={t('records_find_vendor')} hint={more ? t('records_more_vendors').replace('{n}', num(clients.length)) : undefined}>{p => (
                                    <SearchInput {...p} autoComplete="off" value={query} onChange={e => setQuery(e.target.value)} />
                                )}</Field>
                                {clients.length === 0
                                    ? <p className="ui-hint" role="status">{t('records_no_vendors_match')}</p>
                                    : (
                                        <Field label={t('records_col_vendor')} hint={t('records_pick_vendor_hint')}>{p => (
                                            <Select
                                                {...p}
                                                value={clientId}
                                                onChange={e => setChosen(e.target.value)}
                                                options={clients.map(c => ({ value: c.id, label: c.company ? `${c.name} · ${c.company}` : c.name }))}
                                            />
                                        )}</Field>
                                    )}
                            </>}
            </form>
        </Dialog>
    )
}
