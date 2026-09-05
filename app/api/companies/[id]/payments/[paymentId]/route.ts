import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"

export const PATCH = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const { status } = json
    if (status !== 'PAID') {
        return ApiResponse.badRequest("Only marking as PAID is supported via PATCH")
    }

    try {
        const updatedPayment = await CompanyService.updatePaymentStatus(params.paymentId, status, session)
        return ApiResponse.success(updatedPayment)
    } catch (error: any) {
        console.error('Update payment error:', error)
        if (error.message === 'PAYMENT_NOT_FOUND') return ApiResponse.notFound("Payment not found")
        return ApiResponse.error("Failed to update payment")
    }
})

export const DELETE = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    try {
        await CompanyService.deletePayment(params.paymentId, session)
        return ApiResponse.success({ success: true, id: params.paymentId })
    } catch (error: any) {
        console.error('Delete payment error:', error)
        if (error.message === 'PAYMENT_NOT_FOUND') return ApiResponse.notFound("Payment not found")
        if (error.message === 'CANNOT_DELETE_PAID') return ApiResponse.badRequest("Cannot delete a PAID payment record")
        return ApiResponse.error("Failed to delete payment")
    }
})
