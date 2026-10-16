import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { updateCompanySchema } from "@/lib/validations/company.schema"
import { CompanyService } from "@/lib/services/company.service"
import { settingsTab } from "@/lib/company-settings-tabs"
import { maySetField, maySettings, visibleSettingsTabs } from "@/lib/company-settings-access"
import { can } from "@/lib/permissions/can"

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
            id: true, name: true, adminSettingsEnabled: true, adminSettingsTabs: true,
            package: { select: { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: true, hasAttendanceMobile: true } },
            autoVerifyLocation: true, logoUrl: true, brandColour: true,
            payrollDay: true, payslipsVisible: true, timezone: true, debtRecoveryPercent: true,
        },
    })
    if (!company) return ApiResponse.notFound("Company not found")

    const tabs = visibleSettingsTabs(session.user, company)
    if (tabs.length === 0) return ApiResponse.forbidden()

    // Only what the shown tabs hold: a hidden tab's values stay hidden too.
    const shown: Record<string, unknown> = { id: company.id, name: company.name }
    for (const key of tabs) for (const field of settingsTab(key)!.fields) shown[field] = (company as Record<string, unknown>)[field]
    if (tabs.includes("branding")) shown.logoUrl = company.logoUrl

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
        throw error
    }
    return ApiResponse.success({ saved: fields })
})
