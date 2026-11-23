'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { EmptyState, Page, PageHeader, Tabs } from '@/components/ui'
import { HourglassIcon } from '@phosphor-icons/react/ssr'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useCan, useViewer } from '@/lib/useCan'
import { useFeatures } from '@/lib/features/useFeatures'
import { forPerson, historyParts, type HistoryTab } from '@/lib/history-parts'
import AccessDenied from '@/components/AccessDenied'
import { SalaryTab, type Debt, type SalaryRecord, type Settlement } from './SalaryTab'
import { DayOffTab, ReconsiderDayOff, type DayOffHistory, type DayOffRequest } from './DayOffTab'
import { CostsTab, type UserCost } from './CostsTab'
import { Adjustments, type SalaryAdjustment } from './Adjustments'

/**
 * An employee's history: their salary by month, their day off credit and
 * their costs, and the bonuses and deductions behind them. Also each
 * person's own history, from the account menu.
 *
 * On the building blocks in parts (UI_PLAN.md §5 step 5). Part 1, PR 157:
 * the page header with the person's name, the tabs, kept in the address,
 * and the Salary tab (./SalaryTab.tsx). Part 2: the Day off credit tab, with
 * Reconsider on each day off taken from the credit (./DayOffTab.tsx), and
 * the Costs tab (./CostsTab.tsx). Part 3: the bonuses and deductions, a
 * section of the Salary tab with Reverse and Roll back on each (./Adjustments.tsx).
 *
 * Each part is asked for only when its route answers the viewer, and the tabs
 * are those parts (lib/history-parts.ts, PR 370): it asked for all of them
 * whatever the viewer held, and showed tabs that said they didn't load.
 */

type Tab = HistoryTab


interface Employee {
    id: string
    firstName: string
    lastName: string
    salary?: number
    companyId?: string | null
    teamLeaderId?: string | null
}

// One empty list per kind, so an effect depending on a list does not re-run
// just because a fresh [] was made on a render with no data yet.
const NO_RECORDS: SalaryRecord[] = []
const NO_COSTS: UserCost[] = []
const NO_ADJUSTMENTS: SalaryAdjustment[] = []
const NO_ROWS: never[] = []

