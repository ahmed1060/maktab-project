import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { existingSettingsTabs } from "@/lib/company-settings-access"

/**
 * The Super Admin's settings page for a company shows only the tabs that exist
 * for it: a module's tab (Attendance) only when the company's package holds
 * the module. Before, it showed every tab, and the Attendance tab of a company
 * with no attendance add-on could only say "Something went wrong", as its API
 * rightly answered 404.
 */
describe("Super Admin's company settings tabs", () => {
    const HR_ONLY = { hasCompanyManagement: true, hasHR: true, hasAttendanceTerminals: false, hasAttendanceMobile: false }

    it("leave out Attendance for a package without an attendance add-on", () => {
        expect(existingSettingsTabs({ package: HR_ONLY })).not.toContain("attendance")
        expect(existingSettingsTabs({ package: HR_ONLY })).toContain("general")
    })

    it("show Attendance with either add-on", () => {
        expect(existingSettingsTabs({ package: { ...HR_ONLY, hasAttendanceMobile: true } })).toContain("attendance")
        expect(existingSettingsTabs({ package: { ...HR_ONLY, hasAttendanceTerminals: true } })).toContain("attendance")
    })

    it("show everything for a company with no package (grandfathered)", () => {
        expect(existingSettingsTabs({ package: null })).toContain("attendance")
    })

    it("are what the page passes, not the whole list", () => {
        const page = readFileSync("app/(dashboard)/dashboard/companies/[id]/settings/page.tsx", "utf8")
        expect(page).toContain("tabs={existingSettingsTabs(company)}")
        expect(page).not.toContain("COMPANY_SETTINGS_TABS.map(x => x.key)")
    })
})
