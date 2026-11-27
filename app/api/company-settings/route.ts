import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { updateCompanySchema } from "@/lib/validations/company.schema"
import { CompanyService } from "@/lib/services/company.service"
import { settingsTab } from "@/lib/company-settings-tabs"
import { maySetField, maySettings, visibleSettingsTabs } from "@/lib/company-settings-access"
import { can } from "@/lib/permissions/can"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { CashAdvanceService } from "@/lib/services/cash-advance.service"
import { hasBundle, hasModule, resolveBundles } from "@/lib/features/bundles"

/**
 * A company's settings, tab by tab (ATTENDANCE_PLAN.md §5), for the Super
 * Admin and for the company's own people. Each request is checked against
 * lib/company-settings-access.ts: the company's switch, the tab's checkbox,
 * and the caller's settings.view or settings.edit.
 */

/** Which company: the one asked for, for the Super Admin; one's own for anyone else. */
function companyFor(session: any, asked: string | null | undefined): string | null {
    if (session.user.role === "SUPER_ADMIN") return asked || null
    return session.user.companyId ?? null
}

export const GET = withStandardHandler(async (req, session) => {
    const companyId = companyFor(session, new URL(req.url).searchParams.get("companyId"))
    if (!companyId) return ApiResponse.badRequest("companyId is required")

    const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: {
            id: true, name: true, nameAr: true, adminSettingsEnabled: true, adminSettingsTabs: true,
            package: { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true, hasClientPortal: true } },
            autoVerifyLocation: true, cashAdvancesAllowed: true, cashAdvancesOn: true, costNamesFromListOnly: true, confirmHighRisk: true, logoUrl: true, brandColour: true,
            payrollDay: true, payslipsVisible: true, timezone: true, debtRecoveryPercent: true,
            // Payday's choices and when payroll closes (LATER_CHANGES_PLAN.md §7.10, PR 430).
            paydayLastDay: true, paydayNextMonth: true, paydayMove: true, payrollCloseDay: true,
            terminalsSetupByCompany: true,
            terminalsDirectAllowed: true,
        },
    })
    if (!company) return ApiResponse.notFound("Company not found")

    const tabs = visibleSettingsTabs(session.user, company)
    if (tabs.length === 0) return ApiResponse.forbidden()

    // Only what the shown tabs hold: a hidden tab's values stay hidden too.
    // Its name in Arabic too, for the note above the tabs while it has none (PR 408).
    const shown: Record<string, unknown> = { id: company.id, name: company.name, nameAr: company.nameAr }
    for (const key of tabs) for (const field of settingsTab(key)!.fields) shown[field] = (company as Record<string, unknown>)[field]
    // What its people hold, which keeps the cash advances' switches on (CLIENTS_PLAN.md §7.6).
    if (tabs.includes("general")) {
        shown.cashAdvancesHeld = await CashAdvanceService.heldIn(company.id)
        // Cost names only from the saved list (CLIENTS_PLAN.md §6.9): for a
        // company with the Costs module, and how many names its list holds,
        // as it's switched on only once it has one.
        shown.costNamesOffered = hasModule(resolveBundles(company.package), "COSTS")
        shown.costNamesSaved = await prisma.listEntry.count({ where: { companyId: company.id, kind: "COST_NAME", archivedAt: null } })
        // The high-risk confirmation (ROLES_PLAN.md §6.15): off for every
        // company, its own switch has nothing to turn.
        shown.confirmHighRiskForAll = (await SystemSettingsService.get()).confirmHighRisk
    }
    // Whether the company has fingerprint terminals to set up, for the
    // Super Admin's switch on the Attendance tab (ATTENDANCE_PLAN.md §17.10).
    if (tabs.includes("attendance") && session.user.role === "SUPER_ADMIN") {
        shown.terminalsOffered = hasBundle(resolveBundles(company.package), "ATTENDANCE_TERMINALS")
    }
    if (tabs.includes("branding")) {
        shown.logoUrl = company.logoUrl
        // What "Use the default" goes back to (UI_PLAN.md §4.6).
        shown.defaultBrandColour = (await SystemSettingsService.get()).brandColour
    }

    return ApiResponse.success({
        company: shown,
        tabs,
        canEdit: can(session.user, "settings.edit", { companyId }),
    })
})

export const PUT = withStandardHandler(async (req, session, json) => {
    const body = (json ?? {}) as Record<string, unknown>
    const { companyId: asked, tab, ...values } = body
    const companyId = companyFor(session, typeof asked === "string" ? asked : null)
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    if (typeof tab !== "string" || !settingsTab(tab)) return ApiResponse.badRequest("Unknown settings tab")

    const exposure = await CompanyService.settingsExposure(companyId)
    if (!exposure) return ApiResponse.notFound("Company not found")
    if (!maySettings(session.user, exposure, tab, "edit")) return ApiResponse.forbidden()

    // Only this tab's fields, and of those only the ones this caller sets.
    const fields = Object.keys(values)
    if (fields.length === 0) return ApiResponse.badRequest("Nothing to save")
    const foreign = fields.filter(f => !settingsTab(tab)!.fields.includes(f))
    if (foreign.length > 0) return ApiResponse.badRequest(`Not settings of this tab: ${foreign.join(", ")}`)
    if (fields.some(f => !maySetField(session.user, tab, f))) return ApiResponse.forbidden("Only the Super Admin sets this")

    const validation = updateCompanySchema.safeParse({ id: companyId, ...values })
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())

    try {
        await CompanyService.update(validation.data, session)
    } catch (error: any) {
        if (error.message === "COMPANY_NOT_FOUND") return ApiResponse.notFound("Company not found")
        // Under payday's field (LATER_CHANGES_PLAN.md §7.10, PR 430); the form says it in its own words.
        if (error.message === "PAYDAY_BEFORE_CLOSE") {
            const why = "Payday has to come after payroll closes, so the month can be approved before it's paid."
            return ApiResponse.badRequest(why, { code: "PAYDAY_BEFORE_CLOSE", closeDay: error.closeDay ?? null, payrollDay: { _errors: [why] } })
        }
        throw error
    }
    return ApiResponse.success({ saved: fields })
})
