import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollRunService } from "@/lib/services/payroll-run.service"

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
export const POST = withStandardHandler(async (req, session, json, { params }) => {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(session.user.role || '')) {
        return ApiResponse.forbidden("Managers only")
    }

    const companyId = session.user.role === 'SUPER_ADMIN'
        ? (json?.companyId || session.user.companyId)
        : session.user.companyId
    if (!companyId) return ApiResponse.badRequest("No company to run payroll for")

    const year = Number(params.year)
    const month = Number(params.month)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return ApiResponse.badRequest("Year is out of range")
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        return ApiResponse.badRequest("Month must be 1-12")
    }

    const result = await PayrollRunService.approve(companyId, year, month, session, {
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
