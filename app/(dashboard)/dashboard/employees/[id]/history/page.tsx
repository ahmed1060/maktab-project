'use client'
import { useState } from 'react'
import useSWR from 'swr'
import { useSession } from 'next-auth/react'
import { fetcher, SWRError } from '@/lib/swr-fetcher'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useLanguage } from '@/context/LanguageContext'
import { useToast } from '@/context/ToastContext'
import { Page, PageHeader, Tabs } from '@/components/ui'
import { useFadingHighlight } from '@/lib/useFadingHighlight'
import { useCan } from '@/lib/useCan'
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
 */

type Tab = 'salary' | 'day-off' | 'costs'
const TABS: Tab[] = ['salary', 'day-off', 'costs']


interface Employee {
    id: string
    firstName: string
    lastName: string
    salary?: number
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
    const { data: session } = useSession()
    const params = useParams()
    const router = useRouter()
    const pathname = usePathname()
    const { can, canFor } = useCan()
    // Each part of the page asks for the permission its route checks.
    const canSeeSalary = can('salary.view')
    // Anyone's pay but their own (ROLES_PLAN.md §4.2, rule 5).
    const canAdjust = canFor('salary_adjustments.manage', params.id as string | undefined)
    const canReevaluateDayOff = can('dayoff.approve')

    // The day off whose days are being reconsidered, from its row on the Day off credit tab.
    const [reconsidering, setReconsidering] = useState<DayOffRequest | null>(null)
    const searchParams = useSearchParams()
    const highlightId = searchParams.get('highlight')
    // The tab is in the address, so a reload or a link opens it; ?highlight= keeps its place beside it.
    const linkedTab = searchParams.get('tab') as Tab | null
    const activeTab: Tab = linkedTab && TABS.includes(linkedTab) ? linkedTab : 'salary'
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
    const id = params.id as string | undefined
    // Only a network failure raises the banner, as before; a refused endpoint
    // just leaves its section empty.
    const onNetworkError = (err: unknown) => {
        if (err instanceof SWRError) return
        console.error('Error fetching data')
        showToast(t('failed_fetch_data'), 'error')
    }
    const quiet = { onError: onNetworkError }
    const employeeQuery = useSWR(id ? `/api/users?id=${id}` : null, fetcher, quiet)
    // Each tab says itself when its list didn't load, with Try again (PR 157, part 2).
    const recordsQuery = useSWR(id ? `/api/users/${id}/salary-history` : null, fetcher)
    const dayOffQuery = useSWR(id ? `/api/users/${id}/day-off-history` : null, fetcher)
    const costsQuery = useSWR(id ? `/api/users/${id}/costs-history` : null, fetcher)
    const unwrap = (r: any) => r ? (r.data || r) : undefined
    const employee: Employee | null = unwrap(employeeQuery.data) ?? null
    const records: SalaryRecord[] = unwrap(recordsQuery.data) ?? NO_RECORDS
    const dayOffHistory: DayOffHistory | null = unwrap(dayOffQuery.data) ?? null
    const userCosts: UserCost[] = unwrap(costsQuery.data) ?? NO_COSTS

    // The only route to an ended contract's statement. The person it is about
    // cannot sign in, so if it is not reachable from their page it is not
    // reachable at all.
    const { data: settlementsResult } = useSWR(can('settlements.manage') && id ? `/api/users/${id}/settlements` : null, fetcher)
    const settlements: Settlement[] = settlementsResult?.data || NO_ROWS
    // E2: raised when, recovered from which months, settled or written off by
    // whom. Every one of those was recorded and none of them was assembled.
    const { data: debtsResult } = useSWR(can('debts.view') && id ? `/api/users/${id}/debts` : null, fetcher)
    const debts: Debt[] = debtsResult?.data || NO_ROWS

    // The bonuses and deductions behind the months, on the Salary tab for who
    // can see salary, as their route asks (part 3). They were a window of
    // their own, opened from the header or by ?highlight=.
    const adjustmentsQuery = useSWR(canSeeSalary && id && activeTab === 'salary' ? `/api/users/${id}/adjustments` : null, fetcher)
    const adjustments: SalaryAdjustment[] = unwrap(adjustmentsQuery.data) ?? NO_ADJUSTMENTS

    // Someone else's history goes back to Employees; one's own, opened from the account menu, has nowhere to go back to.
    const own = session?.user?.id === id
    const name = employee ? `${employee.firstName} ${employee.lastName}`.trim() : ''
    const tabLabel: Record<Tab, string> = {
        salary: canSeeSalary ? t('salary_label') : t('history'),
        'day-off': t('hist_tab_day_off'),
        costs: t('costs_tab'),
    }

    return (
        <Page>
            <PageHeader
                back={own ? undefined : { href: '/dashboard/employees', label: t('employees') }}
                title={name ? <bdi>{name}</bdi> : t('history')}
                subtitle={name ? t('history') : undefined}
            />
            <Tabs label={t('history')} idPrefix="history-tab" value={activeTab} onChange={setTab}
                items={TABS.map(k => ({ value: k, label: tabLabel[k], controls: 'history-panel' }))} />
            <div role="tabpanel" id="history-panel" className="ui-tab-panel" aria-labelledby={`history-tab-${activeTab}`}>
            {activeTab === 'salary' ? (
                <SalaryTab
                    employee={employee}
                    records={records}
                    loading={recordsQuery.isLoading}
                    error={recordsQuery.error}
                    retrying={recordsQuery.isValidating}
                    retry={() => { void recordsQuery.mutate() }}
                    adjustments={canSeeSalary && id ? (
                        <Adjustments
                            userId={id}
                            adjustments={adjustments}
                            loading={adjustmentsQuery.isLoading}
                            error={adjustmentsQuery.error}
                            retrying={adjustmentsQuery.isValidating}
                            retry={() => { void adjustmentsQuery.mutate() }}
                            canUndo={canAdjust}
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
