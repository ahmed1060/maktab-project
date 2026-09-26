import { withStandardHandler } from "@/lib/api-utils"
import { can } from "@/lib/permissions/can"
import { ApiResponse } from "@/lib/api-response"
import { createProfileRequestSchema } from "@/lib/validations/profile.schema"
import { ProfileService } from "@/lib/services/profile.service"

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'PENDING'
    const targetUserId = searchParams.get('userId')
    const userRole = session.user.role
    const isAdmin = can(session.user, "profile_requests.review")

    const where: any = { status }

    if (!isAdmin) {
        where.userId = session.user.id
    } else {
        if (userRole !== 'SUPER_ADMIN') {
            const userCompanyId = session.user.companyId
            if (!userCompanyId) return ApiResponse.success({ data: [], total: 0, page: 1, totalPages: 0 })
            where.user = { companyId: userCompanyId }
        }
        if (targetUserId) where.userId = targetUserId
    }

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit

    try {
        const { requests, total } = await ProfileService.getMany(where, skip, limit)
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
    const validation = createProfileRequestSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        // 2. Service
        const result = await ProfileService.createRequest(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if (error.message === 'PENDING_REQUEST_EXISTS') {
            return ApiResponse.badRequest("You already have a pending name change request")
        }
        if (error.message === 'NAME_IDENTICAL') {
            return ApiResponse.badRequest("New name is identical to current name")
        }
        if (error.message === 'USER_NOT_FOUND') return ApiResponse.notFound("User not found")
        throw error
    }
})
