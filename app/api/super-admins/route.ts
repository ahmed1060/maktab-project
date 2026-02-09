import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SuperAdminService } from "@/lib/services/super-admin.service"
import { superAdminSchema } from "@/lib/validations/super-admin.schema"

export const GET = withStandardHandler(async (req, session) => {
    // 1. Auth Check: Super Admin only
    if (session.user.role !== 'SUPER_ADMIN') {
        return ApiResponse.forbidden("Access denied")
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const skip = (page - 1) * limit
    const search = searchParams.get('search') || undefined

    try {
        const result = await SuperAdminService.getMany(skip, limit, search)
        return ApiResponse.success({
            data: result.admins,
            total: result.total,
            page,
            totalPages: Math.ceil(result.total / limit)
        })
    } catch (error: any) {
        throw error
    }
})

export const POST = withStandardHandler(async (req, session, json) => {
    // 1. Auth Check: Super Admin only
    if (session.user.role !== 'SUPER_ADMIN') {
        return ApiResponse.forbidden("Access denied")
    }

    // 2. Validation
    const validation = superAdminSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await SuperAdminService.create(validation.data, session)
        return ApiResponse.success(result, 201)
    } catch (error: any) {
        if ((error as any).code === 'P2002') {
            return ApiResponse.badRequest("Email already exists")
        }
        throw error
    }
})
