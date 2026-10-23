import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createObligationSchema } from "@/lib/validations/obligation.schema"
import { ObligationService } from "@/lib/services/obligation.service"
import { assignedToTeamWhere, and } from "@/lib/team-scope"
import { grantFor } from "@/lib/permissions/can"
import { parsePaging } from "@/lib/pagination"
import { dayRangeIn } from "@/lib/services/filter-zone"

export const GET = withStandardHandler(async (req, session) => {
    const userId = (session.user as any).id
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')

    const whereClause: any = {}

    // 1. Authorization & Base Filtering — by how far obligations.view reaches:
    // everywhere (Super Admin), the company, the team, or one's own.
    const reach = grantFor(session.user, "obligations.view")
    if (reach === 'ALL') {
        if (companyId) whereClause.companyId = companyId
    } else if (reach === 'COMPANY') {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
        whereClause.companyId = userCompanyId
    } else if (reach === 'TEAM') {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
        whereClause.companyId = userCompanyId
        and(whereClause, assignedToTeamWhere(userId))
    } else {
        // `and` here too, though nothing follows it that could overwrite this
        // one today. The rule is uniform — no branch assigns to .assignees —
        // because "this particular assignment is safe, the one below is not"
        // is precisely the reasoning that let F-03 survive a fix.
        and(whereClause, { assignees: { some: { id: userId } } })
    }

    // 2. Extra Filters
    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (employeeIdFilter && reach !== null) {
        // `and`, not assignment: the scope above sets whereClause.assignees
        // for a team leader, and replacing it would let them read another
        // team's obligations by supplying an id.
        and(whereClause, { assignees: { some: { id: employeeIdFilter } } })
    }

    if (statusFilter) whereClause.status = statusFilter

    if (searchFilter) {
        whereClause.AND = whereClause.AND || []
        whereClause.AND.push({
            OR: [
                { title: { contains: searchFilter, mode: 'insensitive' } },
                { description: { contains: searchFilter, mode: 'insensitive' } }
            ]
        })
    }

    // Days where the company is, not on the server's clock: one's own, or the
    // one a Super Admin picks. An employee who sees only their own
    // obligations has no company in the search, but they still have one.
    const updatedAt = await dayRangeIn(dateFrom, dateTo, (session.user as any).companyId ?? whereClause.companyId)
    if (updatedAt) whereClause.updatedAt = updatedAt

    const { page, limit, skip } = parsePaging(searchParams, 10)

    const [obligations, total] = await Promise.all([
        prisma.obligation.findMany({
            where: whereClause,
            include: { assignees: { select: { firstName: true, lastName: true } } },
            orderBy: { deadline: 'asc' },
            skip,
            take: limit
        }),
        prisma.obligation.count({ where: whereClause })
    ])

    return ApiResponse.success({
        data: obligations,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = createObligationSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await ObligationService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        // 3. Error Mapping
        if (error.message === 'EMPLOYEES_CANNOT_CREATE_OBLIGATIONS') return ApiResponse.forbidden("Employees cannot create obligations")
        if (error.message === 'USER_NO_COMPANY') return ApiResponse.forbidden("You must be part of a company to create obligations")
        if (error.message === 'ASSIGNEE_NOT_FOUND') return ApiResponse.notFound("One or more assignees not found")
        if (error.message === 'CROSS_COMPANY_ASSIGNMENT_FORBIDDEN') return ApiResponse.forbidden("Cannot assign obligations across companies")
        if (error.message === 'TEAM_LEADER_CANNOT_ASSIGN_TO_ADMIN') return ApiResponse.forbidden("Team Leaders cannot assign obligations to Admins")
        if (error.message === 'TEAM_LEADER_CANNOT_ASSIGN_OUTSIDE_TEAM') return ApiResponse.forbidden("Team Leaders can only assign obligations to their own team")

        throw error
    }
})
