/**
 * The names-only list a picker that hands work to someone asks
 * (LATER_CHANGES_PLAN.md §5.1 rule 5, PR 371): for its own action's
 * permission, and for a Super Admin the company they picked. What comes back
 * is who the server accepts for that action, so a picker filters nobody.
 */
export type AssigneesFor = 'tasks.create' | 'obligations.create' | 'obligations.edit' | 'tasks.transfer'

export function assigneesUrl(permission: AssigneesFor, companyId?: string | null): string {
    const query = new URLSearchParams({ for: permission })
    if (companyId) query.set('companyId', companyId)
    return `/api/assignees?${query.toString()}`
}
