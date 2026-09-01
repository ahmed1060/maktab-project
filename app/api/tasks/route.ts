import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createTaskSchema } from "@/lib/validations/task.schema"
import { TaskService } from "@/lib/services/task.service"
import { parsePaging } from "@/lib/pagination"

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

    // 1. Tenancy/role scope. This is a non-negotiable base: it goes into its
    // own AND branch below so a later query-param filter can only narrow it,
    // never replace it (F-03: `employeeIdFilter` used to overwrite this
    // exact field, letting any employee read any other employee's tasks).
    const scope: any[] = []
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) {
            scope.push({ companyId })
        }
    } else if (['ADMIN', 'TEAM_LEADER'].includes(userRole)) {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId) {
            return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
        }
        scope.push({ companyId: userCompanyId })
    } else {
        scope.push({ assignees: { some: { id: userId } } })
    }

    // 2. Filters — additive only. Each pushes onto `filters`, never assigns
    // straight onto `whereClause`, so none of them can clobber the scope above.
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

    const whereClause = { AND: [...scope, ...filters] }

    const { page, limit, skip } = parsePaging(searchParams, 10)

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
