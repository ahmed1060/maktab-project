import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { maySettings } from "@/lib/company-settings-access"
import { SalaryAdvancePolicyInvalid, SalaryAdvancePolicyService } from "@/lib/services/salary-advance-policy.service"
import { SALARY_ADVANCE_OVER_LIMIT, type SalaryAdvanceOverLimit } from "@/lib/salary-advance-policy"

/**
 * A company's salary advance rules (LATER_CHANGES_PLAN.md §7.5, step 2), the
 * Payroll tab's third card. Asked what Payroll deductions is asked: the tab
 * shown to whoever reads them, and Change company settings to save them
 * (lib/company-settings-access.ts).
 */

/** Which company: the one asked for, for the Super Admin; one's own for anyone else. */
function companyFor(session: any, asked: unknown): string | null {
    if (session.user.role === "SUPER_ADMIN") return typeof asked === "string" && asked ? asked : null
    return session.user.companyId ?? null
}

export const GET = withStandardHandler(async (req, session) => {
    const companyId = companyFor(session, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const exposure = await CompanyService.settingsExposure(companyId)
    if (!exposure) return ApiResponse.notFound("Company not found")
    if (!maySettings(session.user, exposure, "payroll", "view")) return ApiResponse.forbidden()
    const policy = await SalaryAdvancePolicyService.view(companyId)
    if (!policy) return ApiResponse.notFound("Company not found")
    return ApiResponse.success(policy)
})

/** A figure as the card sends it: typed text, or a number from elsewhere. */
const text = (v: unknown) => typeof v === "number" ? String(v) : typeof v === "string" ? v : ""

export const PUT = withStandardHandler(async (req, session, json) => {
    const body = (json ?? {}) as Record<string, unknown>
    const companyId = companyFor(session, body.companyId)
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const exposure = await CompanyService.settingsExposure(companyId)
    if (!exposure) return ApiResponse.notFound("Company not found")
    if (!maySettings(session.user, exposure, "payroll", "edit")) return ApiResponse.forbidden()

    // The two the card can't send wrong: a box ticked or not, and one of two choices.
    if (typeof body.oneOpen !== "boolean") return ApiResponse.badRequest("oneOpen must be true or false")
    if (!SALARY_ADVANCE_OVER_LIMIT.includes(body.overLimit as SalaryAdvanceOverLimit)) return ApiResponse.badRequest("overLimit must be BLOCK or WARN")

    try {
        const saved = await SalaryAdvancePolicyService.save(companyId, {
            maxMonths: text(body.maxMonths),
            minServiceMonths: text(body.minServiceMonths),
            oneOpen: body.oneOpen,
            installmentPercent: text(body.installmentPercent),
            debtsPercent: text(body.debtsPercent),
            overLimit: body.overLimit as SalaryAdvanceOverLimit,
        }, session)
        return ApiResponse.success(saved)
    } catch (error) {
        // What's wrong, under each field, as the card says it.
        if (error instanceof SalaryAdvancePolicyInvalid) return ApiResponse.badRequest("Validation Error", { code: "SALARY_ADVANCE_POLICY_INVALID", errors: error.errors })
        throw error
    }
})
