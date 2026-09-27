/**
 * The tabs of a company's settings (ATTENDANCE_PLAN.md §5.1). Adding a
 * category is one entry here plus its component in CompanySettingsTabs.
 *
 * Plain data, so the server reads the same list the screen does: which tab a
 * field belongs to, and which tabs a company's own people may ever be shown
 * (§5.2).
 */

export type CompanySettingsTab = {
    key: string
    labelKey: string
    /**
     * Whether the Super Admin may show this tab to the company's own people.
     * Package, module names and icons, roles, and the switch that shows the
     * tabs are the Super Admin's policy, so they never are.
     */
    adminEligible: boolean
    /** The company fields this tab saves through the company settings API. */
    fields: readonly string[]
    /** Of those, the ones only the Super Admin sets, even when the tab is shown. */
    superAdminOnly?: readonly string[]
}

export const COMPANY_SETTINGS_TABS = [
    { key: "general", labelKey: "settings_tab_general", adminEligible: true, fields: ["autoVerifyLocation"] },
    // The logo has its own endpoint (app/api/companies/logo), which asks the
    // same question of this entry.
    { key: "branding", labelKey: "settings_tab_branding", adminEligible: true, fields: [] },
    {
        key: "payroll", labelKey: "settings_tab_payroll", adminEligible: true,
        fields: ["payrollDay", "payslipsVisible", "timezone", "debtRecoveryPercent"],
        // How much of a debt comes out of one payslip is a term of the
        // contract with the company, not a setting the company tunes.
        superAdminOnly: ["debtRecoveryPercent"],
    },
    { key: "roles", labelKey: "settings_tab_roles", adminEligible: false, fields: [] },
    { key: "modules", labelKey: "settings_tab_modules", adminEligible: false, fields: [] },
    // Which of these the company's own people see: the Super Admin's switch.
    { key: "access", labelKey: "settings_tab_access", adminEligible: false, fields: [] },
] as const satisfies readonly CompanySettingsTab[]

export type CompanySettingsTabKey = (typeof COMPANY_SETTINGS_TABS)[number]["key"]

export function settingsTab(key: string | null | undefined): CompanySettingsTab | undefined {
    return (COMPANY_SETTINGS_TABS as readonly CompanySettingsTab[]).find(t => t.key === key)
}

export function isSettingsTabKey(key: string | null | undefined): key is CompanySettingsTabKey {
    return !!settingsTab(key)
}
