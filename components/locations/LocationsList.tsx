'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
    ArchiveIcon, ArrowCounterClockwiseIcon, BuildingsIcon, CircleDashedIcon, HourglassIcon, MapPinIcon, MapPinAreaIcon, PencilSimpleIcon,
    StarIcon, StorefrontIcon, TagIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import ConfirmModal from '@/components/ConfirmModal'
import {
    Button, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Pager, pageInRange, RowMenu, SearchInput, Select, StatusBadge,
    type Column, type MenuItem,
} from '@/components/ui'
import type { TranslationKey } from '@/lib/translations'
import { googleMapsLink } from '@/lib/attendance/geo'
import { LOCATION_RADIUS_DEFAULT, locationLabel } from '@/lib/locations'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import LocationForm from './LocationForm'
import { useClientOptions } from './useClientOptions'
import type { LocationItem } from './types'

const LIMIT = 20
const SHARED = 'shared'

/**
 * Locations in a list (CLIENTS_PLAN.md §2.4): on the Locations page, every
 * client's and the shared ones, with a filter by client; on a client's
 * page, that client's. Each client's HQ is marked and listed first. A
 * location whose pin isn't placed yet says so: no task can use it until it
 * is (§2.8). Search, the archived ones, and editing, archiving and making a
 * location the HQ work the same in both.
 */
