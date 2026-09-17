import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollRunService } from "@/lib/services/payroll-run.service"
import type { NextResponse } from "next/server"

/**
 * The register for one company's month.
 *
 * GET computes and returns it without writing anything, so opening the screen
 * cannot create a run and a person looking at a draft is never the reason a row
 * appears. POST stores the computed figures as a draft.
 */

const MANAGERS = ['ADMIN', 'SUPER_ADMIN']

type Resolved =
    | { error: NextResponse; companyId?: undefined }
    | { error?: undefined; companyId: string; year: number; month: number }

function resolve(session: any, params: { year: string; month: string }, companyParam: string | null): Resolved {
    if (!MANAGERS.includes(session.user.role || '')) return { error: ApiResponse.forbidden("Managers only") }

    // A Super Admin may name a company; an Admin only ever sees their own.
    // Reading the parameter for both would let an Admin type somebody else's id
    // and be shown their payroll.
    const companyId = session.user.role === 'SUPER_ADMIN'
        ? (companyParam || session.user.companyId)
        : session.user.companyId
    if (!companyId) return { error: ApiResponse.badRequest("No company to run payroll for") }

    const year = Number(params.year)
    const month = Number(params.month)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return { error: ApiResponse.badRequest("Year is out of range") }
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
        return { error: ApiResponse.badRequest("Month must be 1-12") }
    }

    return { companyId, year, month }
}

export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const resolved = resolve(session, params, new URL(req.url).searchParams.get('companyId'))
    if (resolved.error) return resolved.error

    const view = await PayrollRunService.view(resolved.companyId, resolved.year, resolved.month)
    return ApiResponse.success(view)
})

export const POST = withStandardHandler(async (req, session, json, { params }) => {
    const resolved = resolve(session, params, json?.companyId ?? null)
    if (resolved.error) return resolved.error

    try {
        const run = await PayrollRunService.saveDraft(resolved.companyId, resolved.year, resolved.month, session)
        return ApiResponse.success({ runId: run.id, status: run.status })
    } catch (error: any) {
        if (error.message === 'RUN_NOT_DRAFT') {
            // The one thing standing between correcting a typo and silently
            // restating a month that has already been paid.
            return ApiResponse.badRequest("This month has already been approved and cannot be rebuilt")
        }
        if (error.message === 'COMPANY_NOT_FOUND') return ApiResponse.notFound("Company not found")
        throw error
    }
})
