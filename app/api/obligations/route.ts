import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createObligationSchema } from "@/lib/validations/obligation.schema"
import { ObligationService } from "@/lib/services/obligation.service"

export const GET = withStandardHandler(async (req, session) => {
    const role = (session.user as any).role
    const userId = (session.user as any).id
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')

    const whereClause: any = {}

    // 1. Authorization & Base Filtering
    if (role === 'SUPER_ADMIN') {
        if (companyId) whereClause.companyId = companyId
    } else if (['ADMIN', 'TEAM_LEADER'].includes(role)) {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
        whereClause.companyId = userCompanyId
    } else {
        whereClause.assignees = { some: { id: userId } }
    }

    // 2. Extra Filters
    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (employeeIdFilter && role !== 'EMPLOYEE') {
        whereClause.assignees = { some: { id: employeeIdFilter } }
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

    if (dateFrom || dateTo) {
        whereClause.updatedAt = {}
        if (dateFrom) whereClause.updatedAt.gte = new Date(dateFrom)
        if (dateTo) {
            const end = new Date(dateTo)
            end.setHours(23, 59, 59, 999)
            whereClause.updatedAt.lte = end
        }
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

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

        throw error
    }
})
