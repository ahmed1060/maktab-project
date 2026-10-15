/**
 * The Employees list's request to GET /api/users. Every filter and the sort
 * go to the server: the list is paged, so anything done in the browser would
 * only apply to the ten people on the page it was sent.
 */
export type EmployeesQuery = {
    page: number
    limit: number
    companyId?: string | null
    /** Seeing only a team, a person doesn't list the company's Admins. */
    teamOnly: boolean
    /** The viewer, who isn't listed among the people they manage. */
    viewerId?: string
    search?: string
    status?: string
    role?: string
    teamLeaderId?: string
    sort?: 'name' | 'role' | 'points'
    order?: 'asc' | 'desc'
}

export function employeesListUrl(q: EmployeesQuery): string {
    const params = new URLSearchParams()
    if (q.companyId) params.set('companyId', q.companyId)
    params.set('page', String(q.page))
    params.set('limit', String(q.limit))
    params.set('excludeRole', q.teamOnly ? 'ADMIN,SUPER_ADMIN' : 'SUPER_ADMIN')
    if (q.viewerId) params.set('excludeUserId', q.viewerId)
    if (q.search) params.set('search', q.search)
    if (q.status) params.set('status', q.status)
    if (q.role) params.set('role', q.role)
    // Filtering rather than grouping, deliberately: a team's members don't
    // fall on one page, so a grouped view would show the same team heading on
    // page one and page three with different people under it.
    if (q.teamLeaderId) params.set('teamLeaderId', q.teamLeaderId)
    if (q.sort) {
        params.set('sort', q.sort)
        params.set('order', q.order ?? 'asc')
    }
    return `/api/users?${params.toString()}`
}
