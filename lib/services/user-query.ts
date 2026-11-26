import { scopesToTeam, teamMemberWhere, and } from "@/lib/team-scope"
import { presenceWhere } from "@/lib/presence"
import { notOwnerNow } from "@/lib/owners"
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
    // When "lately" is, for the Online and Offline filters; the tests pin it.
    now: Date = new Date(),
    // Who has a name missing a language, as the database finds them
    // (lib/names/missing.ts), for names=missing (PR 405): none found, none listed.
    missingNameIds?: readonly string[],
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
            // Each name in either language (LATER_CHANGES_PLAN.md §3.1, step 5, PR 405).
            { firstName: { contains: searchParam, mode: 'insensitive' } },
            { firstNameAr: { contains: searchParam, mode: 'insensitive' } },
            { lastName: { contains: searchParam, mode: 'insensitive' } },
            { lastNameAr: { contains: searchParam, mode: 'insensitive' } },
            { email: { contains: searchParam, mode: 'insensitive' } },
            { company: { name: { contains: searchParam, mode: 'insensitive' } } },
            // A company by either language too (PR 411).
            { company: { nameAr: { contains: searchParam, mode: 'insensitive' } } }
        ]
    }

    // The names still missing a language (PR 405), added to the rest, never over it.
    if (searchParams.get('names') === 'missing') and(whereClause, { id: { in: [...(missingNameIds ?? [])] } })

    // The owners now, for the Owners list, or everyone but them, for the
    // Employees list, which they leave (LATER_CHANGES_PLAN.md §7.3, step 3c,
    // PR 429). Added, never over: it narrows.
    const owners = searchParams.get('owners')
    if (owners === 'only') and(whereClause, { ownerPeriods: { some: { endsAt: null } } })
    else if (owners === 'leave') and(whereClause, notOwnerNow())

    const statusParam = searchParams.get('status')
    const includeDeleted = searchParams.get('includeDeleted') === 'true'
    if (statusParam) {
        if (statusParam === 'ACTIVE' || statusParam === 'OFFLINE') {
            // Online and Offline ask what the list shows, not only what's
            // stored: someone signed in and not seen lately is offline
            // (lib/presence.ts).
            and(whereClause, presenceWhere(statusParam, now))
        } else if (validStatuses.includes(statusParam)) {
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

/**
 * The order for GET /api/users: `sort` is name, role or points, and `order`
 * is asc or desc. Anything else gets the list's usual order, company then
 * first name.
 *
 * The sort has to be the server's. The Employees screen used to sort the ten
 * people on the page it had been sent, so "most points first" put the top
 * scorer of page one first, and the top scorer overall could be on page three.
 * Role sorts in the order the roles are declared: Admins, then Team Leaders,
 * then employees. A tie falls back to the name, so pages don't swap people
 * between requests.
 */
export function buildUserOrderBy(searchParams: URLSearchParams): Record<string, any>[] {
    const order = searchParams.get('order') === 'desc' ? 'desc' : 'asc'
    // By the name shown, in the page's language (PR 405): on an Arabic page
    // the names it has in Arabic first, then the rest in English.
    const inArabic = searchParams.get('lang') === 'ar'
        ? [{ firstNameAr: { sort: order, nulls: 'last' } }, { lastNameAr: { sort: order, nulls: 'last' } }]
        : []
    const byName = [...inArabic, { firstName: order }, { lastName: order }, { id: 'asc' }]
    switch (searchParams.get('sort')) {
        case 'name': return byName
        case 'role': return [{ role: order }, { firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }]
        case 'points': return [{ totalDifficultyPoints: order }, { firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }]
        default: return [{ company: { name: 'asc' } }, { firstName: 'asc' }]
    }
}

/**
 * What the counts are asked over: the list's own question without its
 * search, the status it shows or its page, so they're of everyone at work in
 * the company picked, on every page (PR 384).
 */
export function countedParams(searchParams: URLSearchParams): URLSearchParams {
    const counted = new URLSearchParams(searchParams)
    for (const key of ["search", "status", "includeDeleted", "page", "limit", "counts"]) counted.delete(key)
    return counted
}

/**
 * What the names missing a language are counted over (PR 405): everyone the
 * list is for, in the company picked and as far as the viewer sees, whatever
 * it's searched for, filtered by, sorted by or on.
 */
export function namesCountedParams(searchParams: URLSearchParams): URLSearchParams {
    const counted = new URLSearchParams()
    // And whether owners are who it's for, or left out of it (PR 429).
    for (const key of ["companyId", "excludeRole", "excludeUserId", "owners"]) {
        const value = searchParams.get(key)
        if (value !== null) counted.set(key, value)
    }
    return counted
}
