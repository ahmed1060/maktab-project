import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollRunService } from "@/lib/services/payroll-run.service"
import { resolvePayrollScope, payrollScopeRefusal } from "@/lib/payroll-scope"

/**
 * Freezing a month.
 *
 * Its own route rather than a status field on the register's POST, because it
 * is a different kind of act: saving a draft is reversible and approving is
 * not, and an endpoint that does either depending on a body field is one typo
 * away from doing the wrong one.
 *
 * A refusal comes back as a 400 with its reason and the names it concerns, so
 * the screen can say who rather than just no.
 */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const scope = resolvePayrollScope(
        session.user.role, session.user.companyId, json?.companyId,
        params.year, params.month,
    )
    if (!scope.ok) return payrollScopeRefusal(scope)

    const result = await PayrollRunService.approve(scope.companyId, scope.year, scope.month, session, {
        acknowledgePending: json?.acknowledgePending === true,
    })

    if ('refusal' in result) {
        // badRequest carries details; error() does not. The names matter: a
        // screen that can only say "no" sends somebody hunting through a list
        // of fifty to find the two people it meant.
        return ApiResponse.badRequest(result.refusal.message, {
            code: result.refusal.code,
            names: 'names' in result.refusal ? result.refusal.names : [],
        })
    }

    return ApiResponse.success({ runId: result.runId, status: 'APPROVED' })
})
