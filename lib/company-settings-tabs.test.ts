import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { COMPANY_SETTINGS_TABS, settingsTab } from "./company-settings-tabs"

/**
 * The company settings tabs (ATTENDANCE_PLAN.md §5.1): one registry, and a
 * page that shows every entry in it. The cards themselves are unchanged and
 * keep their own tests.
 */

const TABS = readFileSync("components/CompanySettingsTabs.tsx", "utf8")
const PAGE = readFileSync("app/(dashboard)/dashboard/companies/[id]/settings/page.tsx", "utf8")

describe("the company settings tabs", () => {
    it("name every tab in both languages", () => {
        for (const tab of COMPANY_SETTINGS_TABS) {
            expect((en as Record<string, string>)[tab.labelKey], `en ${tab.labelKey}`).toBeTruthy()
            expect((ar as Record<string, string>)[tab.labelKey], `ar ${tab.labelKey}`).toBeTruthy()
        }
    })

    it("show something on every tab, and have no tab the registry does not list", () => {
        const shown = [...TABS.matchAll(/tab === '(\w+)'/g)].map(m => m[1])
        expect([...new Set(shown)].sort()).toEqual(COMPANY_SETTINGS_TABS.map(t => t.key).sort())
    })

    it("keep every card the page had", () => {
        for (const card of ["CompanyGeneralCard", "CompanyLogoCard", "CompanyPayrollCard", "CompanyRolesCard", "CompanyModulesCard"]) {
            expect(TABS, card).toMatch(new RegExp(`<${card}[\\s/>]`))
        }
        expect(PAGE).toMatch(/<CompanySettingsTabs[\s/>]/)
    })

    it("put each field in one tab", () => {
        const fields = COMPANY_SETTINGS_TABS.flatMap(t => [...t.fields])
        expect(new Set(fields).size).toBe(fields.length)
        for (const tab of COMPANY_SETTINGS_TABS) {
            for (const field of (tab as { superAdminOnly?: readonly string[] }).superAdminOnly ?? []) expect(tab.fields).toContain(field)
        }
    })

    it("open on the first tab shown, from the URL otherwise", () => {
        expect(COMPANY_SETTINGS_TABS[0].key).toBe("general")
        expect(TABS).toContain("?? tabs[0]?.key")
        expect(settingsTab("payroll")?.key).toBe("payroll")
        expect(settingsTab("nonsense")).toBeUndefined()
        expect(TABS).toContain("searchParams.get('tab')")
    })

    it("ask before leaving unsaved edits", () => {
        // The two cards with a Save button say when they hold edits.
        expect(readFileSync("components/CompanyPayrollCard.tsx", "utf8")).toContain("useReportUnsaved('payroll', dirty)")
        expect(readFileSync("components/CompanyModulesCard.tsx", "utf8")).toContain("useReportUnsaved('modules', isDirty)")
        expect(TABS).toContain("if (dirty) setLeavingFor(next)")
    })
})
