'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
    ArrowUDownLeftIcon, BuildingsIcon, CalendarBlankIcon, ClockCounterClockwiseIcon, HandCoinsIcon, HourglassIcon, SlidersHorizontalIcon,
    UsersIcon, WalletIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useCompany } from '@/context/CompanyContext'
import {
    Button, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Pager, pageInRange, RowMenu, SearchInput, Select, StatusBadge,
    TotalTiles, type Column, type MenuItem,
} from '@/components/ui'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useCan, useViewer } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { dayLabel, type RecordedKind } from '@/lib/cash-advances'
import CashAdvanceDialog from './CashAdvanceDialog'
import type { AdvanceHolder } from './types'

const LIMIT = 20

/**
 * The Costs page's Cash advances tab (CLIENTS_PLAN.md §7.5): everyone at
 * work in the company, and anyone else still holding money, each with their
 * balance, what's awaiting their confirmation and their last movement, and
 * what they all hold. Whoever gives and settles advances gives one, records
 * a return or corrects a balance from each person's menu; their history is
 * on their own page.
 */
export default function CashAdvancesList() {
    const { t, locale } = useLanguage()
    const { can } = useCan()
    const viewer = useViewer()
    const { selectedCompanyId } = useCompany()
    const superAdmin = viewer?.role === 'SUPER_ADMIN'

    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [holding, setHolding] = useState(false)
    const [page, setPage] = useState(1)
    const [recording, setRecording] = useState<{ holder: AdvanceHolder; kind: RecordedKind } | null>(null)

    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 400)
        return () => clearTimeout(timer)
    }, [query, search])

    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
    if (search) params.set('search', search)
    if (holding) params.set('holding', '1')
    if (selectedCompanyId) params.set('companyId', selectedCompanyId)
    // A Super Admin picks a company first (§7.8).
    const listUrl = superAdmin && !selectedCompanyId ? null : `/api/cash-advances?${params}`
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(scopedKey(listUrl, selectedCompanyId), scopedFetcher, { keepPreviousData: true })
    const result = forScope<{ data: {
        data: AdvanceHolder[]; total: number; totalPages: number; totals: { held: number; awaiting: number; holders: number }; today: string
    } }>(scoped, selectedCompanyId)
    const failed = loadFailed(scoped, error, listUrl)
    const off = failed && (error as { info?: { code?: string } } | undefined)?.info?.code === 'CASH_ADVANCES_OFF'
    const holders = failed ? [] : result?.data?.data || []
    const totalPages = result?.data?.totalPages || 0
    const total = result?.data?.total || 0
    const totals = result?.data?.totals

    useAdjustOnChange([selectedCompanyId], () => { setPage(1); setRecording(null) })
    useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))

    const filtersOn = holding ? 1 : 0
    const resetFilters = () => { setQuery(''); setSearch(''); setHolding(false); setPage(1) }

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const href = (h: AdvanceHolder) => `/dashboard/cash-advances/${encodeURIComponent(h.id)}`
    // Nobody gives or settles their own (§7.8); an advance goes only to someone at work.
    const mayGive = (h: AdvanceHolder) => can('cash_advances.give') && h.id !== viewer?.id
    const menu = (h: AdvanceHolder): MenuItem[] => [
        ...(mayGive(h) && h.atWork ? [{ key: 'give', label: t('advances_give'), icon: HandCoinsIcon, onSelect: () => setRecording({ holder: h, kind: 'GIVEN' }) }] : []),
        ...(mayGive(h) && h.balance > 0 ? [{ key: 'return', label: t('advances_record_return'), icon: ArrowUDownLeftIcon, onSelect: () => setRecording({ holder: h, kind: 'RETURNED' }) }] : []),
        ...(mayGive(h) ? [{ key: 'correct', label: t('advances_correct'), icon: SlidersHorizontalIcon, onSelect: () => setRecording({ holder: h, kind: 'CORRECTION' }) }] : []),
        { key: 'history', label: t('advances_history'), icon: ClockCounterClockwiseIcon, href: href(h) },
    ]
    const actions = (h: AdvanceHolder) => (
        <span className="ui-row-actions">
            <RowMenu label={t('ui_more_actions_for').replace('{name}', h.name)} tooltip={t('ui_more_actions')} items={menu(h)} />
        </span>
    )
    const person = (h: AdvanceHolder) => (
        <ItemTitle
            title={<Link href={href(h)} prefetch={false} className="ui-item-link"><bdi>{h.name}</bdi></Link>}
            detail={!h.atWork ? <StatusBadge tone="neutral">{t('advances_not_at_work_badge')}</StatusBadge> : undefined}
        />
    )
    const last = (h: AdvanceHolder) => h.lastDate ? <span>{dayLabel(h.lastDate, locale)}</span> : <span className="ui-hint">{t('advances_none_yet')}</span>
    const awaiting = (h: AdvanceHolder) => h.awaiting > 0 ? <StatusBadge tone="waiting">{money(h.awaiting)}</StatusBadge> : <span className="ui-hint">—</span>

    const columns: Column<AdvanceHolder>[] = [
        { key: 'person', header: t('advances_col_person'), cell: person },
        { key: 'balance', header: t('advances_col_balance'), align: 'end', cell: h => <strong className="ui-nowrap">{money(h.balance)}</strong> },
        { key: 'awaiting', header: t('advances_col_awaiting'), align: 'end', cell: h => <span className="ui-nowrap">{awaiting(h)}</span> },
        { key: 'last', header: t('advances_col_last'), cell: h => <span className="ui-nowrap">{last(h)}</span> },
        { key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end', cell: actions },
    ]

    if (!listUrl) return <div className="ui-panel"><EmptyState icon={BuildingsIcon} title={t('advances_pick_company')} /></div>
    if (off) return <div className="ui-panel"><EmptyState icon={WalletIcon} title={t('advances_off')} /></div>

    const empty = failed
        ? <EmptyState icon={WarningCircleIcon} title={t('advances_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
        : search || filtersOn > 0
            ? <EmptyState icon={WalletIcon} title={t('advances_none_found')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
            : <EmptyState icon={UsersIcon} title={t('advances_none')} />

    return (
        <>
            <FilterBar
                search={<Field label={t('advances_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('advances_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                <Field label={t('advances_filter_label')} hideLabel>{p => (
                    <Select {...p} icon={WalletIcon} value={holding ? 'holding' : 'all'} onChange={e => { setHolding(e.target.value === 'holding'); setPage(1) }} options={[
                        { value: 'all', label: t('advances_filter_everyone') },
                        { value: 'holding', label: t('advances_filter_holding') },
                    ]} />
                )}</Field>
            </FilterBar>

            {totals && !failed && (
                <TotalTiles items={[
                    { label: t('advances_total_held'), value: money(totals.held) },
                    { label: t('advances_total_awaiting'), value: money(totals.awaiting) },
                    { label: t('advances_total_holders'), value: totals.holders.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB') },
                ]} />
            )}

            {isLoading && !result && !failed
                ? <div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('advances_loading')} /></div>
                : (
                    <DataList
                        caption={t('costs_tab_advances')}
                        columns={columns}
                        rows={holders}
                        rowKey={h => h.id}
                        card={h => (
                            <ListCard
                                title={<Link href={href(h)} prefetch={false} className="ui-item-link"><bdi>{h.name}</bdi></Link>}
                                status={!h.atWork ? <StatusBadge tone="neutral">{t('advances_not_at_work_badge')}</StatusBadge> : undefined}
                                details={[
                                    { icon: WalletIcon, text: <span>{t('advances_col_balance')}: <strong className="ui-num">{money(h.balance)}</strong></span> },
                                    ...(h.awaiting > 0 ? [{ icon: HourglassIcon, text: <span>{t('advances_col_awaiting')}: <span className="ui-num">{money(h.awaiting)}</span></span> }] : []),
                                    { icon: CalendarBlankIcon, text: <span>{t('advances_col_last')}: {last(h)}</span> },
                                ]}
                                foot={actions(h)}
                            />
                        )}
                        footer={<Pager page={page} pageCount={totalPages} onPage={setPage} summary={countOf(t, locale, total, 'employees')} />}
                        empty={empty}
                    />
                )}

            <CashAdvanceDialog
                person={recording ? { id: recording.holder.id, name: recording.holder.name, balance: recording.holder.balance } : null}
                kind={recording?.kind ?? 'GIVEN'}
                today={result?.data?.today}
                onClose={() => setRecording(null)}
                onSaved={() => { void mutate() }}
            />
        </>
    )
}
