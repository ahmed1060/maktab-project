export const dynamic = 'force-dynamic'

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AuditLogService } from "@/lib/services/audit-log.service"

export const GET = withStandardHandler(async (req, session) => {
    // 1. Auth Check: Super Admin only
    if (session.user.role !== 'SUPER_ADMIN') {
        return ApiResponse.forbidden("Access denied")
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const skip = (page - 1) * limit

    const entityType = searchParams.get('entityType') || undefined
    const action = searchParams.get('action') || undefined
    const companyId = searchParams.get('companyId') || undefined
    const startDate = searchParams.get('startDate') || undefined
    const endDate = searchParams.get('endDate') || undefined
    const entityId = searchParams.get('entityId') || undefined
    const performedById = searchParams.get('performedById') || undefined

    try {
        const result = await AuditLogService.getMany(skip, limit, {
            entityType,
            action,
            companyId,
            startDate,
            endDate,
            entityId,
            performedById
        })
        return ApiResponse.success({
            data: result.logs,
            total: result.total,
            page,
            totalPages: Math.ceil(result.total / limit)
        })
    } catch (error: any) {
        throw error
    }
})
