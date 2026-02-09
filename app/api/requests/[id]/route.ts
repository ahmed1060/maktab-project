import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RequestService } from "@/lib/services/request.service"

export const GET = withStandardHandler(async (req, session, _body, { params }) => {
    try {
        const result = await RequestService.getById(params.id, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'REQUEST_NOT_FOUND') return ApiResponse.notFound("Request not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("Access denied")
        throw error
    }
})

export const PATCH = withStandardHandler(async (req, session, json, { params }) => {
    const { status } = json

    try {
        const result = await RequestService.updateStatus(params.id, status, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'REQUEST_NOT_FOUND') return ApiResponse.notFound("Request not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("Access denied")
        if (error.message === 'INVALID_STATUS') return ApiResponse.badRequest("Invalid status")
        throw error
    }
})

export const DELETE = withStandardHandler(async (req, session, _body, { params }) => {
    try {
        await RequestService.delete(params.id, session)
        return ApiResponse.success({ success: true, id: params.id })
    } catch (error: any) {
        if (error.message === 'REQUEST_NOT_FOUND') return ApiResponse.notFound("Request not found")
        if (error.message === 'ACCESS_DENIED') return ApiResponse.forbidden("Access denied")
        if (error.message === 'COMPLETED_REQUEST_DELETE_FORBIDDEN') {
            return ApiResponse.forbidden("Completed requests can only be deleted by Super Admins")
        }
        throw error
    }
}, {
    audit: {
        action: 'DELETE_REQUEST',
        entityType: 'REQUEST',
        getEntityId: (res) => res?.id
    }
})
