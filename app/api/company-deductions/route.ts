import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { maySettings } from "@/lib/company-settings-access"
import { DeductionsInvalid, PayrollDeductionService } from "@/lib/services/payroll-deduction.service"
import type { DeductionDraft } from "@/lib/payroll-deductions"

/**
 * A company's payroll deductions (LATER_CHANGES_PLAN.md §7.12, PR 440), the
 * Payroll tab's second card. Asked what the tab's own fields are asked: the
 * tab shown to whoever reads them, and Change company settings to save them
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
    return ApiResponse.success(await PayrollDeductionService.view(companyId))
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

    if (!Array.isArray(body.more)) return ApiResponse.badRequest("more is required")
    const more: DeductionDraft[] = body.more.map((d: any) => ({
        id: typeof d?.id === "string" ? d.id : undefined,
        name: typeof d?.name === "string" ? d.name : "",
        basis: d?.basis === "PERCENT" ? "PERCENT" : "AMOUNT",
        value: text(d?.value),
    }))
    try {
        const saved = await PayrollDeductionService.save(companyId, { incomeTax: text(body.incomeTax), socialInsurance: text(body.socialInsurance), more }, session)
        return ApiResponse.success(saved)
    } catch (error) {
        // What's wrong, under each field, as the card says it.
        if (error instanceof DeductionsInvalid) return ApiResponse.badRequest("Validation Error", { code: "DEDUCTIONS_INVALID", errors: error.errors })
        throw error
    }
})
