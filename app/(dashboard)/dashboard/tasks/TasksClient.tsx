'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { CircleHalfIcon, ClipboardTextIcon, CoinsIcon, MapPinIcon, PlusIcon, SortAscendingIcon, UserCheckIcon, UserIcon, UsersThreeIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useModules } from '@/lib/useModules'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { placeLine } from '@/lib/task-place'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import type { TranslationKey } from '@/lib/translations'
import SafeDate from '@/components/SafeDate'
import DateRangePicker from '@/components/DateRangePicker'
import { usePlaceFilters } from '@/components/locations/usePlaceFilters'
import { useNameFilter } from '@/components/lists/useNameFilter'
import ExtraFilterSelects from '@/components/filters/ExtraFilterSelects'
import { pickExtra } from '@/components/filters/extra-filters'
import { withChanges } from '@/components/filters/address'
import { useListAddress, useSearchField } from '@/components/filters/useListAddress'
import { useEmployeeOptions } from '@/components/filters/useEmployeeOptions'
import {
    Button, ButtonLink, DataList, DueDate, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, Person,
    SearchInput, Select, StatusBadge, TabLinks, taskStatusTone, visibleRow, type Column,
} from '@/components/ui'

type Named = { firstName: string; lastName: string }

/** A task as the list shows it (the page selects these). */
type TaskRow = {
    id: string
    title: string
    status: string
    deadline: string | Date
    difficulty: number
    createdAt: string | Date
    updatedAt: string | Date
    /** Who approved, completed or rejected it. */
    lastStatusUpdateBy?: string | null
    /** What each assignee is paid for it; only their own line for someone who sees only their own tasks. */
    memberCosts?: Record<string, number> | string | null
    assignees: ({ id: string } & Named)[]
    creator?: Named | null
    client?: { name: string } | null
    place?: { name: string; client?: { name: string } | null } | null
    location?: string | null
}

interface TasksClientProps {
    tasks: TaskRow[]
    total: number
    page: number
    totalPages: number
    currentUserId: string
    view: string
    /** The server's clock, which a task is overdue by. */
    now: number
}

/** How the list is ordered, within the page shown. */
const SORTS = {
    smart_asc: 'tasks_sort_smart',
    deadline_asc: 'tasks_sort_deadline_soonest',
    deadline_desc: 'tasks_sort_deadline_latest',
    difficulty_desc: 'tasks_sort_hardest',
    difficulty_asc: 'tasks_sort_easiest',
    createdAt_desc: 'tasks_sort_newest',
    createdAt_asc: 'tasks_sort_oldest',
} as const satisfies Record<string, TranslationKey>
type SortKey = keyof typeof SORTS

