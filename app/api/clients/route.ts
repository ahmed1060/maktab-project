import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createClientSchema, updateClientSchema } from "@/lib/validations/client.schema"
import { ClientService } from "@/lib/services/client.service"
import { can } from "@/lib/permissions/can"
import { assertStepUp } from "@/lib/step-up"
import { parsePaging } from "@/lib/pagination"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId')
    const clientId = searchParams.get('id')
    const userRole = session.user.role
    const userCompanyId = (session.user as any).companyId

    // 1. Single Client Fetch
    if (clientId) {
        const client = await prisma.businessClient.findUnique({
            where: { id: clientId },
            include: {
                createdBy: { select: { firstName: true, lastName: true, role: true } },
                lastEditedBy: { select: { firstName: true, lastName: true, role: true } },
                _count: { select: { sections: true } }
            }
        })

        if (!client) return ApiResponse.notFound("Client not found")
        if (!can(session.user, "clients.view", { companyId: client.companyId })) return ApiResponse.forbidden()

        return ApiResponse.success(client)
    }

    // 2. Multi-Client Fetch
    if (!userCompanyId && userRole !== 'SUPER_ADMIN') return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })

    const where: any = {}
    if (userRole === 'SUPER_ADMIN') {
        if (companyId) where.companyId = companyId
    } else {
        where.companyId = userCompanyId
    }

    const { page, limit, skip } = parsePaging(searchParams, 10)

    const [clients, total] = await Promise.all([
        prisma.businessClient.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: {
                createdBy: { select: { firstName: true, lastName: true, role: true } },
                lastEditedBy: { select: { firstName: true, lastName: true, role: true } },
                _count: { select: { sections: true } }
            },
            skip,
            take: limit
        }),
        prisma.businessClient.count({ where })
    ])

    return ApiResponse.success({
        data: clients,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
}, { permission: "clients.view" })

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = createClientSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await ClientService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        // 3. Error Mapping
        if (error.message === 'COMPANY_SELECTION_REQUIRED') return ApiResponse.badRequest("Company selection required for Super Admin")
        if (error.message === 'USER_NO_COMPANY') return ApiResponse.forbidden("User is not assigned to a company")

        throw error
    }
}, { permission: "clients.contribute" })

export const PUT = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = updateClientSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    if (!can(session.user, "clients.edit")) {
        return ApiResponse.forbidden()
    }

    try {
        // 2. Service
        const result = await ClientService.update(validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        // 3. Error Mapping
        if (error.message === 'CLIENT_NOT_FOUND') return ApiResponse.notFound("Client not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()

        throw error
    }
}, {
    audit: { action: 'UPDATE_CLIENT', entityType: 'CLIENT', getEntityId: (res) => res.id }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (!can(session.user, "clients.delete")) return ApiResponse.forbidden()
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "clients.delete")

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return ApiResponse.badRequest("ID required")

    try {
        await ClientService.delete(id, session)
        return ApiResponse.success({ success: true, id })
    } catch (error: any) {
        if (error.message === 'CLIENT_NOT_FOUND') return ApiResponse.notFound("Client not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()

        throw error
    }
}, {
    audit: { action: 'DELETE_CLIENT', entityType: 'CLIENT', getEntityId: (res) => res.id }
})
