import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { COMPANY_SETTINGS_TABS, settingsTab } from "./company-settings-tabs"
import { leavingHref } from "./useUnsavedChanges"

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
        // Every card with a Save button says when it holds edits.
        expect(readFileSync("components/CompanyPayrollCard.tsx", "utf8")).toContain("useReportUnsaved('payroll', dirty)")
        expect(readFileSync("components/CompanyModulesCard.tsx", "utf8")).toContain("useReportUnsaved('modules', isDirty)")
        expect(readFileSync("components/CompanySettingsAccessCard.tsx", "utf8")).toContain("useReportUnsaved('access', dirty)")
        // The access review switch, on the Roles tab.
        expect(readFileSync("components/AccessReviewSetting.tsx", "utf8")).toContain("useReportUnsaved('access-review', dirty)")
        expect(TABS).toContain("if (dirty) setLeavingFor({ tab: next })")
    })

    describe("and before leaving the page by a link", () => {
        const here = "https://nizmo.test/dashboard/companies/c1/settings?tab=payroll"
        const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }
        const link = (href: string, extra: object = {}) => ({ href: new URL(href, here).href, ...extra })

        it("asks about a link to another page of the site: the sidebar, the back link", () => {
            expect(leavingHref(link("/dashboard/tasks"), click, here)).toBe("/dashboard/tasks")
            expect(leavingHref(link("/dashboard/companies"), click, here)).toBe("/dashboard/companies")
            expect(leavingHref(link("?tab=modules"), click, here)).toBe("/dashboard/companies/c1/settings?tab=modules")
        })

        it("not about one that leaves nothing behind", () => {
            expect(leavingHref(null, click, here)).toBeNull()
            expect(leavingHref(link("https://example.com/x"), click, here)).toBeNull()
            expect(leavingHref(link("/dashboard/tasks", { target: "_blank" }), click, here)).toBeNull()
            expect(leavingHref(link("/api/roles/export", { download: true }), click, here)).toBeNull()
            expect(leavingHref(link("/dashboard/tasks"), { ...click, ctrlKey: true }, here)).toBeNull()
            expect(leavingHref(link("/dashboard/tasks"), { ...click, button: 1 }, here)).toBeNull()
            expect(leavingHref(link("#top"), click, here)).toBeNull()
        })

        it("is wired to the tabs, and the back link is a link", () => {
            expect(TABS).toContain("useGuardLinks(dirty, href => setLeavingFor({ href }))")
            expect(PAGE).toMatch(/<Link\s+href="\/dashboard\/companies"/)
        })
    })
})
