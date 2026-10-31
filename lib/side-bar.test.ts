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
    return { superAdmin: role === "SUPER_ADMIN", can: p.can, companyWide: p.companyWide, attendance: true, checkIn: false, companySettings: false, cashAdvances: false, ...flags }
}
const shape = (v: SideBarViewer) => sideBarFor(v).map(g => `${g.key}: ${g.items.join(", ")}`)

describe("the side bar", () => {
    it("groups an Admin's pages by what they do, Company Settings at the bottom", () => {
        expect(shape(viewer("ADMIN", { companySettings: true }))).toEqual([
            "top: dashboard",
            "work: tasks, obligations",
            "clients: clients, locations, records",
            // Role requests are on the Requests page (UI_PLAN.md §2.3, part 5b).
            "people: employees, attendance, requests, dayOff, profileRequests",
            "money: costs, payroll",
            "me: myPayslips",
            // The saved lists, for whoever manages them (CLIENTS_PLAN.md §5.6), and Roles and
            // access beside Company Settings, for whoever gives roles (decided on 2026-10-31).
            "bottom: companySettings, rolesAndAccess, savedLists",
        ])
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

    it("shows Attendance only where the company has it, or to whoever corrects it company-wide", () => {
        expect(shape(viewer("EMPLOYEE", { attendance: false })).join()).not.toMatch(/attendance/i)
        expect(shape(viewer("ADMIN", { attendance: false })).join()).toContain("employees, attendance,")
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
        // The headings in the shell aren't upper-cased by CSS either (DESIGN.md §3.4).
        const nav = readFileSync("components/DashboardShell.tsx", "utf8").split("<nav")[1].split("</nav>")[0]
        expect(nav).not.toContain("uppercase")
    })

    it("draws its group headings and their spacing with the design's tokens (DESIGN.md §10)", () => {
        const nav = readFileSync("components/DashboardShell.tsx", "utf8").split("<nav")[1].split("</nav>")[0]
        const group = nav.slice(nav.indexOf('role="group"'), nav.indexOf("group.items.map("))
        expect(group).not.toMatch(/'\d*\.?\d+rem'/)
        expect(group).toContain("var(--text-sm)")
        const preview = readFileSync("components/CompanyModulesCard.tsx", "utf8")
        const heading = preview.slice(preview.indexOf("const previewGroup"), preview.indexOf("{heading}</p>"))
        expect(heading).not.toMatch(/'\d*\.?\d+rem'/)
        expect(heading).toContain("var(--text-xs)")
    })

    it("lists each page once, and every module, as the Company Settings preview draws them", () => {
        const items = [...COMPANY_GROUPS, ...SUPER_ADMIN_GROUPS].flatMap(g => g.items)
        expect(new Set(items).size).toBe(items.length)
        for (const key of MODULE_KEYS) expect(items).toContain(key)
        for (const key of Object.keys(PAGES)) expect(items).toContain(key)
        expect(readFileSync("components/CompanyModulesCard.tsx", "utf8")).toContain("COMPANY_GROUPS.map(group =>")
    })
})
