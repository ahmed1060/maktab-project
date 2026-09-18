import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollDeliveryService } from "@/lib/services/payroll-delivery.service"
import { resolvePayrollScope, payrollScopeRefusal } from "@/lib/payroll-scope"
import { NextResponse } from "next/server"

/**
 * The register as a file, for whoever actually moves the money.
 *
 * The only route in the app that answers with something other than the standard
 * JSON envelope, because a bank portal wants a file and a person wants a file,
 * and neither can do anything with { success: true, data: … }. Refusals still
 * come back as JSON — a caller reading a 404 is a browser, not a spreadsheet.
 *
 * text/csv rather than a spreadsheet format: it is the one thing every bank
 * portal, every accountant and every version of Excel can open, and lib/csv.ts
 * already handles the two ways it silently corrupts.
 */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const scope = resolvePayrollScope(
        session.user.role, session.user.companyId,
        new URL(req.url).searchParams.get('companyId'),
        params.year, params.month,
    )
    if (!scope.ok) return payrollScopeRefusal(scope)

    try {
        const { filename, body } = await PayrollDeliveryService.exportCsv(scope.companyId, scope.year, scope.month)
        return new NextResponse(body, {
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                // Quoted because the filename carries no spaces today and
                // there is no reason to find out the hard way when it does.
                'Content-Disposition': `attachment; filename="${filename}"`,
                // Somebody downloads this, notices a wrong figure, fixes it and
                // downloads again. A cached copy of the first one is a payment
                // run made from figures that were already corrected.
                'Cache-Control': 'no-store',
            },
        })
    } catch (error: any) {
        if (error.message === 'RUN_NOT_FOUND') return ApiResponse.notFound("No payroll for this month")
        throw error
    }
})
