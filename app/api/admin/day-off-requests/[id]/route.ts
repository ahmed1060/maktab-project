import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { adminUpdateDayOffSchema } from "@/lib/validations/day-off.schema"
import { DayOffService } from "@/lib/services/day-off.service"

export const PATCH = withStandardHandler(async (req, session, json, { params }) => {
    const userRole = session.user.role

    if (!['ADMIN', 'SUPER_ADMIN'].includes(userRole)) {
        return ApiResponse.forbidden("Unauthorized")
    }

    // 1. Validation
    const validation = adminUpdateDayOffSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const { status } = validation.data
        let result

        if (status === 'APPROVED') {
            result = await DayOffService.approve(params.id, validation.data, session)
        } else {
            result = await DayOffService.reject(params.id, session)
        }

        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'REQUEST_NOT_FOUND') return ApiResponse.notFound("Request not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("Access denied")
        if (error.message === 'INVALID_DEDUCTION') return ApiResponse.badRequest("Invalid deduction amount")
        if (error.message === 'INSUFFICIENT_CREDIT') return ApiResponse.badRequest("Insufficient credit")
        throw error
    }
})
