import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createClientSchema, updateClientSchema } from "@/lib/validations/client.schema"
import { ClientService } from "@/lib/services/client.service"
import { can } from "@/lib/permissions/can"

// Read with clients.view — a Team Leader holds it (they pick a client when
// creating a task) but not clients.manage; writes are checked per-method below.
export const GET = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    const userCompanyId = (session.user as any).companyId

    if (!can(session.user, "clients.view")) {
        return ApiResponse.forbidden()
    }

    const { searchParams } = new URL(req.url)
    const clientId = searchParams.get('id')

    if (clientId) {
        const client = await prisma.client.findUnique({ where: { id: clientId } })
        if (!client) return ApiResponse.notFound("Client not found")
        if (!can(session.user, "clients.view", { companyId: client.companyId })) return ApiResponse.forbidden()
        return ApiResponse.success(client)
    }

    let companyId: string | undefined
    if (userRole === 'SUPER_ADMIN') {
        // No companyId means "all companies" — an aggregate view, not an
        // error. The frontend uses this when the Super Admin hasn't picked
        // one company via the switcher.
        companyId = searchParams.get('companyId') || undefined
    } else {
        if (!userCompanyId) return ApiResponse.success([])
        companyId = userCompanyId
    }

    const clients = await prisma.client.findMany({
        where: companyId ? { companyId } : {},
        orderBy: { name: 'asc' },
        include: {
            // createdBy is null for a Super-Admin-created client (the FK
            // only targets User) — the frontend shows a generic "Super
            // Admin" label in that case rather than nothing.
            createdBy: { select: { firstName: true, lastName: true } },
            // Company name is only needed to label rows in the Super
            // Admin's aggregate ("all companies") view — a non-Super-Admin
            // request is always scoped to their own single company already.
            ...(userRole === 'SUPER_ADMIN' ? { company: { select: { name: true } } } : {})
        }
    })

    return ApiResponse.success(clients)
})

export const POST = withStandardHandler(async (req, session, json) => {
    if (!can(session.user, "clients.manage")) {
        return ApiResponse.forbidden()
    }

    const validation = createClientSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await ClientService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if (error.message === 'COMPANY_SELECTION_REQUIRED') return ApiResponse.badRequest("Company selection required for Super Admin")
        if (error.message === 'USER_NO_COMPANY') return ApiResponse.forbidden("User is not assigned to a company")
        // Unique constraint on (name, companyId)
        if (error.code === 'P2002') return ApiResponse.badRequest("A client with this name already exists")

        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    if (!can(session.user, "clients.manage")) {
        return ApiResponse.forbidden()
    }

    const validation = updateClientSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await ClientService.update(validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'CLIENT_NOT_FOUND') return ApiResponse.notFound("Client not found")
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden()
        if (error.code === 'P2002') return ApiResponse.badRequest("A client with this name already exists")

        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (!can(session.user, "clients.manage")) {
        return ApiResponse.forbidden()
    }

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
})
