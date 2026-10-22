'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
    ArrowCounterClockwiseIcon, ClockCounterClockwiseIcon, EnvelopeSimpleIcon, IdentificationBadgeIcon, MinusCircleIcon,
    PauseCircleIcon, PencilSimpleIcon, PlayCircleIcon, PlusCircleIcon, ShieldIcon, SortAscendingIcon, TrashIcon,
    UserPlusIcon, UsersIcon, UsersThreeIcon, CircleHalfIcon, WarningCircleIcon,
} from '@phosphor-icons/react/ssr'
import { useCompany } from '@/context/CompanyContext'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import AccessDenied from '@/components/AccessDenied'
import ConfirmModal from '@/components/ConfirmModal'
import LoadingSpinner from '@/components/LoadingSpinner'
import {
    Avatar, Button, ButtonLink, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, PageHeader, Pager, pageInRange,
    RowMenu, SearchInput, Select, SelectionBar, StatusBadge, type Column, type MenuItem, type StatusTone,
} from '@/components/ui'
import { useModules } from '@/lib/useModules'
import { forScope, loadFailed, scopedFetcher, scopedKey } from '@/lib/swr-scoped'
import { useCan } from '@/lib/useCan'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import type { TranslationKey } from '@/lib/translations'
import { employeesListUrl, type EmployeesQuery } from './list-query'
import { fetchRetrying } from '@/lib/swr-fetcher'

interface Employee {
    id: string
    firstName: string
    lastName: string
    email: string
    role: string
    status: string
    totalDifficultyPoints: number
    username?: string
    teamLeaderId?: string | null
    // Just the name. The API selects these three fields rather than the
    // relation, so a colleague's whole row does not ride along in a list that
    // only prints a name.
    teamLeader?: { id: string; firstName: string; lastName: string } | null
}

type Leader = { id: string; firstName: string; lastName: string }

/** The sort picked, as one choice: the field and its direction together. */
const SORTS = {
    name_asc: { sort: 'name', order: 'asc', label: 'sort_name_asc' },
    name_desc: { sort: 'name', order: 'desc', label: 'sort_name_desc' },
    points_desc: { sort: 'points', order: 'desc', label: 'sort_points_desc' },
    points_asc: { sort: 'points', order: 'asc', label: 'sort_points_asc' },
    role_asc: { sort: 'role', order: 'asc', label: 'sort_role' },
} as const
type SortKey = keyof typeof SORTS

/** What a person's status means, for its colour (DESIGN.md §2.3). */
const STATUS_TONE: Record<string, StatusTone> = { ACTIVE: 'good', OFFLINE: 'neutral', SUSPENDED: 'problem', ARCHIVED: 'neutral' }
const STATUS_WORD: Record<string, TranslationKey> = { ACTIVE: 'status_online', OFFLINE: 'status_offline', SUSPENDED: 'status_suspended', ARCHIVED: 'status_archived' }

