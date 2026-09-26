import { scopesToTeam, teamMemberWhere, and } from "@/lib/team-scope"
import type { UserRole, UserStatus } from "@prisma/client"

/**
 * Builds the Prisma `where` clause for GET /api/users.
 *
 * Pulled out of the route handler for the reason buildTaskWhereClause was:
 * this decides a permission boundary — a Team Leader sees their own team and
 * themselves, minus Admins — and while it lived inline it could not be
 * exercised without a database, so it had no test that could fail.
 *
 * That is not a hypothetical. A guard was written against the route's source,
 * searching the scoping block for 'ADMIN', and it passed with the conditional
 * around that line disabled: the string was still sitting there in dead code.
 * It was deleted rather than shipped, and this extraction is what replaces it.
 *
 * The composition rule is the same as everywhere else in this codebase: every
 * condition is added, never assigned over. Where a key is refined more than
 * once — `role` collects an exclusion, then the team rule's, then a positive
 * filter — the refinements are spread into the same object so they intersect
 * rather than replace. F-03 was a filter replacing a scope, and it survived
 * its own fix in a second copy of the logic.
 */

export type UserQuerySession = {
    user: {
        id: string
        role: string
        companyId?: string | null
    }
}

export type UserWhereResult =
    | { empty: true }
    | { empty: false; whereClause: Record<string, any> }

export function buildUserWhereClause(
    session: UserQuerySession,
    searchParams: URLSearchParams,
    filterCompanyId: string | undefined,
    validRoles: readonly string[],
    validStatuses: readonly string[],
): UserWhereResult {
    const userRole = session.user.role
    const whereClause: any = { role: { not: 'SUPER_ADMIN' } }

    // 1. Tenancy.
    if (userRole === 'SUPER_ADMIN') {
        if (filterCompanyId) whereClause.companyId = filterCompanyId
    } else {
        const userCompanyId = session.user.companyId
        // Rather than falling through to a query with no company at all, which
        // would list every user on the platform.
        if (!userCompanyId) return { empty: true }
        whereClause.companyId = userCompanyId
    }

    const excludeRole = searchParams.get('excludeRole')
    if (excludeRole) {
        const rolesToExclude = excludeRole.split(',').filter(r => validRoles.includes(r))
        if (rolesToExclude.length > 0) {
            whereClause.role = { ...(whereClause.role || {}), notIn: rolesToExclude }
        }
    }

    // 2. The team boundary.
    if (scopesToTeam(session.user, "employees.view")) {
        const currentExclude = whereClause.role?.notIn || (whereClause.role?.not ? [whereClause.role.not] : [])
        if (!currentExclude.includes('ADMIN')) {
            whereClause.role = { ...(whereClause.role || {}), notIn: [...currentExclude, 'ADMIN'] }
        }
        // Their team, and themselves. Added with `and` rather than assigned to
        // whereClause.OR, which the search filter below already uses — two
        // plain assignments to the same key means whichever runs last wins,
        // and the one that must always win is the scope.
        and(whereClause, teamMemberWhere(session.user.id))
    }

    // 3. Filters. Each narrows what is left; none can widen it.

    // "unassigned" is a real answer, not the absence of a filter — it is the
    // bucket an Admin has to clear, and it has to be reachable or it stays
    // invisible.
    const teamParam = searchParams.get('teamLeaderId')
    if (teamParam === 'unassigned') {
        whereClause.teamLeaderId = null
    } else if (teamParam) {
        whereClause.teamLeaderId = teamParam
    }

    // A positive role filter, so a screen that wants only team leaders asks
    // for them instead of pulling every user and filtering in the browser. It
    // narrows and never widens: the exclusions above stay in the same field
    // object, so role=SUPER_ADMIN still matches nothing.
    const roleParam = searchParams.get('role')
    if (roleParam && validRoles.includes(roleParam)) {
        whereClause.role = { ...(whereClause.role || {}), equals: roleParam }
    }

    const excludeUserId = searchParams.get('excludeUserId')
    if (excludeUserId) whereClause.id = { not: excludeUserId }

    const searchParam = searchParams.get('search')
    if (searchParam) {
        whereClause.OR = [
            { id: { contains: searchParam, mode: 'insensitive' } },
            { firstName: { contains: searchParam, mode: 'insensitive' } },
            { lastName: { contains: searchParam, mode: 'insensitive' } },
            { email: { contains: searchParam, mode: 'insensitive' } },
            { company: { name: { contains: searchParam, mode: 'insensitive' } } }
        ]
    }

    const statusParam = searchParams.get('status')
    const includeDeleted = searchParams.get('includeDeleted') === 'true'
    if (statusParam) {
        if (validStatuses.includes(statusParam)) {
            whereClause.status = statusParam
        } else {
            // Not a real status — preserve the old String-column behaviour (a
            // filter that matches nothing) instead of letting an invalid enum
            // value reject the whole query, or silently falling through to "no
            // status filter at all".
            and(whereClause, { id: '__no_match__' })
        }
    } else if (!includeDeleted) {
        and(whereClause, { status: { not: 'DELETED' } })
    }

    return { empty: false, whereClause }
}

/** Re-exported so the route's enum lists stay the single source. */
export type { UserRole, UserStatus }