/** In progress first, then waiting for review, then not started, then done. */
const ACTIVE_FIRST = ['IN_PROGRESS', 'PENDING_CONFIRMATION', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']
const STATUSES = ['PENDING', 'IN_PROGRESS', 'PENDING_CONFIRMATION', 'APPROVED', 'COMPLETED', 'REJECTED']
/** Statuses that a task past its deadline is overdue in. */
const OPEN = ['PENDING', 'IN_PROGRESS']

const time = (d: string | Date) => new Date(d).getTime()
const fullName = (p: Named) => `${p.firstName} ${p.lastName}`.trim()

/**
 * The Tasks list (DESIGN.md §5.4): the tasks this person sees, a table on
 * computers and cards on phones. Its filters, order and page are in the
 * address, which the server reads, so a filtered list can be shared.
 */
export default function TasksClient({ tasks, total, page, totalPages, currentUserId, view, now }: TasksClientProps) {
    const { t, locale } = useLanguage()
    const modules = useModules()
    // From the role the page passed down, so the first paint is complete. A
    // team-wide reach is a Team Leader's two tabs; none is an employee's one.
    const { can, scope } = useCan()
    const reach = scope('tasks.view')
    // Someone who sees only their own tasks has nobody else's to filter by.
    const ownTasksOnly = reach === null

    const { picked, go } = useListAddress('/dashboard/tasks')
    const filters = {
        employeeId: picked.get('employeeId') || '',
        status: picked.get('status') || '',
        dateFrom: picked.get('dateFrom') || '',
        dateTo: picked.get('dateTo') || '',
        search: picked.get('search') || '',
        clientId: picked.get('clientId') || '',
        locationId: picked.get('locationId') || '',
        titleNameId: picked.get('titleNameId') || '',
    }
    // Its client, or none, and where it's done (CLIENTS_PLAN.md §3); a saved
    // title, picked as it or typed the same (§5.9).
    const placeFilters = usePlaceFilters({ clientId: filters.clientId, locationId: filters.locationId })
    const titleFilter = useNameFilter('TASK_TITLE', 'titleNameId', filters.titleNameId)
    const extraFilters = [...placeFilters, ...titleFilter]
    const employeeOptions = useEmployeeOptions(!ownTasksOnly)
    const { query, setQuery, clear } = useSearchField(filters.search, go)

    const pickFilter = (key: string, value: string) => {
        const values = Object.fromEntries(extraFilters.map(f => [f.key, f.value]))
        go(pickExtra(extraFilters, values, key, value))
    }
    const filtersOn = ownTasksOnly ? 0 : (filters.employeeId ? 1 : 0) + (filters.status ? 1 : 0) + (filters.dateFrom || filters.dateTo ? 1 : 0) + extraFilters.filter(f => f.value).length
    // The tab stays: it's whose tasks, not a filter.
    const resetFilters = () => {
        clear()
        go({ employeeId: '', status: '', dateFrom: '', dateTo: '', search: '', clientId: '', locationId: '', titleNameId: '', sortBy: '', sortOrder: '' })
    }

    const sortParam = `${picked.get('sortBy') || 'smart'}_${picked.get('sortOrder') || 'asc'}`
    const sortKey: SortKey = sortParam in SORTS ? sortParam as SortKey : 'smart_asc'
    const [sortBy, sortOrder] = sortKey.split('_') as [string, 'asc' | 'desc']
    const sorted = [...tasks].sort((a, b) => {
        const comparison = sortBy === 'smart'
            // Then the most recently changed first.
            ? (ACTIVE_FIRST.indexOf(a.status) - ACTIVE_FIRST.indexOf(b.status)) || (time(b.updatedAt) - time(a.updatedAt))
            : sortBy === 'deadline' ? time(a.deadline) - time(b.deadline)
                : sortBy === 'difficulty' ? (a.difficulty || 0) - (b.difficulty || 0)
                    : time(a.createdAt) - time(b.createdAt)
        return sortOrder === 'asc' || sortBy === 'smart' ? comparison : -comparison
    })

    // The task a notification opened, brought into view while it's on the
    // page shown. The list has it twice, as a table row and as a phone card,
    // so it's the one showing at this width.
    const highlightId = picked.get('highlight')
    const highlighted = useFadingHighlight(highlightId, 6000)
    const highlightShown = !!highlightId && tasks.some(task => task.id === highlightId)
    useEffect(() => {
        if (!highlightId || !highlightShown) return
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        visibleRow(highlightId)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
    }, [highlightId, highlightShown])

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const overdue = (task: TaskRow) => OPEN.includes(task.status) && time(task.deadline) < now
    const mine = (task: TaskRow) => task.assignees.some(a => a.id === currentUserId)
    // What they're paid for a task they share with others.
    const myCost = (task: TaskRow) => {
        if (task.assignees.length < 2) return 0
        const costs = typeof task.memberCosts === 'string' ? JSON.parse(task.memberCosts) : task.memberCosts
        return Number(costs?.[currentUserId] ?? 0)
    }

    // Their own tasks say who gave them; anyone else's, who they're for. A
    // Team Leader's first tab is their own; nobody else's list has a view.
    const ownList = ownTasksOnly || (reach === 'TEAM' && view === 'my')
    const whoHeader = ownList ? t('assigned_by') : t('assignees_label')
    const whoNames = (task: TaskRow) => ownList
        ? [task.creator ? fullName(task.creator) : t('role_super_admin')]
        : task.assignees.map(fullName)
    const who = (task: TaskRow) => <Person names={whoNames(task)} moreLabel={n => `+${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')}`} />

    const title = (task: TaskRow) => <Link href={`/dashboard/tasks/${task.id}`} prefetch={false} className="ui-item-link"><bdi>{task.title}</bdi></Link>
    const badge = (task: TaskRow) => <StatusBadge tone={taskStatusTone(task.status)}>{t(`status_${task.status.toLowerCase()}` as TranslationKey)}</StatusBadge>
    // Who approved, completed or rejected it.
    const decidedBy = (task: TaskRow) => ['APPROVED', 'COMPLETED', 'REJECTED'].includes(task.status) && task.lastStatusUpdateBy
        ? t('tasks_status_by').replace('{name}', task.lastStatusUpdateBy)
        : null
    const due = (task: TaskRow) => <DueDate overdue={overdue(task)}><SafeDate date={task.deadline} locale={locale} format="short" /></DueDate>
    const points = (task: TaskRow) => <span className="ui-chip">{countOf(t, locale, task.difficulty ?? 0, 'pts')}</span>
    // What's next for whoever it's for: starting it, going on with it.
    const action = (task: TaskRow) => {
        const label = !mine(task) ? t('view_task') : task.status === 'PENDING' ? t('start_task') : task.status === 'IN_PROGRESS' ? t('continue_task') : t('open_task')
        const next = mine(task) && OPEN.includes(task.status)
        return <ButtonLink href={`/dashboard/tasks/${task.id}`} prefetch={false} size="sm" variant={next ? 'primary' : 'secondary'} aria-label={`${label}: ${task.title}`}>{label}</ButtonLink>
    }

    const columns: Column<TaskRow>[] = [
        { key: 'task', header: t('tasks_col_task'), cell: task => <ItemTitle title={title(task)} detail={placeLine(task) || undefined} detailIcon={MapPinIcon} /> },
        {
            key: 'who', header: whoHeader, cell: task => (
                <>
                    {who(task)}
                    {myCost(task) > 0 && <div className="ui-item-detail ui-nowrap">{t('tasks_my_cost')}: <span className="ui-num">{money(myCost(task))}</span></div>}
                </>
            ),
        },
        { key: 'deadline', header: t('deadline_label'), cell: due },
        { key: 'points', header: t('difficulty'), cell: points },
        {
            key: 'status', header: t('status_label'), cell: task => (
                <>
                    {badge(task)}
                    {decidedBy(task) && <div className="ui-item-detail"><bdi>{decidedBy(task)}</bdi></div>}
                </>
            ),
        },
        { key: 'action', header: t('actions_label'), hideHeader: true, align: 'end', cell: action },
    ]

    const empty = filtersOn > 0 || filters.search
        ? <EmptyState icon={ClipboardTextIcon} title={t('tasks_empty_filters')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
        // A team leader with nobody assigned to them sees an empty screen
        // that is entirely correct, and looks exactly like a broken one. It
        // says why, and who can fix it: the leader can't assign their own team.
        : reach === 'TEAM' && view !== 'my'
            ? <EmptyState icon={UsersThreeIcon} title={t('team_empty_title')} detail={t('team_empty_body')} />
            : <EmptyState icon={ClipboardTextIcon} title={t('tasks_empty')} />

    // Their own tasks or their team's, keeping the filters.
    const tabHref = (to: string) => `/dashboard/tasks?${withChanges(picked.toString(), { view: to })}`

    return (
        <Page>
            <PageHeader
                title={modules.label('tasks')}
                subtitle={t('tasks_subtitle')}
                action={can('tasks.create') && (
                    <ButtonLink href="/dashboard/tasks/new" variant="primary" icon={PlusIcon}>{t('create_new_task')}</ButtonLink>
                )}
            />

            {/* A Team Leader's, not an employee's: the second tab is their
                team's work. The page enforces this regardless of what the
                address asks for; this only stops offering it. */}
            {reach === 'TEAM' && (
                <TabLinks label={t('tasks_tabs_label')} items={[
                    { href: tabHref('my'), label: t('my_tasks'), current: view === 'my' },
                    { href: tabHref('active'), label: t('tasks_tab_team'), current: view === 'active' },
                ]} />
            )}

            <FilterBar
                search={<Field label={t('tasks_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('tasks_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                {!ownTasksOnly && (
                    <>
                        <Field label={t('assignee_label')} hideLabel>{p => (
                            <Select {...p} icon={UserIcon} value={filters.employeeId} onChange={e => go({ employeeId: e.target.value })} options={employeeOptions} />
                        )}</Field>
                        <Field label={t('status_label')} hideLabel>{p => (
                            <Select {...p} icon={CircleHalfIcon} value={filters.status} onChange={e => go({ status: e.target.value })}
                                options={[{ value: '', label: t('all_statuses') }, ...STATUSES.map(s => ({ value: s, label: t(`status_${s.toLowerCase()}` as TranslationKey) }))]} />
                        )}</Field>
                        <ExtraFilterSelects filters={extraFilters} onPick={pickFilter} />
                        <DateRangePicker asField hideLabel dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(dateFrom, dateTo) => go({ dateFrom, dateTo })} />
                        <Field label={t('sort_by')} hideLabel>{p => (
                            <Select {...p} icon={SortAscendingIcon} value={sortKey} onChange={e => { const [by, order] = e.target.value.split('_'); go({ sortBy: by, sortOrder: order, page: String(page) }) }}
                                options={(Object.keys(SORTS) as SortKey[]).map(k => ({ value: k, label: t(SORTS[k]) }))} />
                        )}</Field>
                    </>
                )}
            </FilterBar>

            <DataList
                caption={modules.label('tasks')}
                columns={columns}
                rows={sorted}
                rowKey={task => task.id}
                tone={task => highlighted === task.id ? 'selected' : overdue(task) ? 'overdue' : undefined}
                card={task => (
                    <ListCard
                        title={title(task)}
                        status={badge(task)}
                        details={[
                            ...(placeLine(task) ? [{ icon: MapPinIcon, text: <bdi>{placeLine(task)}</bdi> }] : []),
                            { icon: UserIcon, text: <span>{whoHeader}: <bdi>{whoNames(task).join(locale === 'ar' ? '، ' : ', ')}</bdi></span> },
                            ...(myCost(task) > 0 ? [{ icon: CoinsIcon, text: <span>{t('tasks_my_cost')}: <span className="ui-num">{money(myCost(task))}</span></span> }] : []),
                            ...(decidedBy(task) ? [{ icon: UserCheckIcon, text: <bdi>{decidedBy(task)}</bdi> }] : []),
                        ]}
                        // What's next is on a phone's card too, where the
                        // table isn't shown (found by Codex on PR 118).
                        foot={<>{due(task)}<span className="ui-row-actions">{points(task)}{action(task)}</span></>}
                    />
                )}
                footer={<Pager page={page} pageCount={totalPages} onPage={p => go({ page: String(p) })} summary={countOf(t, locale, total, 'tasks')} />}
                empty={empty}
            />
        </Page>
    )
}