export default function EmployeesPage() {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const modules = useModules()
    const { data: session } = useSession()
    const userRole = session?.user?.role || ''
    const isSuperAdmin = userRole === 'SUPER_ADMIN'
    const { can, companyWide } = useCan()
    const { selectedCompanyId } = useCompany()

    const canAssignTeams = can('employees.assign_team')
    // The actions on each person, each offered with the permission its route
    // checks; the column of them is shown when any is.
    const canActOnPeople = can('employees.edit') || can('salary.view') || can('salary_adjustments.manage')
        || can('requests.reset_points') || can('employees.delete')
    const teamOnly = can('employees.view') && !companyWide('employees.view')

    const [page, setPage] = useState(1)
    const limit = 10
    const [query, setQuery] = useState('')
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('')
    const [role, setRole] = useState('')
    const [team, setTeam] = useState('')
    const [sortKey, setSortKey] = useState<SortKey>('name_asc')

    // Bulk team assignment. A Set rather than an array because the only two
    // operations are "is this one picked" and "toggle it".
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [bulkLeaderId, setBulkLeaderId] = useState('')
    const [bulkSaving, setBulkSaving] = useState(false)
    const [teamLeaders, setTeamLeaders] = useState<Leader[]>([])
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null)
    // Resetting points can't be undone, so it asks first, as Delete does.
    const [resetConfirm, setResetConfirm] = useState<{ id: string; name: string } | null>(null)
    const [resettingPoints, setResettingPoints] = useState<string | null>(null)

    // The search is sent once typing pauses, not on every key.
    useEffect(() => {
        if (query.trim() === search) return
        const timer = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 400)
        return () => clearTimeout(timer)
    }, [query, search])

    const sort = SORTS[sortKey]
    const listQuery: EmployeesQuery | null = session?.user ? {
        page, limit,
        companyId: selectedCompanyId,
        teamOnly,
        viewerId: (session.user as any).id,
        search, status, role,
        teamLeaderId: team,
        sort: sort.sort, order: sort.order,
    } : null
    // Only this company's rows, while the next page or filter loads. If they
    // didn't load, the list says so rather than that there's nobody.
    const listUrl = listQuery ? employeesListUrl(listQuery) : null
    const { data: scoped, error, isLoading, isValidating, mutate } = useSWR(scopedKey(listUrl, selectedCompanyId), scopedFetcher, { keepPreviousData: true })
    const result = forScope(scoped, selectedCompanyId)
    const failed = loadFailed(scoped, error, listUrl)
    const employees: Employee[] = failed ? [] : result?.data?.data || []
    const totalPages: number = result?.data?.totalPages || 0
    const total: number = result?.data?.total || 0

    // Another company: its first page, without a team or picks from the last
    // one. Fewer pages, as when the last person on the last page is deleted:
    // the last page there is now. An empty page shows no pager to leave it by.
    useAdjustOnChange([selectedCompanyId], () => { setPage(1); setTeam(''); setPicked(new Set()) })
    useAdjustOnChange([totalPages], () => setPage(p => pageInRange(p, totalPages)))

    useEffect(() => {
        if (!canAssignTeams) return
        fetchRetrying('/api/users?role=TEAM_LEADER&limit=1000')
            .then(r => r.json())
            .then(d => setTeamLeaders(d.data?.data || []))
            .catch(() => { /* the picker simply stays empty */ })
    }, [canAssignTeams])

    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    const nameOf = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`
    const roleWord = (r: string) => t(`role_${r.toLowerCase()}` as TranslationKey) || r
    const filtersOn = [status, role, team].filter(Boolean).length + (sortKey === 'name_asc' ? 0 : 1)

    const resetFilters = () => {
        setQuery(''); setSearch(''); setStatus(''); setRole(''); setTeam(''); setSortKey('name_asc'); setPage(1)
    }
    const pick = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1) }

    const togglePicked = (id: string) => {
        setPicked(prev => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

    const applyBulkTeam = async () => {
        setBulkSaving(true)
        try {
            const res = await fetch('/api/users/team', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                // Empty option means unassign, so it goes as null — the same
                // three states the single-employee form and the server use.
                body: JSON.stringify({ userIds: [...picked], teamLeaderId: bulkLeaderId || null }),
            })
            const body = await res.json().catch(() => null)
            if (!res.ok) {
                showToast(body?.error || t('error_generic'), 'error')
                return
            }
            showToast(t('bulk_assign_done').replace('{count}', num(body?.data?.updated ?? picked.size)), 'success')
            setPicked(new Set())
            setBulkLeaderId('')
            mutate()
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setBulkSaving(false)
        }
    }

    const confirmDelete = async () => {
        if (!deleteConfirm) return
        try {
            const res = await fetch(`/api/users?id=${deleteConfirm.id}`, { method: 'DELETE' })
            if (res.ok) {
                showToast(t('employee_deleted'), 'success')
                mutate()
            } else {
                const data = await res.json().catch(() => null)
                showToast(data?.error || t('error_generic'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setDeleteConfirm(null)
        }
    }

    const resetPoints = async (id: string) => {
        setResettingPoints(id)
        try {
            const res = await fetch(`/api/users/${id}/reset-points`, { method: 'POST' })
            if (res.ok) {
                mutate()
                showToast(t('points_reset_success'), 'success')
            } else {
                const data = await res.json().catch(() => null)
                showToast(data?.error || t('points_reset_failed'), 'error')
            }
        } catch {
            showToast(t('error_generic'), 'error')
        } finally {
            setResettingPoints(null)
            setResetConfirm(null)
        }
    }

    // The Super Admin suspends and reactivates from here. An ended contract
    // is not switched back on from a list: it is reinstated from the profile
    // screen, deliberately, and that records why.
    const setSuspended = async (emp: Employee, suspend: boolean) => {
        try {
            const res = await fetch('/api/users', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: emp.id, status: suspend ? 'SUSPENDED' : 'ACTIVE' }),
            })
            if (res.ok) mutate()
            else showToast(t('error_generic'), 'error')
        } catch {
            showToast(t('error_generic'), 'error')
        }
    }

    if (isLoading && !result && !failed) return <LoadingSpinner message={t('loading_users')} />

    // Once the session is known: before it loads nobody holds anything, and
    // this would flash "access denied" at everyone on the way in.
    if (session?.user && !can('employees.view')) return <AccessDenied />

    const canEdit = (e: Employee) => can('employees.edit') && (e.role !== 'ADMIN' || isSuperAdmin)
    const menuItems = (e: Employee): MenuItem[] => {
        const items: MenuItem[] = []
        const notAdmin = e.role !== 'ADMIN'
        if (can('salary.view') && notAdmin) items.push({ key: 'history', label: t('history'), icon: ClockCounterClockwiseIcon, href: `/dashboard/employees/${e.id}/history` })
        if (can('salary_adjustments.manage') && notAdmin) {
            items.push({ key: 'bonus', label: t('add_bonus'), icon: PlusCircleIcon, href: `/dashboard/employees/${e.id}/bonus` })
            items.push({ key: 'deduction', label: t('add_deduction'), icon: MinusCircleIcon, href: `/dashboard/employees/${e.id}/deduction` })
        }
        if (can('requests.reset_points') && notAdmin) {
            items.push({ key: 'reset', label: resettingPoints === e.id ? t('resetting') : t('reset_points'), icon: ArrowCounterClockwiseIcon, disabled: resettingPoints === e.id, onSelect: () => setResetConfirm({ id: e.id, name: nameOf(e) }) })
        }
        if (isSuperAdmin && e.status !== 'ARCHIVED') {
            items.push(e.status === 'SUSPENDED'
                ? { key: 'activate', label: t('reactivate_employee'), icon: PlayCircleIcon, onSelect: () => setSuspended(e, false) }
                : { key: 'suspend', label: t('suspend_employee'), icon: PauseCircleIcon, onSelect: () => setSuspended(e, true) })
        }
        if (can('employees.delete') && e.role !== 'SUPER_ADMIN') {
            items.push({ key: 'delete', label: t('delete_employee'), icon: TrashIcon, danger: true, onSelect: () => setDeleteConfirm({ id: e.id, name: nameOf(e) }) })
        }
        return items
    }

    const actions = (e: Employee) => {
        const items = menuItems(e)
        return (
            <span className="ui-row-actions">
                {canEdit(e) && <ButtonLink href={`/dashboard/employees/${e.id}`} size="sm" icon={PencilSimpleIcon} prefetch={false}>{t('edit')}</ButtonLink>}
                {items.length > 0 && <RowMenu label={t('ui_more_actions_for').replace('{name}', nameOf(e))} tooltip={t('ui_more_actions')} items={items} />}
            </span>
        )
    }

    // Only employees have a team, so only employees can be picked: a
    // checkbox on a leader would promise something the server refuses.
    const checkbox = (e: Employee) => canAssignTeams && e.role === 'EMPLOYEE'
        ? (
            <label className="ui-check-target">
                <input type="checkbox" className="ui-check" checked={picked.has(e.id)} onChange={() => togglePicked(e.id)} aria-label={t('ui_select_row').replace('{name}', nameOf(e))} />
            </label>
        )
        : null

    const name = (e: Employee) => <Link href={`/dashboard/employees/${e.id}?mode=view`} prefetch={false} className="ui-item-link">{nameOf(e)}</Link>
    // Unassigned is shown rather than left blank: it is a state an Admin has
    // to clear, and a gap reads as "not loaded" instead of "nobody".
    const teamOf = (e: Employee) => e.role !== 'EMPLOYEE'
        ? null
        : e.teamLeader ? nameOf(e.teamLeader) : <StatusBadge tone="waiting">{t('team_unassigned')}</StatusBadge>
    const points = (e: Employee) => e.role === 'ADMIN' ? null : <span className="ui-chip">{countOf(t, locale, e.totalDifficultyPoints || 0, 'pts')}</span>
    const statusBadge = (e: Employee) => <StatusBadge tone={STATUS_TONE[e.status] ?? 'neutral'}>{STATUS_WORD[e.status] ? t(STATUS_WORD[e.status]) : e.status}</StatusBadge>

    const columns: Column<Employee>[] = [
        ...(canAssignTeams ? [{ key: 'pick', header: t('ui_select_column'), hideHeader: true, cell: checkbox }] : []),
        {
            key: 'name', header: t('name_label'), cell: e => (
                <div className="ui-person">
                    <Avatar name={nameOf(e)} />
                    <div><ItemTitle title={name(e)} detail={<bdi>{e.email}</bdi>} /></div>
                </div>
            ),
        },
        { key: 'role', header: t('role_label'), cell: e => roleWord(e.role) },
        { key: 'team', header: t('team_column'), cell: teamOf },
        { key: 'points', header: t('points_label'), cell: points },
        { key: 'status', header: t('status_label'), cell: statusBadge },
        ...(canActOnPeople ? [{ key: 'actions', header: t('actions_label'), hideHeader: true, align: 'end' as const, cell: actions }] : []),
    ]

    const statusOptions = [
        { value: '', label: t('all_statuses') },
        { value: 'ACTIVE', label: t('status_online') },
        { value: 'OFFLINE', label: t('status_offline') },
        ...(isSuperAdmin ? [{ value: 'SUSPENDED', label: t('status_suspended') }] : []),
    ]
    const roleOptions = [
        { value: '', label: t('all_roles') },
        ...(teamOnly ? [] : [{ value: 'ADMIN', label: t('role_admin') }]),
        { value: 'TEAM_LEADER', label: t('role_team_leader') },
        { value: 'EMPLOYEE', label: t('role_employee') },
    ]

    return (
        <Page>
            <PageHeader
                title={modules.label('employees')}
                subtitle={t('employees_subtitle')}
                action={can('employees.create') && <ButtonLink href="/dashboard/employees/new" variant="primary" icon={UserPlusIcon}>{t('add_employee')}</ButtonLink>}
            />

            <FilterBar
                search={<Field label={t('employees_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('employees_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                <Field label={t('status_label')} hideLabel>{p => <Select {...p} icon={CircleHalfIcon} value={status} onChange={e => pick(setStatus)(e.target.value)} options={statusOptions} />}</Field>
                <Field label={t('role_label')} hideLabel>{p => <Select {...p} icon={ShieldIcon} value={role} onChange={e => pick(setRole)(e.target.value)} options={roleOptions} />}</Field>
                {canAssignTeams && teamLeaders.length > 0 && (
                    <Field label={t('team_column')} hideLabel>{p => (
                        <Select {...p} icon={UsersThreeIcon} value={team} onChange={e => pick(setTeam)(e.target.value)} options={[
                            { value: '', label: t('team_filter_all') },
                            { value: 'unassigned', label: t('team_unassigned') },
                            ...teamLeaders.map(l => ({ value: l.id, label: nameOf(l) })),
                        ]} />
                    )}</Field>
                )}
                <Field label={t('sort_by')} hideLabel>{p => (
                    <Select {...p} icon={SortAscendingIcon} value={sortKey} onChange={e => pick(setSortKey)(e.target.value as SortKey)}
                        options={(Object.keys(SORTS) as SortKey[]).map(k => ({ value: k, label: t(SORTS[k].label) }))} />
                )}</Field>
            </FilterBar>

            {canAssignTeams && picked.size > 0 && (
                <SelectionBar
                    count={t('bulk_selected').replace('{count}', num(picked.size))}
                    clear={<Button variant="quiet" onClick={() => setPicked(new Set())} disabled={bulkSaving}>{t('bulk_assign_clear')}</Button>}
                >
                    <Field label={t('team_leader_label')} hideLabel>{p => (
                        <Select {...p} icon={UsersIcon} value={bulkLeaderId} onChange={e => setBulkLeaderId(e.target.value)}
                            options={[{ value: '', label: t('team_leader_none') }, ...teamLeaders.map(l => ({ value: l.id, label: nameOf(l) }))]} />
                    )}</Field>
                    <Button variant="primary" onClick={applyBulkTeam} busy={bulkSaving}>{t('bulk_assign_apply')}</Button>
                </SelectionBar>
            )}

            <DataList
                caption={modules.label('employees')}
                columns={columns}
                rows={employees}
                rowKey={e => e.id}
                card={e => (
                    <ListCard
                        title={<span className="ui-person">{checkbox(e)}{name(e)}</span>}
                        status={statusBadge(e)}
                        details={[
                            { icon: EnvelopeSimpleIcon, text: <bdi>{e.email}</bdi> },
                            { icon: IdentificationBadgeIcon, text: roleWord(e.role) },
                            ...(e.role === 'EMPLOYEE' ? [{ icon: UsersThreeIcon, text: teamOf(e) }] : []),
                        ]}
                        foot={<>{points(e) ?? <span />}{canActOnPeople && actions(e)}</>}
                    />
                )}
                footer={<Pager page={page} pageCount={totalPages} onPage={setPage} summary={countOf(t, locale, total, 'employees')} />}
                empty={failed
                    ? <EmptyState icon={WarningCircleIcon} title={t('employees_load_failed')} action={<Button busy={isValidating} onClick={() => { void mutate() }}>{t('try_again')}</Button>} />
                    : <EmptyState icon={UsersIcon} title={t('no_employees_found')} action={filtersOn > 0 || search
                        ? <Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>
                        : can('employees.create') && <ButtonLink href="/dashboard/employees/new" variant="primary" icon={UserPlusIcon}>{t('add_employee')}</ButtonLink>} />}
            />

            <ConfirmModal
                isOpen={!!resetConfirm}
                title={t('reset_points')}
                message={`${t('reset_points_question').replace('{name}', resetConfirm?.name ?? '')} ${t('undone_warning_plain')}`}
                confirmText={t('reset_points')}
                cancelText={t('cancel')}
                onConfirm={() => resetConfirm && resetPoints(resetConfirm.id)}
                onCancel={() => setResetConfirm(null)}
                variant="warning"
            />
            <ConfirmModal
                isOpen={!!deleteConfirm}
                title={t('delete_employee')}
                message={`${t('delete_employee_question').replace('{name}', deleteConfirm?.name ?? '')} ${t('undone_warning_plain')}`}
                confirmText={t('delete_employee')}
                cancelText={t('cancel')}
                onConfirm={confirmDelete}
                onCancel={() => setDeleteConfirm(null)}
                variant="danger"
            />
        </Page>
    )
}
