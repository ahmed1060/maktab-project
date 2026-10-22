'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
    ArticleIcon, BuildingOfficeIcon, BuildingsIcon, CalendarXIcon, EyeIcon, FileIcon, FolderIcon, HourglassIcon, PencilSimpleIcon, TrashIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import ConfirmModal from '@/components/ConfirmModal'
import {
    Button, DataList, EmptyState, ExpiryBadge, ExpiryDate, Field, FilterBar, ItemTitle, ListCard, Pager, pageInRange, RowMenu, SearchInput, Select,
    type Column, type MenuItem,
} from '@/components/ui'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { fetchRetrying } from '@/lib/swr-fetcher'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import type { ExpiryState } from '@/lib/record-expiry'
import RecordDialog from './RecordDialog'
import RecordForm from './RecordForm'
import { formatDay, formatMoment, personName, type RecordItem, type SectionItem } from './types'

const LIMIT = 20

/**
 * Records in a list (CLIENTS_PLAN.md §0.2): on the Records page, every
 * client's, with the client named on each; on a client's page, that
 * client's, with a filter by section. Search, the "Expiring soon" filter,
 * and opening, editing and deleting a record work the same in both.
 */
/** How long until an instant, from now; none once it's passed. */
const msUntil = (iso: string) => Math.max(0, Date.parse(iso) - Date.now())

