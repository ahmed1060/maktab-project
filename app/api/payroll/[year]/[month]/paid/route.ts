import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollDeliveryService } from "@/lib/services/payroll-delivery.service"
import { resolvePayrollScope, payrollScopeRefusal } from "@/lib/payroll-scope"
import { assertStepUp } from "@/lib/step-up"

/**
 * The money has moved.
 *
 * A date may be supplied, because it usually has not happened at the moment
 * somebody gets round to recording it — a transfer made on the 25th is often
 * marked on the 27th, and stamping the 27th makes the record disagree with the
 * bank. It is rejected if it is in the future: a payment that has not happened
 * yet is exactly the thing this status is not for.
 */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const scope = resolvePayrollScope(
        session.user, "payroll.mark_paid", json?.companyId,
        params.year, params.month,
    )
    if (!scope.ok) return payrollScopeRefusal(scope)
    // A high-risk action: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "payroll.mark_paid")

    let paidAt: Date | undefined
    if (json?.paidAt) {
        const parsed = new Date(json.paidAt)
        if (Number.isNaN(parsed.getTime())) return ApiResponse.badRequest("That is not a date")
        // A minute of slack for a clock that runs fast, not a day.
        if (parsed.getTime() > Date.now() + 60_000) {
            return ApiResponse.badRequest("A payment date cannot be in the future")
        }
        paidAt = parsed
    }

    try {
        const run = await PayrollDeliveryService.markPaid(scope.companyId, scope.year, scope.month, session, paidAt)
        return ApiResponse.success({ runId: run.id, status: run.status, paidAt: run.paidAt })
    } catch (error: any) {
        if (error.message === 'ALREADY_PAID') return ApiResponse.badRequest("This month is already marked paid")
        if (error.message === 'NOT_APPROVED') return ApiResponse.badRequest("Approve this month before marking it paid")
        if (error.message === 'RUN_NOT_FOUND') return ApiResponse.notFound("No payroll for this month")
        throw error
    }
})
