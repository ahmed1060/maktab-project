import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createCompanySchema, updateCompanySchema } from "@/lib/validations/company.schema"
import { CompanyService } from "@/lib/services/company.service"

export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.unauthorized()

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (id) {
        const company = await prisma.company.findUnique({
            where: { id },
            select: { id: true, name: true, isBanned: true }
        })
        if (!company) return ApiResponse.notFound("Company not found")
        return ApiResponse.success(company)
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    const [companies, total] = await Promise.all([
        prisma.company.findMany({
            select: { id: true, name: true, isBanned: true },
            orderBy: { name: 'asc' },
            skip,
            take: limit
        }),
        prisma.company.count()
    ])

    return ApiResponse.success({
        data: companies,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.unauthorized()

    // 1. Validation
    const validation = createCompanySchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await CompanyService.create(validation.data)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if ((error as any).code === 'P2002') return ApiResponse.badRequest("Company already exists")
        throw error
    }
}, {
    audit: { action: 'CREATE_COMPANY', entityType: 'COMPANY', getEntityId: (res) => res.id }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.unauthorized()

    // 1. Validation
    const validation = updateCompanySchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await CompanyService.update(validation.data)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        if (error.message === 'CANNOT_RENAME_SHSD') return ApiResponse.forbidden("Cannot rename the system company (SHSD)")
        if ((error as any).code === 'P2002') return ApiResponse.badRequest("Company name already exists")
        throw error
    }
}, {
    audit: { action: 'UPDATE_COMPANY', entityType: 'COMPANY', getEntityId: (res, body) => body.id }
})

export const DELETE = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.unauthorized()

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return ApiResponse.badRequest("Company ID required")

    try {
        await CompanyService.delete(id)
        return ApiResponse.success({ success: true, id })
    } catch (error: any) {
        if (error.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        if (error.message === 'CANNOT_DELETE_SHSD') return ApiResponse.forbidden("Cannot delete the system company (SHSD)")
        throw error
    }
}, {
    audit: { action: 'DELETE_COMPANY', entityType: 'COMPANY', getEntityId: (res, body) => body?.id }
})
