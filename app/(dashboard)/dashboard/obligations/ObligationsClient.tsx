'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { CircleHalfIcon, ListChecksIcon, PlusIcon, RepeatIcon, SortAscendingIcon, UserCheckIcon, UserIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { RECURRENCE_STYLE } from '@/lib/recurrence'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import type { TranslationKey } from '@/lib/translations'
import SafeDate from '@/components/SafeDate'
import DateRangePicker from '@/components/DateRangePicker'
import { useListAddress, useSearchField } from '@/components/filters/useListAddress'
import { useEmployeeOptions } from '@/components/filters/useEmployeeOptions'
import {
    Button, ButtonLink, DataList, DueDate, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, Person,
    SearchInput, Select, StatusBadge, taskStatusTone, visibleRow, type Column,
} from '@/components/ui'

/** An obligation as the list shows it (the page selects these). */
type ObligationRow = {
    id: string
    title: string
    status: string
    deadline: string | Date
    difficulty: number
    /** ONE_TIME, DAILY, WEEKLY, MONTHLY or YEARLY. */
    recurrence?: string | null
    createdAt: string | Date
    updatedAt: string | Date
    /** Who approved, completed or rejected it. */
    lastStatusUpdateBy?: string | null
    assignees: { id: string; firstName: string; lastName: string }[]
}

interface ObligationsClientProps {
    obligations: ObligationRow[]
    total: number
    page: number
    totalPages: number
    currentUserId: string
    /** The server's clock, which an obligation is overdue by. */
    now: number
}

/** How the list is ordered, within the page shown. */
const SORTS = {
    smart_asc: 'list_sort_smart',
    deadline_asc: 'list_sort_deadline_soonest',
    deadline_desc: 'list_sort_deadline_latest',
    createdAt_desc: 'list_sort_newest',
    createdAt_asc: 'list_sort_oldest',
} as const satisfies Record<string, TranslationKey>
type SortKey = keyof typeof SORTS

