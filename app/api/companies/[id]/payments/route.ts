import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { isSubscriptionType } from "@/lib/billing/period"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    try {
        const payments = await CompanyService.getPayments(params.id)
        return ApiResponse.success(payments)
    } catch (error: any) {
        console.error('Fetch payments error:', error)
        return ApiResponse.error("Failed to fetch payments")
    }
})

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const { cost, subscriptionType } = json ?? {}
    if (!cost || !subscriptionType) {
        return ApiResponse.badRequest("Cost and subscription type are required")
    }
    // Checked here rather than when the payment is confirmed: an unknown type
    // used to be stored and then refused at confirmation, leaving a payment
    // that could never be marked paid, and a cost that wasn't a positive
    // number was stored as sent. A number, or one typed as text: Number()
    // alone made true a cost of 1 and [5] one of 5 (review on #6).
    const amount = typeof cost === 'number' ? cost : typeof cost === 'string' && cost.trim() !== '' ? Number(cost) : NaN
    if (!Number.isFinite(amount) || amount <= 0) return ApiResponse.badRequest("The cost must be a positive number")
    if (typeof subscriptionType !== 'string' || !isSubscriptionType(subscriptionType)) return ApiResponse.badRequest("Unknown subscription type")

    try {
        const payment = await CompanyService.createPayment(params.id, amount, subscriptionType, session)
        return ApiResponse.success(payment, 201)
    } catch (error: any) {
        console.error('Create payment error:', error)
        return ApiResponse.error("Failed to create payment")
    }
})
