import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createTaskSchema } from "@/lib/validations/task.schema"
import { TaskService } from "@/lib/services/task.service"

export const GET = withStandardHandler(async (req, session) => {
    const userRole = (session.user as any).role
    const userId = (session.user as any).id
    const { searchParams } = new URL(req.url)

    let companyId = searchParams.get('companyId')
    const companyName = searchParams.get('company')

    if (!companyId && companyName) {
        const comp = await prisma.company.findUnique({ where: { name: companyName } })
        if (comp) companyId = comp.id
    }

    const whereClause: any = {}

    // 1. GET Logic Hardening
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) {
            whereClause.companyId = companyId
        }
    } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) {
            return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
        }
        whereClause.companyId = userCompanyId
    } else {
        whereClause.assignees = { some: { id: userId } }
    }

    // Filters
    const employeeIdFilter = searchParams.get('employeeId')
    const statusFilter = searchParams.get('status')
    const searchFilter = searchParams.get('search')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    if (employeeIdFilter) whereClause.assignees = { some: { id: employeeIdFilter } }
    if (statusFilter) whereClause.status = statusFilter

    if (searchFilter) {
        const searchOR = {
            OR: [
                { title: { contains: searchFilter, mode: 'insensitive' } },
                { description: { contains: searchFilter, mode: 'insensitive' } }
            ]
        }
        if (whereClause.OR) {
            whereClause.AND = whereClause.AND || []
            whereClause.AND.push({ OR: whereClause.OR })
            delete whereClause.OR
            whereClause.AND.push(searchOR)
        } else {
            whereClause.AND = whereClause.AND || []
            whereClause.AND.push(searchOR)
        }
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

    const [tasks, total] = await Promise.all([
        prisma.task.findMany({
            where: whereClause,
            include: {
                assignees: { select: { id: true, firstName: true, lastName: true, email: true } },
                creator: { select: { firstName: true, lastName: true } }
            },
            orderBy: { deadline: 'asc' },
            skip,
            take: limit
        }),
        (prisma.task as any).count({ where: whereClause })
    ])

    return ApiResponse.success({
        data: tasks,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Zod Validation
    const validation = createTaskSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Delegate to Service
        const result = await TaskService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        // 3. Error Mapping
        if (error.message === 'DEADLINE_IN_PAST') return ApiResponse.badRequest("Deadline cannot be in the past")
        if (error.message === 'CROSS_COMPANY_ASSIGNMENT_FORBIDDEN') return ApiResponse.forbidden("Cannot assign task to user in a different company")
        if (error.message === 'TL_CANNOT_ASSIGN_TO_ADMIN') return ApiResponse.forbidden("Team Leaders cannot assign tasks to Admins or Super Admins")
        if (error.message === 'ASSIGNEE_NOT_FOUND') return ApiResponse.notFound("One or more assignees not found")

        throw error // bubble up to withStandardHandler for 500
    }
}, {
    audit: {
        action: 'CREATE_TASK',
        entityType: 'TASK',
        getEntityId: (res) => res.id
    }
})