/** In progress first, then waiting for review, then not started, then done. */
const ACTIVE_FIRST = ['IN_PROGRESS', 'PENDING_CONFIRMATION', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']
const STATUSES = ['PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED']
/** Statuses an obligation is decided in: past its deadline in any other, it's overdue. */
const DECIDED = ['COMPLETED', 'APPROVED', 'REJECTED']

const time = (d: string | Date) => new Date(d).getTime()

/**
 * The Obligations list (DESIGN.md §5.4): the obligations this person sees,
 * a table on computers and cards on phones. Its filters, order and page are
 * in the address, which the server reads, so a filtered list can be shared.
 */
export default function ObligationsClient({ obligations, total, page, totalPages, currentUserId, now }: ObligationsClientProps) {
    const { t, locale } = useLanguage()
    const modules = useModules()
    const permissions = useCan()
    // Someone who sees only their own obligations has nobody else's to filter by.
    const ownObligationsOnly = !permissions.can('obligations.view')

    const { picked, go } = useListAddress('/dashboard/obligations')
    const filters = {
        employeeId: picked.get('employeeId') || '',
        status: picked.get('status') || '',
        dateFrom: picked.get('dateFrom') || '',
        dateTo: picked.get('dateTo') || '',
        search: picked.get('search') || '',
    }
    const employeeOptions = useEmployeeOptions(!ownObligationsOnly)
    const { query, setQuery, clear } = useSearchField(filters.search, go)

    const filtersOn = ownObligationsOnly ? 0 : (filters.employeeId ? 1 : 0) + (filters.status ? 1 : 0) + (filters.dateFrom || filters.dateTo ? 1 : 0)
    const resetFilters = () => {
        clear()
        go({ employeeId: '', status: '', dateFrom: '', dateTo: '', search: '', sortBy: '', sortOrder: '' })
    }

    const sortParam = `${picked.get('sortBy') || 'smart'}_${picked.get('sortOrder') || 'asc'}`
    const sortKey: SortKey = sortParam in SORTS ? sortParam as SortKey : 'smart_asc'
    const [sortBy, sortOrder] = sortKey.split('_') as [string, 'asc' | 'desc']
    const sorted = [...obligations].sort((a, b) => {
        const comparison = sortBy === 'smart'
            // Then the most recently changed first.
            ? (ACTIVE_FIRST.indexOf(a.status) - ACTIVE_FIRST.indexOf(b.status)) || (time(b.updatedAt) - time(a.updatedAt))
            : sortBy === 'deadline' ? time(a.deadline) - time(b.deadline)
                : time(a.createdAt) - time(b.createdAt)
        return sortOrder === 'asc' || sortBy === 'smart' ? comparison : -comparison
    })

    // The obligation a notification opened, brought into view while it's on
    // the page shown. The list has it twice, as a table row and as a phone
    // card, so it's the one showing at this width.
    const highlightId = picked.get('highlight')
    const highlighted = useFadingHighlight(highlightId, 6000)
    const highlightShown = !!highlightId && obligations.some(o => o.id === highlightId)
    useEffect(() => {
        if (!highlightId || !highlightShown) return
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        visibleRow(highlightId)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }, [highlightId, highlightShown])

    const overdue = (o: ObligationRow) => !DECIDED.includes(o.status) && time(o.deadline) < now
    const mine = (o: ObligationRow) => o.assignees.some(a => a.id === currentUserId)
    const names = (o: ObligationRow) => o.assignees.map(a => `${a.firstName} ${a.lastName}`.trim())
    const who = (o: ObligationRow) => <Person names={names(o)} moreLabel={n => `+${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}`} />
    // How often it comes round; one from before recurrence has none to say.
    const recurs = (o: ObligationRow) => {
        const style = o.recurrence ? RECURRENCE_STYLE[o.recurrence] : undefined
        return style ? t(style.labelKey as TranslationKey) : undefined
    }

    const title = (o: ObligationRow) => <Link href={`/dashboard/obligations/${o.id}`} prefetch={false} className="ui-item-link"><bdi>{o.title}</bdi></Link>
    const badge = (o: ObligationRow) => <StatusBadge tone={taskStatusTone(o.status)}>{t(`status_${o.status.toLowerCase()}` as TranslationKey)}</StatusBadge>
    // Who approved, completed or rejected it.
    const decidedBy = (o: ObligationRow) => DECIDED.includes(o.status) && o.lastStatusUpdateBy
        ? t('list_status_by').replace('{name}', o.lastStatusUpdateBy)
        : null
    const due = (o: ObligationRow) => <DueDate overdue={overdue(o)}><SafeDate date={o.deadline} locale={locale} format="short" /></DueDate>
    const points = (o: ObligationRow) => <span className="ui-chip">{countOf(t, locale, o.difficulty ?? 0, 'pts')}</span>
    // What's next for whoever it's for: starting it, going on with it.
    const action = (o: ObligationRow) => {
        const label = !mine(o) ? t('view_obligation') : o.status === 'PENDING' ? t('start_obligation') : o.status === 'IN_PROGRESS' ? t('continue_obligation') : t('open_obligation')
        const next = mine(o) && (o.status === 'PENDING' || o.status === 'IN_PROGRESS')
        return <ButtonLink href={`/dashboard/obligations/${o.id}`} prefetch={false} size="sm" variant={next ? 'primary' : 'secondary'} aria-label={`${label}: ${o.title}`}>{label}</ButtonLink>
    }

    const columns: Column<ObligationRow>[] = [
        { key: 'obligation', header: t('obligations_col_obligation'), cell: o => <ItemTitle title={title(o)} detail={recurs(o)} detailIcon={RepeatIcon} /> },
        { key: 'who', header: t('assignees_label'), cell: who },
        { key: 'deadline', header: t('deadline_label'), cell: due },
        { key: 'points', header: t('difficulty'), cell: points },
        {
            key: 'status', header: t('status_label'), cell: o => (
                <>
                    {badge(o)}
                    {decidedBy(o) && <div className="ui-item-detail"><bdi>{decidedBy(o)}</bdi></div>}
                </>
            ),
        },
        { key: 'action', header: t('actions_label'), hideHeader: true, align: 'end', cell: action },
    ]

    const empty = filtersOn > 0 || filters.search
        ? <EmptyState icon={ListChecksIcon} title={t('obligations_empty_filters')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
        : <EmptyState icon={ListChecksIcon} title={t('obligations_empty')} />

    return (
        <Page>
            <PageHeader
                title={modules.label('obligations')}
                subtitle={t('obligations_subtitle')}
                action={permissions.can('obligations.manage') && (
                    <ButtonLink href="/dashboard/obligations/new" variant="primary" icon={PlusIcon}>{t('add_obligation')}</ButtonLink>
                )}
            />

            <FilterBar
                search={<Field label={t('obligations_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('obligations_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                {!ownObligationsOnly && (
                    <>
                        <Field label={t('assignee_label')} hideLabel>{p => (
                            <Select {...p} icon={UserIcon} value={filters.employeeId} onChange={e => go({ employeeId: e.target.value })} options={employeeOptions} />
                        )}</Field>
                        <Field label={t('status_label')} hideLabel>{p => (
                            <Select {...p} icon={CircleHalfIcon} value={filters.status} onChange={e => go({ status: e.target.value })}
                                options={[{ value: '', label: t('all_statuses') }, ...STATUSES.map(s => ({ value: s, label: t(`status_${s.toLowerCase()}` as TranslationKey) }))]} />
                        )}</Field>
                        <DateRangePicker asField hideLabel dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(dateFrom, dateTo) => go({ dateFrom, dateTo })} />
                        <Field label={t('sort_by')} hideLabel>{p => (
                            <Select {...p} icon={SortAscendingIcon} value={sortKey} onChange={e => { const [by, order] = e.target.value.split('_'); go({ sortBy: by, sortOrder: order, page: String(page) }) }}
                                options={(Object.keys(SORTS) as SortKey[]).map(k => ({ value: k, label: t(SORTS[k]) }))} />
                        )}</Field>
                    </>
                )}
            </FilterBar>

            <DataList
                caption={modules.label('obligations')}
                columns={columns}
                rows={sorted}
                rowKey={o => o.id}
                tone={o => highlighted === o.id ? 'selected' : overdue(o) ? 'overdue' : undefined}
                card={o => (
                    <ListCard
                        title={title(o)}
                        status={badge(o)}
                        details={[
                            ...(recurs(o) ? [{ icon: RepeatIcon, text: recurs(o) }] : []),
                            { icon: UserIcon, text: <span>{t('assignees_label')}: <bdi>{names(o).join(locale === 'ar' ? '، ' : ', ')}</bdi></span> },
                            ...(decidedBy(o) ? [{ icon: UserCheckIcon, text: <bdi>{decidedBy(o)}</bdi> }] : []),
                        ]}
                        // What's next is on a phone's card too, where the table isn't shown.
                        foot={<>{due(o)}<span className="ui-row-actions">{points(o)}{action(o)}</span></>}
                    />
                )}
                footer={<Pager page={page} pageCount={totalPages} onPage={p => go({ page: String(p) })} summary={countOf(t, locale, total, 'obligations')} />}
                empty={empty}
            />
        </Page>
    )
}
