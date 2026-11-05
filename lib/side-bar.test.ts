import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { COMPANY_GROUPS, PAGES, SUPER_ADMIN_GROUPS, sideBarFor, type SideBarViewer } from "./side-bar"
import { MODULE_KEYS } from "./modules"
import { permissionsOf } from "./useCan"
import { withGrants } from "./permissions/test-actors"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The side bar's groups (UI_PLAN.md §2.1, §2.2): by what people do, each item
 * for those who may use it, and a group hidden when nothing in it is.
 */

const viewer = (role: string, flags: Partial<SideBarViewer> = {}): SideBarViewer => {
    const p = permissionsOf(withGrants({ id: "u1", role, companyId: role === "SUPER_ADMIN" ? null : "c1" }) as any)
    return { superAdmin: role === "SUPER_ADMIN", can: p.can, has: () => true, checkIn: false, companySettings: false, cashAdvances: false, ...flags }
}
const shape = (v: SideBarViewer) => sideBarFor(v).map(g => `${g.key}: ${g.items.join(", ")}`)

describe("the side bar", () => {
    it("groups an Admin's pages by what they do, Company Settings at the bottom", () => {
        expect(shape(viewer("ADMIN", { companySettings: true }))).toEqual([
            "top: dashboard",
            "work: tasks, obligations",
            "clients: clients, locations, records",
            // One Requests item: day off, name changes and role requests are on its page (UI_PLAN.md §2.3, part 5c).
            "people: employees, attendance, requests",
            "money: costs, payroll",
            "me: myPayslips",
            // The saved lists, for whoever manages them (CLIENTS_PLAN.md §5.6), and Roles and
            // access beside Company Settings, for whoever gives roles (decided on 2026-10-31).
            "bottom: companySettings, rolesAndAccess, savedLists",
        ])
    })

    it("has one Requests item, for everyone: the Day off and Profile requests pages send people to it (part 5c)", () => {
        for (const role of ["ADMIN", "TEAM_LEADER", "EMPLOYEE", "SUPER_ADMIN"]) {
            const all = shape(viewer(role, { companySettings: true, cashAdvances: true })).join(" ")
            expect(all, role).toContain("requests")
            expect(all, role).not.toMatch(/dayOff|profileRequests/)
        }
        expect(Object.keys(PAGES)).not.toContain("profileRequests")
    })

    it("offers Roles and access to whoever gives roles, not whoever only asks for them, nor the Super Admin (part 5b)", () => {
        const asks = (permission: string) => ({ ...viewer("EMPLOYEE"), can: (p: string) => p === permission })
        expect(shape(asks("employees.assign_role")).join(" ")).toContain("rolesAndAccess")
        expect(shape(asks("employees.request_role")).join(" ")).not.toContain("rolesAndAccess")
        expect(shape(viewer("SUPER_ADMIN")).join(" ")).not.toContain("rolesAndAccess")
        expect(PAGES.rolesAndAccess.href).toBe("/dashboard/roles-and-access")
    })

    it("puts My cash advance under Me, only where the company uses cash advances (CLIENTS_PLAN.md §7.5)", () => {
        expect(shape(viewer("EMPLOYEE", { cashAdvances: true }))).toContain("me: myAttendance, myPayslips, myCashAdvance")
        expect(shape(viewer("EMPLOYEE")).join(" ")).not.toContain("myCashAdvance")
        expect(shape(viewer("SUPER_ADMIN", { cashAdvances: true })).join(" ")).not.toContain("myCashAdvance")
    })

    it("opens Costs to whoever sees cash advances, where they're used", () => {
        const sees = (cashAdvances: boolean) => {
            const p = permissionsOf(withGrants({ id: "u1", role: "EMPLOYEE", companyId: "c1" }) as any)
            const can = (permission: string) => permission === "cash_advances.view" || p.can(permission as any)
            return shape({ ...viewer("EMPLOYEE"), can, cashAdvances }).join(" ")
        }
        expect(sees(true)).toContain("money: costs")
        expect(sees(false)).not.toContain("costs")
    })

    it("offers the saved lists only to whoever manages them", () => {
        expect(shape(viewer("EMPLOYEE")).join(" ")).not.toContain("savedLists")
        expect(shape(viewer("TEAM_LEADER")).join(" ")).not.toContain("savedLists")
    })

    it("hides a group an employee can see nothing in, and puts their own attendance under Me", () => {
        const groups = shape(viewer("EMPLOYEE"))
        expect(groups.find(g => g.startsWith("money"))).toBeUndefined()
        expect(groups).toContain("me: myAttendance, myPayslips")
        // Records are everyone's to read; the Clients list isn't.
        expect(groups).toContain("clients: records")
        expect(groups.find(g => g.startsWith("people"))).not.toContain("attendance,")
    })

    it("puts Check in at the top, beside Dashboard, only where the phone can check in", () => {
        expect(shape(viewer("EMPLOYEE", { checkIn: true }))[0]).toBe("top: dashboard, checkIn")
        expect(shape(viewer("EMPLOYEE"))[0]).toBe("top: dashboard")
        expect(shape(viewer("SUPER_ADMIN", { checkIn: true }))[0]).toBe("top: dashboard")
    })

    // Decided by the product owner on 2026-11-05 (DESIGN.md §5.1): it was
    // there, faded and with a padlock, as the way to find out what else the
    // product does, and Attendance was there for whoever would run it.
    it("leaves out what the company's package doesn't include, for everyone in it", () => {
        const without = (...modules: string[]) => ({ has: (m: string) => !modules.includes(m) })
        // Company Management alone: no pay, day off or attendance, the Admin's own payslips included.
        const hr = ["DAY_OFF", "PAYROLL", "SALARY_ADJUSTMENTS", "ATTENDANCE"]
        expect(shape(viewer("ADMIN", { companySettings: true, cashAdvances: true, ...without(...hr) }))).toEqual([
            "top: dashboard",
            "work: tasks, obligations",
            "clients: clients, locations, records",
            "people: employees, requests",
            "money: costs",
            "me: myCashAdvance",
            "bottom: companySettings, rolesAndAccess, savedLists",
        ])
        // HR alone: no tasks, clients, records, costs or saved lists, so no Work, Clients or Money.
        const management = ["TASKS", "OBLIGATIONS", "RECORDS", "CLIENTS", "COSTS"]
        expect(shape(viewer("ADMIN", { companySettings: true, cashAdvances: true, ...without(...management, "ATTENDANCE") }))).toEqual([
            "top: dashboard",
            "people: employees, requests",
            "money: payroll",
            "me: myPayslips",
            "bottom: companySettings, rolesAndAccess",
        ])
        // Nobody's role puts it back: an employee's Attendance, and a Team Leader's.
        for (const role of ["EMPLOYEE", "TEAM_LEADER", "ADMIN"]) {
            expect(shape(viewer(role, without("ATTENDANCE"))).join(), role).not.toMatch(/attendance/i)
        }
    })

    it("draws nothing as locked, and asks the package what it includes", () => {
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        expect(shell).not.toContain("🔒")
        expect(shell).not.toMatch(/isLockedHref|locked \? 0\.\d+/)
        // From the account the layout passed until the session loads
        // (lib/features/use-features.test.ts).
        expect(shell).toMatch(/const features = useFeatures\(\)/)
        expect(shell).toMatch(/has: gated => features\.has\(gated\)/)
    })

    it("gives the Super Admin the company's groups, then their own four", () => {
        const groups = shape(viewer("SUPER_ADMIN"))
        expect(groups.slice(-4)).toEqual([
            "customers: companies, packages, allUsers",
            "templates: roleTemplates, policyTemplates, publicHolidays",
            "access: superAdmins, roleChanges, accessReviews, whoCan",
            "operations: checkIns, auditLogs, systemHealth, systemSettings",
        ])
        // Nobody's employee: no payslips, and no Me.
        expect(groups.find(g => g.startsWith("me"))).toBeUndefined()
        expect(shape(viewer("ADMIN")).join()).not.toContain("companies")
    })

    it("names every group, sentence case, in both languages", () => {
        for (const group of [...COMPANY_GROUPS, ...SUPER_ADMIN_GROUPS]) {
            if (!group.labelKey) continue
            expect(en[group.labelKey], group.key).toMatch(/^[A-Z][a-z ]+$/)
            expect((ar as Record<string, string>)[group.labelKey], group.key).toBeTruthy()
        }
        // The headings in the side bar aren't upper-cased by CSS either (DESIGN.md §3.4).
        expect(readFileSync("components/SideBar.tsx", "utf8")).not.toContain("uppercase")
        const css = readFileSync("components/ui/ui.css", "utf8")
        const heading = css.slice(css.indexOf(".ui-side-group-name {"), css.indexOf("}", css.indexOf(".ui-side-group-name {")))
        expect(heading).not.toContain("uppercase")
    })

    it("draws its group headings and their spacing with the design's tokens (DESIGN.md §10)", () => {
        // The side bar's own, from the building blocks' CSS (components/SideBar.tsx).
        expect(readFileSync("components/SideBar.tsx", "utf8")).toContain('<p className="ui-side-group-name" aria-hidden="true">{t(g.labelKey)}</p>')
        const sideCss = readFileSync("components/ui/ui.css", "utf8")
        const own = sideCss.slice(sideCss.indexOf(".ui-side-group-name {"), sideCss.indexOf("}", sideCss.indexOf(".ui-side-group-name {")))
        expect(own).not.toMatch(/\d*\.?\d+rem/)
        expect(own).toContain("var(--text-sm)")
        // The Modules tab's preview draws its headings as the side bar does,
        // from the building blocks' CSS (company settings part 4a).
        expect(readFileSync("components/CompanyModulesCard.tsx", "utf8")).toContain('<p className="ui-sidebar-preview-group">{t(group.labelKey)}</p>')
        const css = readFileSync("components/ui/ui.css", "utf8")
        const heading = css.slice(css.indexOf(".ui-sidebar-preview-group {"), css.indexOf("}", css.indexOf(".ui-sidebar-preview-group {")))
        expect(heading).not.toMatch(/\d*\.?\d+rem/)
        expect(heading).toContain("var(--text-sm)")
    })

    it("lists each page once, and every module, as the Company Settings preview draws them", () => {
        const items = [...COMPANY_GROUPS, ...SUPER_ADMIN_GROUPS].flatMap(g => g.items)
        expect(new Set(items).size).toBe(items.length)
        for (const key of MODULE_KEYS) expect(items).toContain(key)
        for (const key of Object.keys(PAGES)) expect(items).toContain(key)
        expect(readFileSync("components/CompanyModulesCard.tsx", "utf8")).toContain("COMPANY_GROUPS.map(group =>")
    })
})