export default function RecordsList({ clientId, sections = [], adding = false, onAddingChange, onChanged, openRecordId }: {
    /** One client's records; none for every client's. */
    clientId?: string
    /** That client's sections, for the filter and the form. */
    sections?: SectionItem[]
    /** Whether the add form is open, for a page whose header has the button. */
    adding?: boolean
    /** Opens or closes the add form. */
    onAddingChange?: (open: boolean) => void
    /** After a record is added, changed or deleted: a section's count may have moved. */
    onChanged?: () => void
    /** A record to open on arrival, from the link in its reminder. */
    openRecordId?: string | null
}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    const { selectedCompanyId } = useCompany()
    const showClient = !clientId

    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [expiry, setExpiry] = useState<ExpiryState | ''>('')
    const [sectionId, setSectionId] = useState('')
    const [page, setPage] = useState(1)
    const [viewing, setViewing] = useState<RecordItem | null>(null)
    const [editing, setEditing] = useState<RecordItem | null>(null)
    const [deleting, setDeleting] = useState<RecordItem | null>(null)

    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 400)
        return () => clearTimeout(timer)
    }, [query, search])

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (search) params.set('search', search)
    if (expiry) params.set('expiry', expiry)
    if (clientId) params.set('clientId', clientId)
    if (clientId && sectionId) params.set('sectionId', sectionId)
    if (!clientId && selectedCompanyId) params.set('companyId', selectedCompanyId)
    const listUrl = `/api/records?${params}`
    // On a client's page the client decides the company; on the Records page,
    // a Super Admin's chosen one does, and another's rows mustn't linger.
    const scope = clientId ?? selectedCompanyId
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(scopedKey(listUrl, scope), scopedFetcher, { keepPreviousData: true })
    const result = forScope(scoped, scope)
    const failed = loadFailed(scoped, error, listUrl)
    const records: RecordItem[] = failed ? [] : result?.data?.data || []
    const totalPages: number = result?.data?.totalPages || 0
    const total: number = result?.data?.total || 0

    // Its expiry badges and filter are of the company's day (or the soonest
    // to end, across companies): reloaded once the next day starts.
    const dayEndsAt: string | undefined = result?.data?.dayEndsAt
    useEffect(() => {
        if (!dayEndsAt) return
        const timer = setTimeout(() => { void mutate() }, msUntil(dayEndsAt) + 1000)
        return () => clearTimeout(timer)
    }, [dayEndsAt, mutate])

    useAdjustOnChange([selectedCompanyId], () => setPage(1))
    // A record open in a dialog is the last company's once a Super Admin
    // picks another: closed, so it can't be edited or deleted unseen.
    useAdjustOnChange([scope], () => { setViewing(null); setEditing(null); setDeleting(null) })
    useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))
    // A section that's gone from the client's list can't stay picked.
    useAdjustOnChange([sections.map(s => s.id).join(',')], () => setSectionId(id => (id && !sections.some(s => s.id === id) ? '' : id)))

    // The record a reminder links to, opened once it's fetched: on its own
    // client's page only, never over another client's records.
    const opened = useRef<string | null>(null)
    useEffect(() => {
        if (!openRecordId || opened.current === openRecordId) return
        opened.current = openRecordId
        fetchRetrying(`/api/records?id=${encodeURIComponent(openRecordId)}`)
            .then(r => (r.ok ? r.json() : null))
            .then((body: { data?: RecordItem } | null) => { if (body?.data && (!clientId || body.data.client.id === clientId)) setViewing(body.data) })
            .catch(() => { /* the list is still there to find it in */ })
    }, [openRecordId, clientId])

    const filtersOn = (expiry ? 1 : 0) + (sectionId ? 1 : 0)
    const resetFilters = () => { setQuery(''); setSearch(''); setExpiry(''); setSectionId(''); setPage(1) }
    const changed = () => { void mutate(); onChanged?.() }

    const canEdit = can('records.contribute')
    const canDelete = can('records.delete')

    const confirmDelete = async () => {
        if (!deleting) return
        try {
            const res = await fetch(`/api/records?id=${encodeURIComponent(deleting.id)}`, { method: 'DELETE' })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(body?.error || t('error_generic'), 'error')
                return
            }
            showToast(t('records_deleted'), 'success')
            if (viewing?.id === deleting.id) setViewing(null)
            changed()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setDeleting(null)
        }
    }

    const menu = (r: RecordItem): MenuItem[] => [
        { key: 'view', label: t('records_view'), icon: EyeIcon, onSelect: () => setViewing(r) },
        ...(canEdit ? [{ key: 'edit', label: t('records_edit'), icon: PencilSimpleIcon, onSelect: () => setEditing(r) }] : []),
        ...(canDelete ? [{ key: 'delete', label: t('records_delete'), icon: TrashIcon, danger: true, onSelect: () => setDeleting(r) }] : []),
    ]
    const actions = (r: RecordItem) => (
        <span className="ui-row-actions">
            <RowMenu label={t('ui_more_actions_for').replace('{name}', r.content.slice(0, 40))} tooltip={t('ui_more_actions')} items={menu(r)} />
        </span>
    )
    const title = (r: RecordItem) => (
        <button type="button" className="ui-item-button ui-clamp" dir="auto" onClick={() => setViewing(r)}>{r.content}</button>
    )
    const expires = (r: RecordItem) => r.expiryDate
        ? <ExpiryDate state={r.expiry}>{formatDay(r.expiryDate, locale)}</ExpiryDate>
        : <span className="ui-item-detail">{t('records_no_expiry')}</span>
    const client = (r: RecordItem) => (
        <ItemTitle
            title={<Link href={`/dashboard/clients/${r.client.id}`} prefetch={false} className="ui-item-link"><bdi>{r.client.name}</bdi></Link>}
            detail={r.client.company}
            detailIcon={r.client.company ? BuildingsIcon : undefined}
        />
    )
    const files = (r: RecordItem) => r.files.length ? <span className="ui-chip">{countOf(t, locale, r.files.length, 'files')}</span> : null
    // A name and a date, each on one line, beside a record's longer text.
    const added = (r: RecordItem) => <div className="ui-nowrap"><ItemTitle title={personName(r.createdBy, r.createdBySuperAdmin, t)} detail={formatMoment(r.createdAt, locale)} /></div>

    const columns: Column<RecordItem>[] = [
        { key: 'record', header: t('records_col_record'), cell: r => <ItemTitle title={title(r)} detail={<bdi>{r.section.title}</bdi>} detailIcon={FolderIcon} /> },
        ...(showClient ? [{ key: 'client', header: t('records_col_client'), cell: client }] : []),
        { key: 'expires', header: t('records_col_expires'), cell: expires },
        { key: 'files', header: t('records_col_files'), cell: files },
        { key: 'added', header: t('records_col_added'), cell: added },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: actions },
    ]

    const expiryOptions = [
        { value: '', label: t('records_expiry_any') },
        { value: 'soon', label: t('records_expiry_soon') },
        { value: 'expired', label: t('records_expiry_expired') },
    ]

    const empty = failed
        ? <EmptyState icon={WarningCircleIcon} title={t('records_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        : filtersOn > 0 || search
            ? <EmptyState icon={ArticleIcon} title={t('records_none_found')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
            : <EmptyState
                icon={ArticleIcon}
                title={t('records_none')}
                action={canEdit && onAddingChange ? <Button variant="primary" onClick={() => onAddingChange(true)}>{t('records_add')}</Button> : undefined}
            />

    return (
        <>
            <FilterBar
                search={<Field label={t('records_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('records_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                {clientId && sections.length > 0 && (
                    <Field label={t('records_section')} hideLabel>{p => (
                        <Select {...p} icon={FolderIcon} value={sectionId} onChange={e => { setSectionId(e.target.value); setPage(1) }}
                            options={[{ value: '', label: t('records_all_sections') }, ...sections.map(s => ({ value: s.id, label: s.title }))]} />
                    )}</Field>
                )}
                <Field label={t('records_col_expires')} hideLabel>{p => (
                    <Select {...p} icon={HourglassIcon} value={expiry} onChange={e => { setExpiry(e.target.value as ExpiryState | ''); setPage(1) }} options={expiryOptions} />
                )}</Field>
            </FilterBar>

            {isLoading && !result && !failed
                ? <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('records_loading')} /></div>
                : (
                    <DataList
                        caption={t('records')}
                        columns={columns}
                        rows={records}
                        rowKey={r => r.id}
                        card={r => (
                            <ListCard
                                title={title(r)}
                                status={<ExpiryBadge state={r.expiry} />}
                                details={[
                                    { icon: FolderIcon, text: <bdi>{r.section.title}</bdi> },
                                    ...(showClient ? [{ icon: BuildingsIcon, text: <Link href={`/dashboard/clients/${r.client.id}`} prefetch={false} className="ui-item-link"><bdi>{r.client.name}</bdi></Link> }] : []),
                                    // Its company, in a Super Admin's view of every company's, as in the table:
                                    // two may have clients of the same name (Codex on #82).
                                    ...(showClient && r.client.company ? [{ icon: BuildingOfficeIcon, text: <bdi>{r.client.company}</bdi> }] : []),
                                    { icon: r.expiryDate ? CalendarXIcon : HourglassIcon, text: r.expiryDate ? formatDay(r.expiryDate, locale) : t('records_no_expiry') },
                                    ...(r.files.length ? [{ icon: FileIcon, text: countOf(t, locale, r.files.length, 'files') }] : []),
                                ]}
                                foot={<><span className="ui-item-detail">{personName(r.createdBy, r.createdBySuperAdmin, t)}</span>{actions(r)}</>}
                            />
                        )}
                        footer={<Pager page={page} pageCount={totalPages} onPage={setPage} summary={countOf(t, locale, total, 'records')} />}
                        empty={empty}
                    />
                )}

            <RecordDialog
                record={viewing}
                onClose={() => setViewing(null)}
                showClient={showClient}
                onEdit={canEdit && viewing ? () => { setEditing(viewing); setViewing(null) } : undefined}
                onDelete={canDelete && viewing ? () => setDeleting(viewing) : undefined}
            />
            {/* To this client, or on the Records page to the one chosen in the form. */}
            <RecordForm open={adding} onClose={() => onAddingChange?.(false)} clientId={clientId} sections={clientId ? sections : undefined} onSaved={changed} />
            <RecordForm
                open={!!editing}
                onClose={() => setEditing(null)}
                clientId={editing?.client.id ?? clientId}
                // On the Records page the form loads the record's client's
                // sections, to move it to another, and says if they don't load.
                sections={clientId ? sections : undefined}
                record={editing}
                onSaved={changed}
            />
            <ConfirmModal
                isOpen={!!deleting}
                title={t('records_delete')}
                message={`${t('records_delete_question')} ${t('undone_warning_plain')}`}
                confirmText={t('records_delete')}
                cancelText={t('cancel')}
                onConfirm={confirmDelete}
                onCancel={() => setDeleting(null)}
                variant="danger"
            />
        </>
    )
}
