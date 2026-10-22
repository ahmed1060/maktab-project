'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { MapPinIcon, PlusIcon, StorefrontIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { Button, Field, Select, type SelectOption } from '@/components/ui'
import { fetcher } from '@/lib/swr-fetcher'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useCan } from '@/lib/useCan'
import LocationForm from './LocationForm'

/** A task's client, none for "No client", and its location. */
export type TaskPlace = { clientId: string; locationId: string }

type PickRow = { id: string; name: string; isHq: boolean; needsPin: boolean }

/**
 * Where a task is done (CLIENTS_PLAN.md §2.3, §2.4; DESIGN.md §5.3): its
 * client, optional, and its location, which it must have. Picking a client
 * picks its HQ. The locations offered are that client's, its HQ first, then
 * the shared ones; only the shared ones with no client. One with no pin yet
 * is listed greyed: no task can use it until it has one (§2.8). "+ New
 * location" adds one there and then, and picks it.
 */
export default function TaskPlacePicker({ value, onChange, companyId, current, currentClient, error, disabled = false }: {
    value: TaskPlace
    onChange: (value: TaskPlace) => void
    /** The task's company: a Super Admin's chosen one, or the edited task's. */
    companyId?: string | null
    /**
     * The edited task's location as it is, offered though it may not be any
     * more (archived since), so an edit that leaves it alone can keep it.
     */
    current?: { id: string; label: string } | null
    /** The edited task's client, offered though it may be archived since (CLIENTS_PLAN.md §4.3). */
    currentClient?: { id: string; name: string } | null
    /** Shown once a save has been tried. */
    error?: string
    disabled?: boolean
}) {
    const { t } = useLanguage()
    const { can } = useCan()
    const { data: session } = useSession()
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    // A Super Admin's task is in the company they've picked.
    const waitsForCompany = superAdmin && !companyId
    const company = superAdmin && companyId ? `companyId=${encodeURIComponent(companyId)}` : ''
    const [adding, setAdding] = useState(false)

    const seesClients = can('clients.view')
    // Each with its HQ, to pick when the client is.
    const { data: clientsBody } = useSWR<{ data: { id: string; name: string; locations?: { id: string; latitude: number | null }[] }[] }>(seesClients && !waitsForCompany ? `/api/clients${company ? `?${company}` : ''}` : null, fetcher)
    const clients = clientsBody?.data ?? []
    const clientName = clients.find(c => c.id === value.clientId)?.name

    const seesLocations = can('locations.view')
    const params = new URLSearchParams({ pick: '1' })
    if (value.clientId) params.set('clientId', value.clientId)
    if (superAdmin && companyId) params.set('companyId', companyId)
    const url = seesLocations && !waitsForCompany ? `/api/locations?${params}` : null
    // Another client's locations never linger under this one's name.
    const { data: scoped, error: listError, isValidating, mutate } = useSWR(scopedKey(url, value.clientId), scopedFetcher, { keepPreviousData: true })
    const list = forScope<{ data: { client: PickRow[]; shared: PickRow[] } }>(scoped, value.clientId)?.data
    const failed = loadFailed(scoped, listError, url)

    // Picking a client picks its HQ, if it has its pin. A shared location
    // picked already stays; another client's goes.
    const pickClient = (clientId: string) => {
        const hq = clients.find(c => c.id === clientId)?.locations?.[0]
        const keeps = list?.shared.some(l => l.id === value.locationId)
        onChange({ clientId, locationId: hq && hq.latitude !== null ? hq.id : keeps ? value.locationId : '' })
    }

    const optionOf = (l: PickRow): SelectOption => ({
        value: l.id,
        label: [l.name, l.isHq && t('locations_hq'), l.needsPin && t('task_location_needs_pin')].filter(Boolean).join(' · '),
        disabled: l.needsPin,
    })
    const listed = [...(list?.client ?? []), ...(list?.shared ?? [])].some(l => l.id === value.locationId)
    const options: SelectOption[] = [
        { value: '', label: t('task_location_choose') },
        ...(current && current.id === value.locationId && !listed ? [{ value: current.id, label: current.label }] : []),
    ]
    const groups = [
        { label: t('task_location_client_group').replace('{name}', clientName ?? ''), options: (list?.client ?? []).map(optionOf) },
        { label: t('task_location_shared_group'), options: (list?.shared ?? []).map(optionOf) },
    ]

    const locationField = !seesLocations
        ? <p className="ui-error" role="alert">{t('task_location_no_permission')}</p>
        : waitsForCompany
            ? <p className="ui-hint">{t('task_location_pick_company')}</p>
            : failed
                ? (
                    <>
                        <span className="ui-error" role="alert">{t('task_location_load_failed')}</span>
                        <div><Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button></div>
                    </>
                )
                : null

    return (
        <div className="ui-field-group">
            {seesClients && !waitsForCompany && (
                <Field label={t('location_client')} hint={t('task_client_hint')}>{p => (
                    <Select {...p} icon={StorefrontIcon} value={value.clientId} onChange={e => pickClient(e.target.value)} disabled={disabled}
                        options={[
                            { value: '', label: t('task_no_client') },
                            ...clients.map(c => ({ value: c.id, label: c.name })),
                            ...(currentClient && !clients.some(c => c.id === currentClient.id) ? [{ value: currentClient.id, label: `${currentClient.name} · ${t('clients_archived_mark')}` }] : []),
                        ]} />
                )}</Field>
            )}
            {locationField
                ? <div className="ui-field"><span className="ui-label">{t('task_location')}</span>{locationField}</div>
                : (
                    <div className="ui-field">
                        <Field label={t('task_location')} hint={!list ? t('loading') : undefined} error={error}>{p => (
                            <Select {...p} icon={MapPinIcon} value={value.locationId} onChange={e => onChange({ ...value, locationId: e.target.value })} disabled={disabled || !list}
                                options={options} groups={groups} />
                        )}</Field>
                        {can('locations.add') && (
                            <div><Button variant="quiet" size="sm" icon={PlusIcon} onClick={() => setAdding(true)} disabled={disabled}>{t('task_location_new')}</Button></div>
                        )}
                    </div>
                )}
            <LocationForm
                open={adding}
                onClose={() => setAdding(false)}
                forTask={{ clientId: value.clientId || null, clientName, companyId }}
                onSaved={saved => {
                    void mutate()
                    if (saved) onChange({ ...value, locationId: saved.id })
                }}
            />
        </div>
    )
}
