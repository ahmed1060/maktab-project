import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createTaskSchema } from "@/lib/validations/task.schema"
import { TaskService } from "@/lib/services/task.service"
import { parsePaging } from "@/lib/pagination"
import { buildTaskWhereClause } from "@/lib/services/task-query"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)

    let companyId = searchParams.get('companyId')
    const companyName = searchParams.get('company')

    if (!companyId && companyName) {
        const comp = await prisma.company.findUnique({ where: { name: companyName } })
        if (comp) companyId = comp.id
    }

    const result = buildTaskWhereClause(session, searchParams, companyId)
    if (result.empty) {
        return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
    }
    const whereClause = result.whereClause

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
        if (error.message === 'TL_CANNOT_ASSIGN_OUTSIDE_TEAM') return ApiResponse.forbidden("Team Leaders can only assign tasks to their own team")
        if (error.message === 'ASSIGNEE_NOT_FOUND') return ApiResponse.notFound("One or more assignees not found")
        if (error.message === 'VENDOR_NOT_FOUND') return ApiResponse.notFound("Selected vendor not found")
        if (error.message === 'CROSS_COMPANY_VENDOR_FORBIDDEN') return ApiResponse.forbidden("Cannot use a vendor from a different company")

        throw error // bubble up to withStandardHandler for 500
    }
}, {
    // Creating work for people is a manager's act. The route had no gate of
    // its own, so while the screen only offered "Create task" to managers, an
    // Employee could still POST here and create a task for anyone in their
    // company, an Admin included — checkAssignees only checks company, and
    // team only for a Team Leader. Bulk creation was already gated this way.
    allowedRoles: ['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'],
    audit: {
        action: 'CREATE_TASK',
        entityType: 'TASK',
        getEntityId: (res) => res.id
    }
})