export default function EmployeeHistoryPage() {
    const { t } = useLanguage()
    const { showToast } = useToast()
    const viewer = useViewer()
    const params = useParams()
    const router = useRouter()
    const pathname = usePathname()
    const { can, canFor, scope } = useCan()
    const features = useFeatures()
    const id = params.id as string | undefined
    // Someone else's history goes back to Employees; one's own, opened from the account menu, has nowhere to go back to.
    const own = !!viewer && viewer.id === id

    // Only a network failure raises the banner, as before; a refused endpoint
    // just leaves its section empty.
    const onNetworkError = (err: unknown) => {
        if (err instanceof SWRError) return
        console.error('Error fetching data')
        showToast(t('failed_fetch_data'), 'error')
    }
    const quiet = { onError: onNetworkError }
    // The person: their name, for the title, and who leads them, for what's
    // held for a team (Codex on PR 370).
    const seesPerson = own || can('employees.view')
    const employeeQuery = useSWR(seesPerson && id ? `/api/users?id=${id}` : null, fetcher, quiet)
    const unwrap = (r: any) => r ? (r.data || r) : undefined
    const employee: Employee | null = unwrap(employeeQuery.data) ?? null
    const person = employee ? { userId: employee.id, teamLeaderId: employee.teamLeaderId ?? null, companyId: employee.companyId ?? null } : null
    // Looked up, or refused or not there: what's held for a team waits for,
    // or is kept from, them. Not looked up, or the look-up failed otherwise,
    // their routes decide (Codex on PR 370).
    const lookup = employeeQuery.error as SWRError | undefined
    const lookedUp = seesPerson && (!lookup || lookup.status === 403 || lookup.status === 404)
    // Each part of the page, and its tab, only for who its route answers.
    const parts = historyParts({ own, can: forPerson({ can, scope }, person, lookedUp), has: features.has })
    const canSeeSalary = can('salary.view')
    // Anyone's pay but their own (ROLES_PLAN.md §4.2, rule 5).
    // Reverse and Roll back, with undoing one (split, PR 382).
    const canUndo = canFor('salary_adjustments.reverse', params.id as string | undefined)
    const canReevaluateDayOff = can('dayoff.approve')

    // The day off whose days are being reconsidered, from its row on the Day off credit tab.
    const [reconsidering, setReconsidering] = useState<DayOffRequest | null>(null)
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    // The tab is in the address, so a reload or a link opens it; ?highlight= keeps its place beside it.
    const linkedTab = searchParams.get('tab') as Tab | null
    const activeTab: Tab = linkedTab && parts.tabs.includes(linkedTab) ? linkedTab : parts.tabs[0] ?? 'salary'
    const setTab = (next: Tab) => {
        const q = new URLSearchParams(searchParams.toString())
        q.set('tab', next)
        router.replace(`${pathname}?${q.toString()}`, { scroll: false })
    }
    // The bonus or deduction a notification opened (?highlight=), marked for
    // six seconds. See lib/useFadingHighlight.ts for why this is not an effect any more.
    const visualHighlightId = useFadingHighlight(highlightId, 6000)

    // Each part of the page is its own SWR key: they load together, one
    // failing does not stop the others, and refreshing one after an action
    // is mutate() on that key rather than a hand-written re-fetch.
    // Each tab says itself when its list didn't load, with Try again (PR 157, part 2).
    const recordsQuery = useSWR(parts.months && id ? `/api/users/${id}/salary-history` : null, fetcher)
    const dayOffQuery = useSWR(parts.dayOff && id ? `/api/users/${id}/day-off-history` : null, fetcher)
    const costsQuery = useSWR(parts.costs && id ? `/api/users/${id}/costs-history` : null, fetcher)
    const records: SalaryRecord[] = unwrap(recordsQuery.data) ?? NO_RECORDS
    const dayOffHistory: DayOffHistory | null = unwrap(dayOffQuery.data) ?? null
    const userCosts: UserCost[] = unwrap(costsQuery.data) ?? NO_COSTS

    // The only route to an ended contract's statement. The person it is about
    // cannot sign in, so if it is not reachable from their page it is not
    // reachable at all.
    const settlementsQuery = useSWR(parts.settlements && id ? `/api/users/${id}/settlements` : null, fetcher)
    const settlements: Settlement[] = settlementsQuery.data?.data || NO_ROWS
    // E2: raised when, recovered from which months, settled or written off by
    // whom. Every one of those was recorded and none of them was assembled.
    const debtsQuery = useSWR(parts.debts && id ? `/api/users/${id}/debts` : null, fetcher)
    const debts: Debt[] = debtsQuery.data?.data || NO_ROWS

    // The bonuses and deductions behind the months, on the Salary tab for who
    // can see salary, as their route asks (part 3). They were a window of
    // their own, opened from the header or by ?highlight=.
    const adjustmentsQuery = useSWR(parts.adjustments && id && activeTab === 'salary' ? `/api/users/${id}/adjustments` : null, fetcher)
    const adjustments: SalaryAdjustment[] = unwrap(adjustmentsQuery.data) ?? NO_ADJUSTMENTS
    // The Salary tab's lists: its months, or without them its settlements and
    // debts, which it waits for, and says when they didn't load (Codex on PR 370).
    const salaryLists = parts.months ? [recordsQuery] : [settlementsQuery, debtsQuery]

    const name = employee ? `${employee.firstName} ${employee.lastName}`.trim() : ''
    const tabLabel: Record<Tab, string> = {
        salary: canSeeSalary ? t('salary_label') : t('history'),
        'day-off': t('hist_tab_day_off'),
        costs: t('costs_tab'),
    }

    if (parts.tabs.length === 0) {
        // Someone else's, what's held for a team waits for who they are.
        if (employeeQuery.isLoading) return <Page><div className="ui-panel" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div></Page>
        // Someone else's history with no part this viewer may see.
        if (viewer) return <AccessDenied />
    }

    return (
        <Page>
            <PageHeader
                back={own ? undefined : { href: '/dashboard/employees', label: t('employees') }}
                title={name ? <bdi>{name}</bdi> : t('history')}
                subtitle={name ? t('history') : undefined}
            />
            <Tabs label={t('history')} idPrefix="history-tab" value={activeTab} onChange={setTab}
                items={parts.tabs.map(k => ({ value: k, label: tabLabel[k], controls: 'history-panel' }))} />
            <div role="tabpanel" id="history-panel" className="ui-tab-panel" aria-labelledby={`history-tab-${activeTab}`}>
            {activeTab === 'salary' ? (
                <SalaryTab
                    employee={employee}
                    records={records}
                    months={parts.months}
                    loading={salaryLists.some(q => q.isLoading)}
                    error={salaryLists.find(q => q.error)?.error}
                    retrying={salaryLists.some(q => q.isValidating)}
                    retry={() => { for (const q of salaryLists) void q.mutate() }}
                    adjustments={parts.adjustments && id ? (
                        <Adjustments
                            userId={id}
                            adjustments={adjustments}
                            loading={adjustmentsQuery.isLoading}
                            error={adjustmentsQuery.error}
                            retrying={adjustmentsQuery.isValidating}
                            retry={() => { void adjustmentsQuery.mutate() }}
                            canUndo={canUndo}
                            highlighted={visualHighlightId}
                            scrollTo={highlightId}
                            // An undone one moves its month's figures too. Through the
                            // same key as the first load, so it is unwrapped the same
                            // way; the hand-written re-fetch this replaced stored the
                            // whole { success, data } envelope.
                            onUndone={() => { void adjustmentsQuery.mutate(); void recordsQuery.mutate() }}
                        />
                    ) : undefined}
                    settlements={settlements}
                    debts={debts}
                />
            ) : activeTab === 'costs' ? (
                <CostsTab
                    costs={userCosts}
                    loading={costsQuery.isLoading}
                    error={costsQuery.error}
                    retrying={costsQuery.isValidating}
                    retry={() => { void costsQuery.mutate() }}
                />
            ) : (
                <DayOffTab
                    history={dayOffHistory}
                    loading={dayOffQuery.isLoading}
                    error={dayOffQuery.error}
                    retrying={dayOffQuery.isValidating}
                    retry={() => { void dayOffQuery.mutate() }}
                    canReconsider={canReevaluateDayOff}
                    onReconsider={setReconsidering}
                />
            )}
            </div>

            <ReconsiderDayOff
                request={reconsidering}
                onClose={() => setReconsidering(null)}
                onDone={() => { setReconsidering(null); void dayOffQuery.mutate() }}
            />
        </Page>
    )
}
