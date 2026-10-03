import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollRunService } from "@/lib/services/payroll-run.service"
import { resolvePayrollScope, payrollScopeRefusal } from "@/lib/payroll-scope"

/**
 * The register for one company's month.
 *
 * GET computes and returns it without writing anything, so opening the screen
 * cannot create a run and a person looking at a draft is never the reason a row
 * appears. POST stores the computed figures as a draft.
 */

export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const scope = resolvePayrollScope(
        session.user, "payroll.view",
        new URL(req.url).searchParams.get('companyId'),
        params.year, params.month,
    )
    if (!scope.ok) return payrollScopeRefusal(scope)

    const view = await PayrollRunService.view(scope.companyId, scope.year, scope.month)
    return ApiResponse.success(view)
})

export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const scope = resolvePayrollScope(
        session.user, "payroll.prepare", json?.companyId,
        params.year, params.month,
    )
    if (!scope.ok) return payrollScopeRefusal(scope)

    try {
        const run = await PayrollRunService.saveDraft(scope.companyId, scope.year, scope.month, session)
        return ApiResponse.success({ runId: run.id, status: run.status })
    } catch (error: any) {
        if (error.message === 'RUN_NOT_DRAFT') {
            // The one thing standing between correcting a typo and silently
            // restating a month that has already been approved.
            return ApiResponse.badRequest("This month has already been approved and cannot be rebuilt")
        }
        if (error.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        throw error
    }
})
