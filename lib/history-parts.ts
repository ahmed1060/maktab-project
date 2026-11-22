import type { Permission } from '@/lib/permissions/catalogue'
import type { Target } from '@/lib/permissions/can'
import type { Module } from '@/lib/features/bundles'

/** An employee's history's tabs, in the order they're shown. */
export type HistoryTab = 'salary' | 'day-off' | 'costs'

export type HistoryParts = {
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
 *
 * `can` is what the viewer holds for this person (forPerson below); the
 * person's name, for the title, is the page's: one's own, or See employees.
 */
export function historyParts(viewer: { own: boolean; can: (permission: Permission) => boolean; has: (module: Module) => boolean }): HistoryParts {
    const { own, can, has } = viewer
    const parts = {
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

/**
 * What the viewer holds for this person, as the history's routes check it
 * (Codex on PR 370). Held for the company, a permission reaches anyone in it.
 * Held for a team, it reaches only the people the viewer leads, so it waits
 * until the person is known; only See employees, See salaries and See leave
 * requests can be held for a team. And with See employees held for a team,
 * someone else's history is kept to that team (verifyResourceAccess), debts
 * too, though their route doesn't ask: the safe side.
 */
export function forPerson(
    viewer: { can: (permission: Permission, target?: Target) => boolean; scope: (permission: Permission) => string | null },
    person: Target | null,
): (permission: Permission) => boolean {
    const held = (permission: Permission) => viewer.scope(permission) === 'TEAM' ? !!person && viewer.can(permission, person) : viewer.can(permission)
    const reaches = viewer.scope('employees.view') !== 'TEAM' || held('employees.view')
    return permission => reaches && held(permission)
}
