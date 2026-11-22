import type { Permission } from '@/lib/permissions/catalogue'
import type { Module } from '@/lib/features/bundles'

/** An employee's history's tabs, in the order they're shown. */
export type HistoryTab = 'salary' | 'day-off' | 'costs'

export type HistoryParts = {
    /** Their name, for the page's title. */
    person: boolean
    /** The Salary tab's months. */
    months: boolean
    /** Its bonuses and deductions. */
    adjustments: boolean
    settlements: boolean
    debts: boolean
    dayOff: boolean
    costs: boolean
    tabs: HistoryTab[]
}

/**
 * What an employee's history asks for and shows a viewer
 * (LATER_CHANGES_PLAN.md §5.3, PR 370): each part only when its route
 * answers them, by what the route asks and the module it's in, so nobody is
 * refused and shown a part that didn't load. One's own history is the
 * person, their months, their day off and their costs, holding nothing; the
 * rest is for who holds what it asks, one's own included.
 *
 * The tabs are those parts: Salary for the months, the bonuses, settlements
 * or debts; Day off credit; Costs. The Employees list offers History to who
 * sees any of them on someone else's.
 */
export function historyParts(viewer: { own: boolean; can: (permission: Permission) => boolean; has: (module: Module) => boolean }): HistoryParts {
    const { own, can, has } = viewer
    const parts = {
        person: own || can('employees.view'),
        months: has('PAYROLL') && (own || can('salary.view')),
        adjustments: has('SALARY_ADJUSTMENTS') && can('salary.view'),
        settlements: has('PAYROLL') && can('settlements.manage'),
        debts: has('PAYROLL') && can('debts.view'),
        dayOff: has('DAY_OFF') && (own || can('dayoff.view')),
        costs: has('PAYROLL') && (own || can('costs.view')),
    }
    const tabs: HistoryTab[] = []
    if (parts.months || parts.adjustments || parts.settlements || parts.debts) tabs.push('salary')
    if (parts.dayOff) tabs.push('day-off')
    if (parts.costs) tabs.push('costs')
    return { ...parts, tabs }
}
