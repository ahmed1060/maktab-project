'use client'

import { Fragment, useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
    ArrowCounterClockwiseIcon, CalendarBlankIcon, CalendarCheckIcon, CheckCircleIcon, CircleDashedIcon, ClipboardTextIcon, CoinsIcon,
    HourglassIcon, PencilSimpleIcon, ProhibitIcon, ReceiptIcon, StorefrontIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import ConfirmModal from '@/components/ConfirmModal'
import DateRangePicker from '@/components/DateRangePicker'
import SafeDate from '@/components/SafeDate'
import {
    Button, DataList, EmptyState, Field, FileChip, FilterBar, ItemTitle, ListCard, Pager, pageInRange, RowMenu, SearchInput, Section, Select,
    StatusBadge, TotalTiles, type Column, type MenuItem, type StatusTone,
} from '@/components/ui'
import { useClientOptions } from '@/components/locations/useClientOptions'
import { chargeState, collectWording, type ChargeStatus } from '@/lib/charges'
import { cents } from '@/lib/task-costs'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import type { TranslationKey } from '@/lib/translations'
import ChargeFeeDialog from './ChargeFeeDialog'
import type { ChargeRow } from './types'

const LIMIT = 20

const STATE_TONE: Record<ReturnType<typeof chargeState>, StatusTone> = { due: 'waiting', collected: 'good', not_charged: 'neutral' }
const STATE_LABEL: Record<ReturnType<typeof chargeState>, TranslationKey> = { due: 'charges_status_due', collected: 'charges_status_collected', not_charged: 'charges_status_not_charged' }

type Offer = { count: number; amount: number; digest: string }

/**
 * The Costs page's Charged to clients tab (CLIENTS_PLAN.md §6.4): each cost
 * on a task with a client, as what that client owes for it. Filtered by
 * client, the day it was added, status and search; Due ones as it opens. Its
 * totals are every page's: what was paid out, the service fees on top, and
 * what is still due. Whoever manages charges sets a charge's service fee,
 * and leaves a cost off its client's bill or charges it again.
 *
 * On a client's page, its charges only, with what is Due and Collected, and
 * Mark collected for the Due ones listed, for whoever may (§6.4). Whoever may
 * marks a collected one uncollected again, here and on the tab (§6.5).
 */
export default function ChargesList({ client: onPage }: { client?: { id: string; name: string } } = {}) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const { can } = useCan()
    const { selectedCompanyId } = useCompany()

    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [clientId, setClientId] = useState('')
    const [status, setStatus] = useState<ChargeStatus>('due')
    const [dateFrom, setDateFrom] = useState('')
    const [dateTo, setDateTo] = useState('')
    const [page, setPage] = useState(1)
    const [editing, setEditing] = useState<ChargeRow | null>(null)
    const [collecting, setCollecting] = useState(false)
    const [uncollecting, setUncollecting] = useState<ChargeRow | null>(null)

    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 400)
        return () => clearTimeout(timer)
    }, [query, search])

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), status })
    if (search) params.set('search', search)
    const forClient = onPage?.id || clientId
    if (forClient) params.set('clientId', forClient)
    if (dateFrom) params.set('dateFrom', dateFrom)
    if (dateTo) params.set('dateTo', dateTo)
    // A client's page lists its own company's, whichever a Super Admin picked.
    if (selectedCompanyId && !onPage) params.set('companyId', selectedCompanyId)
    const listUrl = `/api/charges?${params}`
    // Another company's rows mustn't linger once a Super Admin picks another.
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(scopedKey(listUrl, selectedCompanyId), scopedFetcher, { keepPreviousData: true })
    const result = forScope<{ data: {
        data: ChargeRow[]; total: number; totalPages: number; totals: { paidOut: number; serviceFees: number; totalDue: number }
        summary: { due: number; collected: number } | null; collect: Offer | null
    } }>(scoped, selectedCompanyId)
    const failed = loadFailed(scoped, error, listUrl)
    const charges = failed ? [] : result?.data?.data || []
    const totalPages = result?.data?.totalPages || 0
    const total = result?.data?.total || 0
    const totals = result?.data?.totals
    const summary = result?.data?.summary
    const offer = failed ? null : result?.data?.collect ?? null

    const clients = useClientOptions(can('clients.view') && !onPage, true)

    useAdjustOnChange([selectedCompanyId], () => { setPage(1); setClientId(''); setEditing(null); setCollecting(false); setUncollecting(null) })
    useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))

    const filtersOn = (clientId ? 1 : 0) + (status !== 'due' ? 1 : 0) + (dateFrom || dateTo ? 1 : 0)
    const resetFilters = () => { setQuery(''); setSearch(''); setClientId(''); setStatus('due'); setDateFrom(''); setDateTo(''); setPage(1) }

    const canManage = can('charges.manage')
    const canCollect = can('charges.collect')

    /** "Not charged to client", or charged again, from the row's menu (§6.2). */
    const setCharged = async (c: ChargeRow, notCharged: boolean) => {
        try {
            const res = await fetch(`/api/charges/${encodeURIComponent(c.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ notCharged }),
            })
            const answer = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(answer?.error || t('error_generic'), 'error')
                return
            }
            showToast(t(notCharged ? 'charges_left_off' : 'charges_charged_again'), 'success')
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    /**
     * Mark collected: exactly the Due ones listed, as the confirmation said,
     * or none, shown again, if they changed meanwhile (§6.4).
     */
    const collect = async () => {
        if (!onPage || !offer) return
        try {
            const res = await fetch('/api/charges/collect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filters: { clientId: onPage.id, dateFrom, dateTo, search }, digest: offer.digest }),
            })
            const answer = await res.json().catch(() => null)
            if (res.status === 409) showToast(t('charges_collect_changed'), 'warning')
            else if (!res.ok) showToast(answer?.error || t('error_generic'), 'error')
            else showToast(t('charges_collected_done'), 'success')
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setCollecting(false)
        }
    }

    /** Mark uncollected: due again, so it can be corrected (§6.5). */
    const uncollect = async () => {
        const c = uncollecting
        if (!c) return
        try {
            const res = await fetch(`/api/charges/${encodeURIComponent(c.id)}/uncollect`, { method: 'POST' })
            const answer = await res.json().catch(() => null)
            if (!res.ok) showToast(answer?.error || t('error_generic'), 'error')
            else showToast(t('charges_uncollected_done'), 'success')
            void mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setUncollecting(null)
        }
    }

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const name = (c: ChargeRow) => c.description || t('no_description')

    // A collected one is locked (§6.5) until whoever may collect marks it uncollected.
    const menu = (c: ChargeRow): MenuItem[] => c.collectedAt
        ? (canCollect ? [{ key: 'uncollect', label: t('charges_mark_uncollected'), icon: ArrowCounterClockwiseIcon, onSelect: () => setUncollecting(c) }] : [])
        : !canManage ? [] : c.notCharged
            ? [{ key: 'charge', label: t('charges_charge_again'), icon: ArrowCounterClockwiseIcon, onSelect: () => { void setCharged(c, false) } }]
            : [
                { key: 'fee', label: t('charges_set_fee'), icon: PencilSimpleIcon, onSelect: () => setEditing(c) },
                { key: 'leave', label: t('charges_leave_off'), icon: ProhibitIcon, onSelect: () => { void setCharged(c, true) } },
            ]
    const actions = (c: ChargeRow) => menu(c).length > 0 && (
        <span className="ui-row-actions">
            <RowMenu label={t('ui_more_actions_for').replace('{name}', name(c))} tooltip={t('ui_more_actions')} items={menu(c)} />
        </span>
    )

    const badge = (c: ChargeRow) => {
        const s = chargeState(c)
        return <StatusBadge tone={STATE_TONE[s]}>{t(STATE_LABEL[s])}</StatusBadge>
    }
    const collectedOn = (c: ChargeRow) => c.collectedAt && <span>{t('charges_collected_on').split('{date}').flatMap((part, i) => i === 0 ? [part] : [<SafeDate key={i} date={c.collectedAt} format="dateOnly" locale={locale} />, part])}</span>
    // When a collected one was, under its badge.
    const state = (c: ChargeRow) => c.collectedAt ? <><div>{badge(c)}</div><div className="ui-item-detail ui-nowrap">{collectedOn(c)}</div></> : badge(c)
    const task = (c: ChargeRow) => <Link href={`/dashboard/tasks/${c.task.id}`} prefetch={false} className="ui-item-link"><bdi>{c.task.title}</bdi></Link>
    const author = (c: ChargeRow) => c.authorName || t('unknown_user')
    const day = (c: ChargeRow) => <SafeDate date={c.createdAt} format="dateOnly" locale={locale} />
    // One line on a phone's card; a name and a day, each on one line, in the table.
    const added = (c: ChargeRow) => <span>{t('charges_added').replace('{name}', author(c)).split('{date}').flatMap((part, i) => i === 0 ? [part] : [<Fragment key={i}>{day(c)}</Fragment>, part])}</span>
    const addedCell = (c: ChargeRow) => <div className="ui-nowrap"><ItemTitle title={<bdi>{author(c)}</bdi>} detail={day(c)} /></div>
    const client = (c: ChargeRow) => c.task.client
        ? (can('clients.view') || can('records.view')
            ? <Link href={`/dashboard/clients/${c.task.client.id}`} prefetch={false} className="ui-item-link"><bdi>{c.task.client.name}</bdi></Link>
            : <bdi>{c.task.client.name}</bdi>)
        : null
    const receipt = (c: ChargeRow) => c.receiptUrl && <FileChip name={t('cost_receipt')} href={c.receiptUrl} />
    const totalOf = (c: ChargeRow) => cents(c.amount + c.serviceFee)

    const columns: Column<ChargeRow>[] = [
        {
            key: 'cost', header: t('charges_col_cost'),
            cell: c => <><ItemTitle title={<bdi>{name(c)}</bdi>} detail={task(c)} detailIcon={ClipboardTextIcon} />{receipt(c)}</>,
        },
        ...(onPage ? [] : [{ key: 'client', header: t('charges_col_client'), cell: client }]),
        { key: 'added', header: t('charges_col_added'), cell: addedCell },
        { key: 'paid', header: t('charges_col_paid'), align: 'end', cell: c => <span className="ui-nowrap">{money(c.amount)}</span> },
        { key: 'fee', header: t('charges_col_fee'), align: 'end', cell: c => <span className="ui-nowrap">{money(c.serviceFee)}</span> },
        { key: 'total', header: t('charges_col_total'), align: 'end', cell: c => <strong className="ui-nowrap">{money(totalOf(c))}</strong> },
        { key: 'status', header: t('charges_col_status'), cell: state },
        ...(canManage || canCollect ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: (c: ChargeRow) => actions(c) }] : []),
    ]

    const clientOptions = [
        { value: '', label: t('charges_filter_all_clients') },
        ...clients.clients.map(c => ({ value: c.id, label: [c.name, c.company, c.archived && t('clients_archived_mark')].filter(Boolean).join(' · ') })),
    ]
    const statusOptions = (['due', 'collected', 'not_charged', 'all'] as const).map(s => ({ value: s, label: t(`charges_status_${s}` as TranslationKey) }))

    const empty = failed
        ? <EmptyState icon={WarningCircleIcon} title={t('charges_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        : search || filtersOn > 0
            ? <EmptyState icon={CoinsIcon} title={t('charges_none_found')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
            // Due as it opens: none due isn't none at all.
            : <EmptyState icon={CoinsIcon} title={t(onPage ? 'charges_none_client' : 'charges_none')} action={<Button variant="quiet" onClick={() => { setStatus('all'); setPage(1) }}>{t('charges_show_all')}</Button>} />
    const wording = onPage && offer ? collectWording(t, locale, offer.count, offer.amount, onPage.name) : null

    const list = (
        <>
            <FilterBar
                search={<Field label={t('charges_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('charges_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                {can('clients.view') && !onPage && (
                    <Field label={t('charges_filter_client')} hideLabel>{p => (
                        <Select {...p} icon={StorefrontIcon} value={clientId} onChange={e => { setClientId(e.target.value); setPage(1) }} options={clientOptions} />
                    )}</Field>
                )}
                <Field label={t('charges_filter_status')} hideLabel>{p => (
                    <Select {...p} icon={CircleDashedIcon} value={status} onChange={e => { setStatus(e.target.value as ChargeStatus); setPage(1) }} options={statusOptions} />
                )}</Field>
                <DateRangePicker asField hideLabel dateFrom={dateFrom} dateTo={dateTo} onChange={(from, to) => { setDateFrom(from); setDateTo(to); setPage(1) }} />
            </FilterBar>

            {onPage
                ? summary && !failed && (
                    <TotalTiles items={[
                        { label: t('charges_status_due'), value: money(summary.due) },
                        { label: t('charges_status_collected'), value: money(summary.collected) },
                    ]} />
                )
                : totals && !failed && (
                    <TotalTiles items={[
                        { label: t('charges_total_paid_out'), value: money(totals.paidOut) },
                        { label: t('charges_total_fees'), value: money(totals.serviceFees) },
                        { label: t('charges_total_due'), value: money(totals.totalDue) },
                    ]} />
                )}

            {isLoading && !result && !failed
                ? <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('charges_loading')} /></div>
                : (
                    <DataList
                        caption={t('costs_tab_charges')}
                        columns={columns}
                        rows={charges}
                        rowKey={c => c.id}
                        card={c => (
                            <ListCard
                                title={<bdi>{name(c)}</bdi>}
                                status={badge(c)}
                                details={[
                                    { icon: ClipboardTextIcon, text: task(c) },
                                    ...(c.task.client && !onPage ? [{ icon: StorefrontIcon, text: client(c) }] : []),
                                    { icon: CalendarBlankIcon, text: added(c) },
                                    ...(c.collectedAt ? [{ icon: CalendarCheckIcon, text: collectedOn(c) }] : []),
                                    { icon: CoinsIcon, text: <span className="ui-num">{money(c.amount)} + {money(c.serviceFee)} = <strong>{money(totalOf(c))}</strong></span> },
                                    ...(c.receiptUrl ? [{ icon: ReceiptIcon, text: receipt(c) }] : []),
                                ]}
                                foot={menu(c).length > 0 ? <>{actions(c)}</> : undefined}
                            />
                        )}
                        footer={<Pager page={page} pageCount={totalPages} onPage={setPage} summary={countOf(t, locale, total, 'charges')} />}
                        empty={empty}
                    />
                )}

            <ChargeFeeDialog charge={editing} onClose={() => setEditing(null)} onSaved={() => { void mutate() }} />
            <ConfirmModal
                isOpen={!!uncollecting}
                title={t('charges_uncollect_title').replace('{name}', uncollecting ? name(uncollecting) : '')}
                message={t('charges_uncollect_question').replace('{client}', uncollecting?.task.client?.name ?? onPage?.name ?? '')}
                confirmText={t('charges_mark_uncollected')}
                cancelText={t('cancel')}
                onConfirm={uncollect}
                onCancel={() => setUncollecting(null)}
                variant="warning"
            />
            {onPage && (
                <ConfirmModal
                    isOpen={collecting && !!wording}
                    title={t('charges_mark_collected')}
                    message={wording?.question ?? ''}
                    confirmText={wording?.button ?? ''}
                    cancelText={t('cancel')}
                    onConfirm={collect}
                    onCancel={() => setCollecting(false)}
                    variant="warning"
                />
            )}
        </>
    )

    if (!onPage) return list
    return (
        <Section
            title={t('charges_section')}
            action={canCollect && offer && <Button size="sm" icon={CheckCircleIcon} onClick={() => setCollecting(true)}>{t('charges_mark_collected')}</Button>}
        >
            {list}
        </Section>
    )
}
