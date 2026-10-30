'use client'
import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { CheckCircleIcon, CoinsIcon, SortAscendingIcon, UserIcon, WalletIcon } from '@phosphor-icons/react/ssr'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { useCompany } from '@/context/CompanyContext'
import { useCan } from '@/lib/useCan'
import { fetcher } from '@/lib/swr-fetcher'
import { shareOwed, unallocatedCost } from '@/lib/cost-shares'
import { usePlaceFilters } from '@/components/locations/usePlaceFilters'
import { namedParts, payWording } from '@/lib/costs-total'
import { useNameFilter } from '@/components/lists/useNameFilter'
import { countOf } from '@/lib/plural'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import type { TranslationKey } from '@/lib/translations'
import ConfirmModal from '@/components/ConfirmModal'
import DateRangePicker from '@/components/DateRangePicker'
import CostsHeader from '@/components/charges/CostsHeader'
import ExtraFilterSelects from '@/components/filters/ExtraFilterSelects'
import { pickExtra } from '@/components/filters/extra-filters'
import {
    Button, DataList, EmptyState, Field, FilterBar, ItemTitle, ListCard, Page, Pager, SearchInput, Select, StatusBadge, TotalTiles,
    taskStatusTone, type Column,
} from '@/components/ui'

interface CostsClientProps {
    /** The page's tabs, for whoever also sees what clients are charged (CLIENTS_PLAN.md §6.4). */
    tabs?: ReactNode
    tasksWithCosts: any[]
    total: number
    page: number
    totalPages: number
    /** What the whole filtered list still owes, or the picked employee's share of it (CLIENTS_PLAN.md §3.5). */
    totalDue: number
    /** What Mark all as paid would pay, every part of every task in the list, as it's confirmed (§4.1); none with a cost name picked (§5.9). */
    toPay: { count: number; amount: number; digest: string } | null
    /** The cost name the list is filtered by, which each card's amount is of. */
    costName?: string | null
}

/** One person's share of a task's cost still to pay, or what of it is no one's share: a row of the list. */
type Entry = {
    id: string
    title: string
    status: string
    updatedAt: string
    displayCost: number
    displayAssignee: { id: string | null; firstName: string; lastName: string }
    /** What their cash advance paid of their costs on it (CLIENTS_PLAN.md §7.5). */
    fromAdvance?: number
}

/** How the list is ordered, within the page shown. */
const SORTS = {
    date_desc: 'costs_sort_newest',
    date_asc: 'costs_sort_oldest',
    amount_desc: 'costs_sort_highest',
    amount_asc: 'costs_sort_lowest',
} as const satisfies Record<string, TranslationKey>
type SortKey = keyof typeof SORTS

type Person = { id: string; firstName: string; lastName: string; role: string }

/**
 * The Costs page's Employee costs tab (CLIENTS_PLAN.md §3, §4.1): each
 * person's share of a reviewed task's costs still to pay, with what the list
 * comes to and Mark all as paid for whoever pays across the company. The
 * list, its filters and its pages are in the address, which the server
 * reads; Mark all as paid pays exactly that list.
 */
