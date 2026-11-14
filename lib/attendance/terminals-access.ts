import { ApiResponse } from "@/lib/api-response"
import { CompanyService } from "@/lib/services/company.service"
import { hasBundle, resolveBundles } from "@/lib/features/bundles"
import { can, type Actor } from "@/lib/permissions/can"
import { maySettings, type SettingsExposure } from "@/lib/company-settings-access"

/**
 * Who reaches a company's Fingerprint terminals: its agents and their codes,
 * its terminals, and retiring them (ATTENDANCE_PLAN.md §17.10, PR 277).
 *
 * The section is on the Attendance settings tab, so whoever reaches it may
 * see that tab. Then the Super Admin always; anyone else only where the Super
 * Admin lets the company set its own terminals up, and only holding Set up
 * fingerprint terminals, which implies settings.view. Seeing it is changing
 * it: there's no read-only view of the section. Whether a settings tab may be
 * saved isn't asked: an agent's code lets punches into pay, so it's a
 * permission of its own, not part of the tab's.
 */
export function mayTerminals(actor: Actor, company: SettingsExposure & { terminalsSetupByCompany: boolean }): boolean {
    if (!maySettings(actor, company, "attendance", "view")) return false
    if (actor.role === "SUPER_ADMIN") return true
    return company.terminalsSetupByCompany && can(actor, "attendance.manage_terminals", { companyId: company.id })
}

/**
 * Null when this person may reach this company's terminals; otherwise the
 * response. Anyone who may not answers 404, as if absent; a company without
 * the Terminals add-on, 403, as the add-on's pages do (§16).
 */
export async function denyTerminals(session: any, companyId: string | null) {
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    const company = await CompanyService.settingsExposure(companyId)
    if (!company) return ApiResponse.notFound("Company not found")
    if (!mayTerminals(session.user, company)) return ApiResponse.notFound()
    if (!hasBundle(resolveBundles(company.package), "ATTENDANCE_TERMINALS")) {
        return ApiResponse.forbidden("Attendance terminals aren't included in this company's package.")
    }
    return null
}
