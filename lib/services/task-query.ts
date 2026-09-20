import { isValidTaskStatus } from "@/lib/valid-enums"
import { scopesToTeam, assignedToTeamWhere } from "@/lib/team-scope"

export type TaskQuerySession = {
    user: {
        id: string
        role: string
        companyId?: string | null
    }
}

export type TaskWhereResult =
    | { empty: true }
    | { empty: false; whereClause: { AND: any[] } }

/**
 * Builds the Prisma `where` clause for GET /api/tasks.
 *
 * Pulled out of the route handler so the tenancy fix (F-03) is directly
 * unit-testable without a database: an employee reading `?employeeId=<any>`
 * must never see another employee's tasks, and a company admin must never
 * see another company's, regardless of what filters are supplied.
 *
 * The scope (tenancy/role) is built as its own AND branch, entirely
 * separate from the additive `filters` branch, so no query param can ever
 * replace it. F-03 was exactly this: `employeeIdFilter` used to overwrite
 * the field that scoped an employee to their own tasks.
 */
export function buildTaskWhereClause(
    session: TaskQuerySession,
    searchParams: URLSearchParams,
    companyId: string | null
): TaskWhereResult {
    const userRole = session.user.role
    const userId = session.user.id

    const scope: any[] = []
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) scope.push({ companyId })
    } else if (userRole === 'ADMIN') {
        const userCompanyId = session.user.companyId
        if (!userCompanyId) return { empty: true }
        scope.push({ companyId: userCompanyId })
    } else if (scopesToTeam(userRole)) {
        // A Team Leader used to share the ADMIN branch, which meant the whole
        // company. Now it is their team and themselves — and the company stays
        // on top of it, because a leader with reports somehow in another
        // company must still not reach across.
        const userCompanyId = session.user.companyId
        if (!userCompanyId) return { empty: true }
        scope.push({ companyId: userCompanyId })
        scope.push(assignedToTeamWhere(userId))
    } else {
        scope.push({ assignees: { some: { id: userId } } })
    }

    const filters: any[] = []

    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    // Only a privileged role may narrow to an arbitrary employee — a plain
    // employee is already scoped to their own tasks by `scope` above. For a
    // Team Leader this narrows within their team and cannot escape it: the
    // filter is pushed alongside the scope, never over it, so asking for
    // somebody else's team intersects to nothing.
    if (employeeIdFilter && userRole !== 'EMPLOYEE') {
        filters.push({ assignees: { some: { id: employeeIdFilter } } })
    }
    if (statusFilter) {
        // F-13: Task.status is a Postgres enum now — an invalid value would
        // make Postgres reject the whole query instead of the harmless
        // zero-match a plain String column gave. Preserve that zero-match.
        filters.push(isValidTaskStatus(statusFilter) ? { status: statusFilter } : { id: '__no_match__' })
    }

    if (searchFilter) {
        filters.push({
            OR: [
                { title: { contains: searchFilter, mode: 'insensitive' } },
                { description: { contains: searchFilter, mode: 'insensitive' } }
            ]
        })
    }

    if (dateFrom || dateTo) {
        const updatedAt: any = {}
        if (dateFrom) updatedAt.gte = new Date(dateFrom)
        if (dateTo) {
            const end = new Date(dateTo)
            end.setHours(23, 59, 59, 999)
            updatedAt.lte = end
        }
        filters.push({ updatedAt })
    }

    return { empty: false, whereClause: { AND: [...scope, ...filters] } }
}
