import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { DayOffService } from "@/lib/services/day-off.service"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const { newDays } = json || {}

    if (newDays === undefined || isNaN(parseFloat(newDays.toString()))) {
        return ApiResponse.badRequest("Invalid number of days")
    }

    try {
        await DayOffService.reevaluate(params.id, parseFloat(newDays.toString()), session)
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        if (error.message === 'REQUEST_NOT_FOUND') return ApiResponse.notFound("Request not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("Access denied")
        if (error.message === 'INVALID_STATE') {
            return ApiResponse.badRequest("Only approved credit-deducted requests can be re-evaluated")
        }
        throw error
    }
})
