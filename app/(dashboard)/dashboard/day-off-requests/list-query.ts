/**
 * The day-off list's request. A manager asks for the company's (or team's)
 * requests and may pick an employee; everyone else asks for their own. Every
 * filter goes to the server: the list is paged, so a filter done in the
 * browser would only apply to the ten requests on the page it was sent.
 */
export type DayOffQuery = {
    manages: boolean
    page: number
    limit: number
    companyId?: string | null
    status?: string
    employeeId?: string
    /** Calendar days, YYYY-MM-DD. */
    from?: string
    to?: string
    search?: string
}

export function dayOffListUrl(q: DayOffQuery): string {
    const params = new URLSearchParams()
    if (q.manages && q.companyId) params.set('companyId', q.companyId)
    params.set('page', String(q.page))
    params.set('limit', String(q.limit))
    if (q.status) params.set('status', q.status)
    if (q.manages && q.employeeId) params.set('userId', q.employeeId)
    if (q.from) params.set('from', q.from)
    if (q.to) params.set('to', q.to)
    if (q.search?.trim()) params.set('search', q.search.trim())
    return `${q.manages ? '/api/admin/day-off-requests' : '/api/day-off-requests'}?${params.toString()}`
}
