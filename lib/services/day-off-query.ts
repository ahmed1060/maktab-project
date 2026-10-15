/**
 * The filters on a day-off list (GET /api/day-off-requests and
 * GET /api/admin/day-off-requests): status, the employee, the dates and words
 * in the reason.
 *
 * They're the server's because the lists are paged. The screen used to filter
 * the ten requests it had been sent, so "Pending" showed page one's pending
 * requests, the count still said every request, and the pages went on through
 * requests the filter had hidden.
 *
 * The result only narrows: each route keeps its own scope (whose requests the
 * caller may see) and adds this beside it.
 */

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
const DAY = /^\d{4}-\d{2}-\d{2}$/

export function dayOffListFilters(searchParams: URLSearchParams): Record<string, any>[] {
    const out: Record<string, any>[] = []

    const status = searchParams.get('status')
    if (status) {
        // A status that doesn't exist matches nothing, rather than being
        // dropped and showing every request under a filter that says otherwise.
        out.push((STATUSES as readonly string[]).includes(status) ? { status } : { id: '__no_match__' })
    }

    const userId = searchParams.get('userId')
    if (userId) out.push({ userId })

    // A request is in the range when the day it starts is, as the screen
    // always counted it. Days are calendar days, as the request form sends them.
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const date: Record<string, Date> = {}
    if (from && DAY.test(from)) date.gte = new Date(`${from}T00:00:00.000Z`)
    if (to && DAY.test(to)) {
        const end = new Date(`${to}T00:00:00.000Z`)
        end.setUTCDate(end.getUTCDate() + 1)
        date.lt = end
    }
    if (date.gte || date.lt) out.push({ date })

    const search = searchParams.get('search')?.trim()
    if (search) out.push({ reason: { contains: search, mode: 'insensitive' } })

    return out
}
