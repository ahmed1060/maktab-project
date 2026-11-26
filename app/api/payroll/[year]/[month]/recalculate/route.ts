import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { resolvePayrollScope, payrollScopeRefusal } from "@/lib/payroll-scope"
import { CompanyService } from "@/lib/services/company.service"
import { AttendanceEngineService } from "@/lib/services/attendance-engine.service"
import { lockedMonths } from "@/lib/services/attendance-lock"
import { hasModule, resolveBundles } from "@/lib/features/bundles"

/**
 * Recalculate this month, from the Payroll page (LATER_CHANGES_PLAN.md §7.1,
 * step 2, PR 425): a draft month's attendance days worked out again, as the
 * Days tab's button does, for whoever may save the draft. The page then reads
 * the register again, which works out the draft payroll from those days.
 *
 * Refused, before anything is worked out, where the company has no
 * attendance, or once the month's payroll is approved or paid: its days stay
 * as they were paid.
 */

const LOCKED = "This month's payroll is approved, so its days stay as they were paid."

export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const scope = resolvePayrollScope(session.user, "payroll.prepare", json?.companyId, params.year, params.month)
    if (!scope.ok) return payrollScopeRefusal(scope)

    const company = await CompanyService.settingsExposure(scope.companyId)
    if (!company) return ApiResponse.notFound("Company not found")
    if (!hasModule(resolveBundles(company.package), "ATTENDANCE")) {
        return ApiResponse.refused(409, "This company has no attendance to recalculate.", "NO_ATTENDANCE")
    }

    const month = `${scope.year}-${String(scope.month).padStart(2, "0")}`
    if ((await lockedMonths(prisma, scope.companyId, [month])).size > 0) return ApiResponse.refused(409, LOCKED, "PAYROLL_MONTH_LOCKED")

    const result = await AttendanceEngineService.recomputeMonth(scope.companyId, month)
    // Approved while it was asked: what changed is kept for an adjustment instead.
    if (result.locked) return ApiResponse.refused(409, LOCKED, "PAYROLL_MONTH_LOCKED")
    return ApiResponse.success({ month, written: result.written, removed: result.removed })
})
