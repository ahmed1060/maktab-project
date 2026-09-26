import { withStandardHandler } from "@/lib/api-utils"
import { can } from "@/lib/permissions/can"
import { ApiResponse } from "@/lib/api-response"
import { createRequestSchema } from "@/lib/validations/request.schema"
import { RequestService } from "@/lib/services/request.service"
import { teamMemberWhere, and } from "@/lib/team-scope"
import { grantFor } from "@/lib/permissions/can"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const companyIdParam = searchParams.get('companyId')
    const search = searchParams.get('search')
    const filterUserId = searchParams.get('userId')
    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const order = searchParams.get('order') || 'desc'

    const userId = session.user.id
    const userCompanyId = session.user.companyId

    const where: any = {}

    // How far requests.view reaches decides the base: everywhere (Super Admin),
    // the company, the team, or — without it — one's own requests.
    const reach = grantFor(session.user, "requests.view")
    if (reach === 'ALL') {
        if (companyIdParam) where.companyId = companyIdParam
    } else if (reach === 'COMPANY') {
        where.companyId = userCompanyId
    } else if (reach === 'TEAM') {
        // A leader answers their own team's requests, not the company's.
        where.companyId = userCompanyId
        and(where, { user: teamMemberWhere(userId) })
    } else {
        where.userId = userId
    }

    if (status) {
        where.status = status
    } else {
        const isHistory = searchParams.get('history') === 'true'
        if (isHistory) {
            where.status = 'COMPLETED'
        } else {
            where.status = { in: ['PENDING', 'IN_PROGRESS'] }
        }
    }

    if (search) {
        where.title = { contains: search, mode: 'insensitive' }
    }

    if (filterUserId && can(session.user, "requests.view")) {
        // Narrows within the scope above and cannot escape it: for a leader
        // this is intersected with their team, so another team's id matches
        // nothing rather than replacing the scope.
        and(where, { userId: filterUserId })
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    try {
        const { requests, total } = await RequestService.getMany(where, skip, limit, sortBy, order)
        return ApiResponse.success({
            data: requests,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        })
    } catch (error: any) {
        throw error
    }
})

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Validation
    const validation = createRequestSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await RequestService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        throw error
    }
}, {
    audit: {
        action: 'CREATE_REQUEST',
        entityType: 'REQUEST',
        getEntityId: (res) => res.id
    }
})
