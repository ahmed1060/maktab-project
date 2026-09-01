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
    } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        const userCompanyId = session.user.companyId
        if (!userCompanyId) return { empty: true }
        scope.push({ companyId: userCompanyId })
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
    // employee is already scoped to their own tasks by `scope` above.
    if (employeeIdFilter && userRole !== 'EMPLOYEE') {
        filters.push({ assignees: { some: { id: employeeIdFilter } } })
    }
    if (statusFilter) filters.push({ status: statusFilter })

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
