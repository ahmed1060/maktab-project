import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { ProfileService } from "@/lib/services/profile.service"

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const { adminNote } = json || {}

    try {
        await ProfileService.rejectRequest(params.id, adminNote, session)
        return ApiResponse.success({ success: true })
    } catch (error: any) {
        if (error.message === 'REQUEST_NOT_FOUND') return ApiResponse.notFound("Request not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("Access denied")
        if (error.message === 'OWN_REQUEST') return ApiResponse.forbidden("You cannot decide your own name change")
        if (error.message === 'REQUEST_ALREADY_PROCESSED') return ApiResponse.badRequest("Request already processed")
        throw error
    }
})
