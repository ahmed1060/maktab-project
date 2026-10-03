import { can, type Actor } from "@/lib/permissions/can"
import { COMPANY_SETTINGS_TABS, settingsTab, type CompanySettingsTab, type CompanySettingsTabKey } from "@/lib/company-settings-tabs"
import { hasModule, resolveBundles, type PackageFacts } from "@/lib/features/bundles"

/**
 * Who sees a company's settings, and which tabs (ATTENDANCE_PLAN.md §5.2).
 *
 * The Super Admin sees every tab of every company. A company's own people see
 * a tab only when all of these hold:
 * - the Super Admin has switched the company's settings on for it;
 * - and ticked that tab, which must be one that may be shown (`adminEligible`);
 * - and the person holds settings.view in that company (settings.edit to save).
 *
 * A tab that belongs to a module (Attendance) exists only for a company that
 * holds the module, for everybody including the Super Admin.
 *
 * The switch decides whether the company sees settings at all; the permission
 * decides which of its people do. Every settings API asks this, so a hidden
 * tab's API does not answer either.
 */

export type SettingsExposure = {
    id: string
    adminSettingsEnabled: boolean
    adminSettingsTabs: readonly string[]
    /** Required, null included: null is grandfathered, and leaving it out must not read as that. */
    package: PackageFacts
}

/** Whether a tab exists for this company: one tied to a module needs the module. */
function existsFor(company: Pick<SettingsExposure, "package">, key: string): boolean {
    const needs = (settingsTab(key) as CompanySettingsTab | undefined)?.module
    return !needs || hasModule(resolveBundles(company.package), needs)
}

/** The tabs a company's own people may ever be shown. */
export const ELIGIBLE_SETTINGS_TABS = COMPANY_SETTINGS_TABS.filter(t => t.adminEligible).map(t => t.key) as CompanySettingsTabKey[]

/** The tabs the Super Admin has shown this company, eligible ones only. */
export function exposedTabs(company: Pick<SettingsExposure, "adminSettingsEnabled" | "adminSettingsTabs" | "package">): CompanySettingsTabKey[] {
    if (!company.adminSettingsEnabled) return []
    return ELIGIBLE_SETTINGS_TABS.filter(key => company.adminSettingsTabs.includes(key) && existsFor(company, key))
}

/** The tabs this person may see in this company's settings. */
export function visibleSettingsTabs(actor: Actor, company: SettingsExposure): CompanySettingsTabKey[] {
    if (actor.role === "SUPER_ADMIN") return COMPANY_SETTINGS_TABS.map(t => t.key).filter(key => existsFor(company, key))
    if (!can(actor, "settings.view", { companyId: company.id })) return []
    return exposedTabs(company)
}

/** Whether this person may see, or save, this tab of this company's settings. */
export function maySettings(actor: Actor, company: SettingsExposure, tab: string, need: "view" | "edit"): boolean {
    if (!settingsTab(tab)) return false
    if (!visibleSettingsTabs(actor, company).includes(tab as CompanySettingsTabKey)) return false
    return need === "view" || can(actor, "settings.edit", { companyId: company.id })
}

/** Whether this person may save this field of this tab: some fields stay the Super Admin's even on a shown tab. */
export function maySetField(actor: Actor, tab: string, field: string): boolean {
    const def = settingsTab(tab)
    if (!def || !def.fields.includes(field)) return false
    return actor.role === "SUPER_ADMIN" || !(def.superAdminOnly ?? []).includes(field)
}
