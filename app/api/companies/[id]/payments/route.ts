import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.unauthorized()

    try {
        const payments = await CompanyService.getPayments(params.id)
        return ApiResponse.success(payments)
    } catch (error: any) {
        console.error('Fetch payments error:', error)
        return ApiResponse.error("Failed to fetch payments")
    }
})

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.unauthorized()

    const { cost, subscriptionType } = json
    if (!cost || !subscriptionType) {
        return ApiResponse.badRequest("Cost and subscription type are required")
    }

    try {
        const payment = await CompanyService.createPayment(params.id, parseFloat(cost), subscriptionType)
        return ApiResponse.success(payment, 201)
    } catch (error: any) {
        console.error('Create payment error:', error)
        return ApiResponse.error("Failed to create payment")
    }
}, {
    audit: { action: 'CREATE_COMPANY_PAYMENT', entityType: 'COMPANY_PAYMENT', getEntityId: (res) => res.id }
})
