import { withStandardHandler } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { ApiResponse } from "@/lib/api-response"
import { createSectionSchema, updateSectionSchema } from "@/lib/validations/section.schema"
import { SectionService } from "@/lib/services/section.service"

export const GET = withStandardHandler(async (req, session, _body, context) => {
    const userRole = session.user.role
    const clientId = context.params.id

    // Authorization
    const client = await prisma.businessClient.findUnique({
        where: { id: clientId },
        select: { companyId: true }
    })

    if (!client) return ApiResponse.notFound("Client not found")

    if (userRole !== 'SUPER_ADMIN') {
        const userCompanyId = (session.user as any).companyId
        if (!userCompanyId || userCompanyId !== client.companyId) {
            return ApiResponse.notFound() // Hide existence
        }
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const search = searchParams.get('search') || ''
    const skip = (page - 1) * limit

    const where: any = { clientId }
    if (search) where.title = { contains: search, mode: 'insensitive' }

    const [sections, total] = await Promise.all([
        prisma.businessClientSection.findMany({
            where,
            include: {
                createdBy: { select: { firstName: true, lastName: true, role: true } },
                lastEditedBy: { select: { firstName: true, lastName: true, role: true } },
                _count: { select: { notes: true } }
            },
            orderBy: { createdAt: 'asc' },
            skip,
            take: limit
        }),
        prisma.businessClientSection.count({ where })
    ])

    return ApiResponse.success({
        data: sections,
        total,
        page,
        totalPages: Math.ceil(total / limit)
    })
})

export const POST = withStandardHandler(async (req, session, json, context) => {
    const clientId = context.params.id

    // 1. Validation
    const validation = createSectionSchema.safeParse({ ...json, clientId })
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await SectionService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if (error.message === 'CLIENT_NOT_FOUND') return ApiResponse.notFound("Client not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden()
        throw error
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = updateSectionSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN', 'TEAM_LEADER'].includes(userRole || '')) {
        return ApiResponse.forbidden()
    }

    try {
        // 2. Service
        const result = await SectionService.update(validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'SECTION_NOT_FOUND') return ApiResponse.notFound("Section not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden()
        throw error
    }
}, {
    audit: { action: 'UPDATE_SECTION', entityType: 'SECTION', getEntityId: (res) => res.id }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const userRole = session.user.role
    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole || '')) return ApiResponse.forbidden()

    const { searchParams } = new URL(req.url)
    const sectionId = searchParams.get('sectionId') || searchParams.get('id')
    if (!sectionId) return ApiResponse.badRequest("Section ID required")

    try {
        await SectionService.delete(sectionId, session)
        return ApiResponse.success({ success: true, id: sectionId })
    } catch (error: any) {
        if (error.message === 'SECTION_NOT_FOUND') return ApiResponse.notFound("Section not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden()
        throw error
    }
}, {
    audit: { action: 'DELETE_SECTION', entityType: 'SECTION', getEntityId: (res) => res?.id }
})