export default function LocationsList({ clientId, adding = false, onAddingChange, onChanged }: {
    /** One client's locations; none for every client's and the shared ones. */
    clientId?: string
    /** Whether the add form is open, for a page whose header has the button. */
    adding?: boolean
    /** Opens or closes the add form. */
    onAddingChange?: (open: boolean) => void
    /** After a location is added or changed: the client's HQ may have moved. */
    onChanged?: () => void
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const onePage = !clientId
    // Every company's, each with its company named: a Super Admin who hasn't picked one.
    const everyCompany = onePage && superAdmin && !selectedCompanyId

    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [forClient, setForClient] = useState('')
    const [archived, setArchived] = useState(false)
    const [page, setPage] = useState(1)
    const [editing, setEditing] = useState<LocationItem | null>(null)
    const [toArchive, setToArchive] = useState<LocationItem | null>(null)

    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 400)
        return () => clearTimeout(timer)
    }, [query, search])

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (search) params.set('search', search)
    if (archived) params.set('archived', '1')
    if (clientId) params.set('clientId', clientId)
    else if (forClient) params.set('clientId', forClient)
    if (onePage && selectedCompanyId) params.set('companyId', selectedCompanyId)
    const listUrl = `/api/locations?${params}`
    // On a client's page the client decides the company; on the Locations
    // page, a Super Admin's chosen one does, and another's rows mustn't linger.
    const scope = clientId ?? selectedCompanyId
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(scopedKey(listUrl, scope), scopedFetcher, { keepPreviousData: true })
    const result = forScope(scoped, scope)
    const failed = loadFailed(scoped, error, listUrl)
    const locations: LocationItem[] = failed ? [] : result?.data?.data || []
    const totalPages: number = result?.data?.totalPages || 0
    const total: number = result?.data?.total || 0

    // The filter by client, for whoever may see the clients.
    const clients = useClientOptions(onePage && can('clients.view'), true)

    useAdjustOnChange([selectedCompanyId], () => { setPage(1); setForClient('') })
    // A location open in the form is the last company's once a Super Admin
    // picks another: closed, so it can't be changed unseen.
    useAdjustOnChange([scope], () => { setEditing(null); setToArchive(null); onAddingChange?.(false) })
    useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))

    const filtersOn = (forClient ? 1 : 0) + (archived ? 1 : 0)
    const resetFilters = () => { setQuery(''); setSearch(''); setForClient(''); setArchived(false); setPage(1) }
    const changed = () => { void mutate(); onChanged?.() }

    const canAdd = can('locations.add')
    const canManage = can('locations.manage')

    /** A change from the row's menu: making it the HQ, archiving it, or restoring it. */
    const change = async (l: LocationItem, body: { hq?: true; archived?: boolean }, done: TranslationKey) => {
        try {
            const res = await fetch('/api/locations', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: l.id, ...body }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(answer?.error || t('error_generic'), 'error')
                return
            }
            showToast(t(done), 'success')
            changed()
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    // Returned, so the dialog shows it working until it's done.
    const confirmArchive = async () => {
        if (!toArchive) return
        await change(toArchive, { archived: true }, 'locations_archived')
        setToArchive(null)
    }

    const menu = (l: LocationItem): MenuItem[] => l.archivedAt
        ? [{ key: 'restore', label: t('locations_restore'), icon: ArrowCounterClockwiseIcon, onSelect: () => { void change(l, { archived: false }, 'locations_restored') } }]
        : [
            { key: 'edit', label: t('locations_edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(l) },
            // A client's HQ is replaced, never archived: another is made its HQ first.
            ...(l.client && !l.isHq ? [{ key: 'hq', label: t('locations_set_hq'), icon: StarIcon, onSelect: () => { void change(l, { hq: true }, 'locations_hq_set') } }] : []),
            ...(!l.isHq ? [{ key: 'archive', label: t('locations_archive'), icon: ArchiveIcon, onSelect: () => setToArchive(l) }] : []),
        ]
    const actions = (l: LocationItem) => canManage && (
        <span className="ui-row-actions">
            <RowMenu label={t('ui_more_actions_for').replace('{name}', l.name)} tooltip={t('ui_more_actions')} items={menu(l)} />
        </span>
    )

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const hq = (l: LocationItem) => l.isHq && <StatusBadge tone="neutral">{t('locations_hq')}</StatusBadge>
    const title = (l: LocationItem) => <><bdi>{l.name}</bdi>{hq(l)}</>
    // Its client's page for whoever may open it (clients/[id]), or "Shared"
    // for a place no client owns.
    const opensClient = can('clients.view') || can('records.view')
    const owner = (l: LocationItem) => !l.client
        ? t('locations_shared')
        : opensClient
            ? <Link href={`/dashboard/clients/${l.client.id}`} prefetch={false} className="ui-item-link"><bdi>{l.client.name}</bdi></Link>
            : <bdi>{l.client.name}</bdi>
    const pin = (l: LocationItem) => l.latitude === null || l.longitude === null
        ? <StatusBadge tone="problem">{t('locations_needs_pin')}</StatusBadge>
        : <a href={googleMapsLink(l.latitude, l.longitude)} target="_blank" rel="noopener noreferrer" className="ui-item-link">{t('locations_view_map')}<span className="ui-visually-hidden"> {t('ui_opens_new_tab')}</span></a>
    const radius = (l: LocationItem) => l.radiusMeters === null
        ? <span className="ui-item-detail">{t('locations_radius_default').replace('{n}', num(LOCATION_RADIUS_DEFAULT))}</span>
        : t('locations_radius_value').replace('{n}', num(l.radiusMeters))

    const columns: Column<LocationItem>[] = [
        {
            key: 'location', header: t('locations_col_location'),
            cell: l => onePage ? <ItemTitle title={title(l)} detail={owner(l)} detailIcon={l.client ? StorefrontIcon : TagIcon} /> : <ItemTitle title={title(l)} />,
        },
        ...(everyCompany ? [{ key: 'company', header: t('clients_col_company'), cell: (l: LocationItem) => <bdi>{l.company.name}</bdi> }] : []),
        { key: 'pin', header: t('locations_col_pin'), cell: pin },
        { key: 'radius', header: t('locations_col_radius'), cell: radius },
        ...(canManage ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: actions }] : []),
    ]

    const clientOptions = [
        { value: '', label: t('locations_filter_all') },
        { value: SHARED, label: t('locations_filter_shared') },
        ...clients.clients.map(c => ({ value: c.id, label: [c.name, c.company, c.archived && t('clients_archived_mark')].filter(Boolean).join(' · ') })),
    ]
    const statusOptions = [
        { value: '', label: t('locations_in_use') },
        { value: 'archived', label: t('locations_archived_status') },
    ]

    const empty = failed
        ? <EmptyState icon={WarningCircleIcon} title={t('locations_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        : search || forClient
            ? <EmptyState icon={MapPinIcon} title={t('locations_none_found')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
            : archived
                ? <EmptyState icon={ArchiveIcon} title={t('locations_none_archived')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
                : <EmptyState
                    icon={MapPinIcon}
                    title={t('locations_none')}
                    action={canAdd && onAddingChange ? <Button variant="primary" onClick={() => onAddingChange(true)}>{t('locations_add')}</Button> : undefined}
                />

    return (
        <>
            <FilterBar
                search={<Field label={t('locations_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('locations_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                {onePage && (
                    <Field label={t('locations_filter_client')} hideLabel>{p => (
                        <Select {...p} icon={StorefrontIcon} value={forClient} onChange={e => { setForClient(e.target.value); setPage(1) }} options={clientOptions} />
                    )}</Field>
                )}
                <Field label={t('locations_filter_status')} hideLabel>{p => (
                    <Select {...p} icon={CircleDashedIcon} value={archived ? 'archived' : ''} onChange={e => { setArchived(e.target.value === 'archived'); setPage(1) }} options={statusOptions} />
                )}</Field>
            </FilterBar>

            {isLoading && !result && !failed
                ? <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('locations_loading')} /></div>
                : (
                    <DataList
                        caption={t('locations')}
                        columns={columns}
                        rows={locations}
                        rowKey={l => l.id}
                        card={l => (
                            <ListCard
                                title={<bdi>{l.name}</bdi>}
                                status={hq(l) || undefined}
                                details={[
                                    ...(onePage ? [{ icon: l.client ? StorefrontIcon : TagIcon, text: owner(l) }] : []),
                                    ...(everyCompany ? [{ icon: BuildingsIcon, text: <bdi>{l.company.name}</bdi> }] : []),
                                    { icon: MapPinIcon, text: pin(l) },
                                    { icon: MapPinAreaIcon, text: radius(l) },
                                ]}
                                foot={canManage ? <>{actions(l)}</> : undefined}
                            />
                        )}
                        footer={<Pager page={page} pageCount={totalPages} onPage={setPage} summary={countOf(t, locale, total, 'locations')} />}
                        empty={empty}
                    />
                )}

            {/* To this client, or on the Locations page to the one chosen in the form. */}
            <LocationForm open={adding} onClose={() => onAddingChange?.(false)} clientId={clientId} onSaved={changed} />
            <LocationForm open={!!editing} onClose={() => setEditing(null)} location={editing} onSaved={changed} />
            <ConfirmModal
                isOpen={!!toArchive}
                title={t('locations_archive')}
                message={t('locations_archive_question').replace('{name}', toArchive ? locationLabel(toArchive.name, toArchive.client?.name) : '')}
                confirmText={t('locations_archive')}
                cancelText={t('cancel')}
                onConfirm={confirmArchive}
                onCancel={() => setToArchive(null)}
                variant="warning"
            />
        </>
    )
}
