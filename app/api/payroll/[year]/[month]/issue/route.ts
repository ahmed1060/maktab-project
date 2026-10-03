import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollDeliveryService } from "@/lib/services/payroll-delivery.service"
import { resolvePayrollScope, payrollScopeRefusal } from "@/lib/payroll-scope"

/**
 * Send the next batch of payslips.
 *
 * One batch per call, not one call that sends everything: the sends are
 * sequential through a single Gmail account, and a request that tried to push
 * four hundred of them would sit past every timeout this app runs under and be
 * killed somewhere in the middle — with no way, from outside, to know where.
 * Batching moves that boundary into the data: emailedAt says exactly how far it
 * got, so the next call resumes rather than repeats.
 *
 * Rate-limited because each call is an outbound burst on a shared mailbox, and
 * because a doubled click should not double anybody's payslip.
 */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const scope = resolvePayrollScope(
        session.user, "payroll.issue_payslips", json?.companyId,
        params.year, params.month,
    )
    if (!scope.ok) return payrollScopeRefusal(scope)

    try {
        const result = await PayrollDeliveryService.issueBatch(scope.companyId, scope.year, scope.month)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'RUN_IS_DRAFT') {
            return ApiResponse.badRequest("Approve this month before sending payslips")
        }
        if (error.message === 'RUN_NOT_FOUND') return ApiResponse.notFound("No payroll for this month")
        throw error
    }
}, { rateLimit: { maxRequests: 20, windowMs: 60_000 } })