export default function CostsClient({ tabs, tasksWithCosts, total, page, totalPages, totalDue, toPay, costName }: CostsClientProps) {
    const { t, locale } = useLanguage()
    const { showToast } = useToast()
    const router = useRouter()
    const searchParams = useSearchParams()
    const { data: session } = useSession()
    const { selectedCompanyId } = useCompany()

    const filters = {
        // A Super Admin's chosen company, so Mark all as paid pays its costs only.
        company: searchParams.get('company') || '',
        employeeId: searchParams.get('employeeId') || '',
        dateFrom: searchParams.get('dateFrom') || '',
        dateTo: searchParams.get('dateTo') || '',
        search: searchParams.get('search') || '',
        // So Mark all as paid pays only the client's and location's shown (CLIENTS_PLAN.md §3.4).
        clientId: searchParams.get('clientId') || '',
        locationId: searchParams.get('locationId') || '',
        // The tasks with a cost of a saved name, and what those come to (CLIENTS_PLAN.md §5.9).
        costNameId: searchParams.get('costNameId') || '',
    }
    const placeFilters = usePlaceFilters({ clientId: filters.clientId, locationId: filters.locationId })
    const costNameFilter = useNameFilter('COST_NAME', 'costNameId', filters.costNameId)
    const extraFilters = [...placeFilters, ...costNameFilter]

    const { companyWide } = useCan()
    const [isUpdating, setIsUpdating] = useState(false)
    const [confirming, setConfirming] = useState(false)

    // The people whose costs it can show: the server keeps a Team Leader's to
    // their team. A Super Admin's are the company they're looking at.
    const superAdmin = (session?.user as { role?: string } | undefined)?.role === 'SUPER_ADMIN'
    const { data: peopleResult } = useSWR(session ? `/api/users?limit=1000${superAdmin && selectedCompanyId ? `&companyId=${selectedCompanyId}` : ''}` : null, fetcher)
    const people: Person[] = peopleResult?.data?.data || []
    const employeeOptions = [
        { value: '', label: t('all_employees') },
        // Admins add no costs of their own to pay.
        ...people.filter(p => p.role !== 'ADMIN' && p.role !== 'SUPER_ADMIN').map(p => ({ value: p.id, label: `${p.firstName} ${p.lastName}`.trim() })),
    ]

    const allCostEntries: Entry[] = tasksWithCosts.flatMap(task => {
        // With a cost name picked, each card is what's due of the costs of
        // that name: a person's on the task, or no one's (the task's own).
        if (filters.costNameId && Array.isArray(task.costs)) {
            const names = (task.assignees || []).map((a: any) => `${a.firstName} ${a.lastName}`.trim()).filter(Boolean)
            return namedParts([task], filters.employeeId).map(part => ({
                ...task,
                displayCost: part.amount,
                displayAssignee: part.userId
                    ? task.assignees?.find((a: any) => a.id === part.userId) || { firstName: t('unknown_user'), lastName: '', id: part.userId }
                    : { id: null, firstName: names.join(locale === 'ar' ? '، ' : ', ') || t('unknown_user'), lastName: '' },
            }))
        }
        const mCosts = typeof task.memberCosts === 'string' ? JSON.parse(task.memberCosts) : (task.memberCosts || {})
        const userCosts = Object.entries(mCosts)

        const mPaymentStatus = typeof task.memberPaymentStatus === 'string' ? JSON.parse(task.memberPaymentStatus) : (task.memberPaymentStatus || {})
        // Only the shares still to pay: one already paid, as one employee's
        // costs are by Mark all as paid, isn't waiting any more.
        const shares = userCosts.filter(([uid, amount]) => shareOwed(amount, mPaymentStatus[uid])).map(([uid, amount]) => ({
            ...task,
            displayCost: Number(amount),
            displayAssignee: task.assignees?.find((a: any) => a.id === uid) || { firstName: t('unknown_user'), lastName: '', id: uid },
            fromAdvance: Number(task.memberAdvance?.[uid] ?? 0),
        }))

        // What of the cost is no one's share: all of it for a cost not split
        // by member, as a task's was before memberCosts, or what a task had
        // then beside the shares added since. The task's own row: a task has
        // assignees, not an assignee, so it names them all.
        const unallocated = unallocatedCost(task.totalCost, mCosts)
        if (unallocated <= 0) return shares
        const names = (task.assignees || []).map((a: any) => `${a.firstName} ${a.lastName}`.trim()).filter(Boolean)
        return [...shares, {
            ...task,
            displayCost: unallocated,
            displayAssignee: { id: null, firstName: names.join(locale === 'ar' ? '، ' : ', ') || t('unknown_user'), lastName: '' },
        }]
    })

    // With an employee picked, only their shares: the task's own rows are no one's.
    const filteredEntries = allCostEntries.filter(entry => !filters.employeeId || entry.displayAssignee.id === filters.employeeId)

    const sortParam = `${searchParams.get('sortBy') || 'date'}_${searchParams.get('sortOrder') || 'desc'}`
    const sortKey: SortKey = sortParam in SORTS ? sortParam as SortKey : 'date_desc'
    const [sortBy, sortOrder] = sortKey.split('_') as ['date' | 'amount', 'asc' | 'desc']
    const sortedEntries = [...filteredEntries].sort((a, b) => {
        const comparison = sortBy === 'amount'
            ? a.displayCost - b.displayCost
            : new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        return sortOrder === 'asc' ? comparison : -comparison
    })

    /** The list with these changed in the address, from its first page unless it's the page that changes. */
    const go = (changes: Record<string, string>) => {
        const params = new URLSearchParams(searchParams.toString())
        for (const [key, value] of Object.entries(changes)) {
            if (value) params.set(key, value)
            else params.delete(key)
        }
        if (!('page' in changes)) params.set('page', '1')
        router.push(`/dashboard/costs?${params.toString()}`)
    }

    // The search is sent once typing pauses, not on every key. The field
    // follows the address only when something else changed its search, as
    // going back does: not when it's the search this sent, arriving while
    // more is typed.
    const [query, setQuery] = useState(filters.search)
    const [sent, setSent] = useState(filters.search)
    useAdjustOnChange([filters.search], () => {
        if (filters.search !== sent) setQuery(filters.search)
        setSent(filters.search)
    })
    useEffect(() => {
        if (query.trim() === sent) return
        const timer = setTimeout(() => {
            setSent(query.trim())
            go({ search: query.trim() })
        }, 400)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps -- `go` reads the address as it is when it fires.
    }, [query, sent])

    const pickFilter = (key: string, value: string) => {
        const picked = Object.fromEntries(extraFilters.map(f => [f.key, f.value]))
        go(pickExtra(extraFilters, picked, key, value))
    }
    const filtersOn = (filters.employeeId ? 1 : 0) + (filters.dateFrom || filters.dateTo ? 1 : 0) + extraFilters.filter(f => f.value).length
    const resetFilters = () => {
        setQuery('')
        setSent('')
        go({ employeeId: '', dateFrom: '', dateTo: '', search: '', clientId: '', locationId: '', costNameId: '', sortBy: '', sortOrder: '' })
    }

    // Pays exactly what the window said, and refuses if the list has changed since (CLIENTS_PLAN.md §4.1).
    const handleMarkAllAsPaid = async () => {
        if (!toPay) return
        setIsUpdating(true)
        try {
            const res = await fetch('/api/tasks/payment/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filters, confirm: { digest: toPay.digest } })
            })
            if (res.status === 409) {
                // Changed since it was shown: shown again as it is now.
                showToast(t('costs_pay_changed'), 'warning')
                router.refresh()
            } else if (res.ok) {
                showToast(t('successfully_marked_paid'), 'success')
                router.refresh()
            } else {
                showToast(t('failed_update_payment_status'), 'error')
            }
        } catch (error) {
            console.error('Bulk payment update failed', error)
            showToast(t('error_generic'), 'error')
        } finally {
            setIsUpdating(false)
            setConfirming(false)
        }
    }
    const wording = toPay ? payWording(t, locale, toPay.count, toPay.amount) : null
    // Paying everything at once is for those who pay across the company; a
    // Team Leader pays their team's one at a time. With a cost name, the list
    // adds up those costs, and a payment is a person's share of a whole task:
    // it says so rather than pay more than it shows (§5.9).
    const paysAll = companyWide('tasks.pay') && total > 0
    const payButton = paysAll && !filters.costNameId && toPay && toPay.count > 0 && (
        <Button variant="primary" icon={CheckCircleIcon} busy={isUpdating} onClick={() => setConfirming(true)}>
            {isUpdating ? t('marking_as_paid') : t('mark_all_as_paid')}
        </Button>
    )

    const money = (n: number) => `${n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${t('egp')}`
    const num = (n: number) => n.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-GB')
    // What each amount is: the cost name the list is filtered by, or what's to pay back.
    const amountIs = filters.costNameId && costName ? costName : t('advances_to_pay_back')
    const person = (e: Entry) => <bdi>{`${e.displayAssignee.firstName} ${e.displayAssignee.lastName}`.trim()}</bdi>
    const task = (e: Entry) => <Link href={`/dashboard/tasks/${e.id}`} prefetch={false} className="ui-item-link"><bdi>{e.title}</bdi></Link>
    const badge = (e: Entry) => <StatusBadge tone={taskStatusTone(e.status)}>{t(`status_${e.status.toLowerCase()}` as TranslationKey)}</StatusBadge>
    // What their cash advance paid of it, never paid again (CLIENTS_PLAN.md §7.2).
    const advanced = (e: Entry) => !filters.costNameId && (e.fromAdvance ?? 0) > 0

    const columns: Column<Entry>[] = [
        { key: 'task', header: t('costs_col_task'), cell: e => <ItemTitle title={task(e)} /> },
        { key: 'person', header: t('costs_col_employee'), cell: person },
        {
            key: 'amount', header: amountIs, align: 'end', cell: e => (
                <>
                    <strong className="ui-nowrap ui-num">{money(e.displayCost)}</strong>
                    {advanced(e) && <div className="ui-item-detail ui-nowrap">{t('advances_from_advance')}: <span className="ui-num">{money(e.fromAdvance ?? 0)}</span></div>}
                </>
            ),
        },
        { key: 'status', header: t('status_label'), cell: badge },
    ]

    const empty = filtersOn > 0 || filters.search
        ? <EmptyState icon={CoinsIcon} title={t('no_costs_found_filters')} action={<Button variant="quiet" onClick={resetFilters}>{t('ui_reset_filters')}</Button>} />
        : <EmptyState icon={CoinsIcon} title={t('no_costs_found_yet')} />

    return (
        <Page>
            <CostsHeader action={payButton} />
            {tabs}

            <FilterBar
                search={<Field label={t('costs_search')} hideLabel>{p => <SearchInput {...p} autoComplete="off" placeholder={t('costs_search')} value={query} onChange={e => setQuery(e.target.value)} />}</Field>}
                activeCount={filtersOn}
                onReset={filtersOn > 0 || query ? resetFilters : undefined}
            >
                <Field label={t('costs_col_employee')} hideLabel>{p => (
                    <Select {...p} icon={UserIcon} value={filters.employeeId} onChange={e => go({ employeeId: e.target.value })} options={employeeOptions} />
                )}</Field>
                <ExtraFilterSelects filters={extraFilters} onPick={pickFilter} />
                <DateRangePicker asField hideLabel dateFrom={filters.dateFrom} dateTo={filters.dateTo} onChange={(dateFrom, dateTo) => go({ dateFrom, dateTo })} />
                <Field label={t('sort_by')} hideLabel>{p => (
                    <Select {...p} icon={SortAscendingIcon} value={sortKey} onChange={e => { const [by, order] = e.target.value.split('_'); go({ sortBy: by, sortOrder: order, page: String(page) }) }}
                        options={(Object.keys(SORTS) as SortKey[]).map(k => ({ value: k, label: t(SORTS[k]) }))} />
                )}</Field>
            </FilterBar>

            <TotalTiles items={[
                { label: t('costs_total_tasks'), value: num(total) },
                {
                    label: t('costs_total_due'), value: money(totalDue),
                    // Mark all as paid gives way to why, with a cost name picked.
                    note: paysAll && filters.costNameId ? t('costs_pay_by_name') : undefined,
                },
            ]} />

            <DataList
                caption={t('costs_tab_employee')}
                columns={columns}
                rows={sortedEntries}
                rowKey={e => `${e.id}-${e.displayAssignee.id ?? 'task'}`}
                card={e => (
                    <ListCard
                        title={task(e)}
                        status={badge(e)}
                        details={[
                            { icon: UserIcon, text: person(e) },
                            { icon: CoinsIcon, text: <span>{amountIs}: <strong className="ui-num">{money(e.displayCost)}</strong></span> },
                            ...(advanced(e) ? [{ icon: WalletIcon, text: <span>{t('advances_from_advance')}: <span className="ui-num">{money(e.fromAdvance ?? 0)}</span></span> }] : []),
                        ]}
                    />
                )}
                footer={<Pager page={page} pageCount={totalPages} onPage={p => go({ page: String(p) })} summary={countOf(t, locale, total, 'tasks')} />}
                empty={empty}
            />

            <ConfirmModal
                isOpen={confirming && !!toPay}
                title={t('mark_all_as_paid')}
                message={wording?.question ?? ''}
                confirmText={wording?.button ?? ''}
                cancelText={t('cancel')}
                onConfirm={handleMarkAllAsPaid}
                onCancel={() => setConfirming(false)}
                variant="warning"
            />
        </Page>
    )
}
