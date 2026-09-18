import { describe, it, expect } from "vitest"
import { existsSync } from "node:fs"
import { moduleForApiPath, moduleForPagePath } from "./routes"
import { MODULE_BUNDLE, ALL_MODULES, resolveBundles, serializeAccess } from "./bundles"
import { requireFeature } from "./require"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

const CM = { hasCompanyManagement: true, hasHR: false }
const HR = { hasCompanyManagement: false, hasHR: true }
const sessionFor = (pkg: any) => ({ user: { role: 'ADMIN', featureAccess: serializeAccess(resolveBundles(pkg)) } })

describe("API paths resolve to the right module", () => {
    it("maps the Company Management surfaces", () => {
        expect(moduleForApiPath('/api/tasks')).toBe('TASKS')
        expect(moduleForApiPath('/api/tasks/abc-123/submit')).toBe('TASKS')
        expect(moduleForApiPath('/api/obligations/abc/revert')).toBe('OBLIGATIONS')
        expect(moduleForApiPath('/api/clients/abc/sections')).toBe('CLIENTS')
        expect(moduleForApiPath('/api/vendors')).toBe('VENDORS')
    })

    it("maps the HR surfaces", () => {
        expect(moduleForApiPath('/api/day-off-requests')).toBe('DAY_OFF')
        expect(moduleForApiPath('/api/admin/day-off-requests/abc/reevaluate')).toBe('DAY_OFF')
    })

    it("leaves Core endpoints ungated", () => {
        for (const path of [
            '/api/users', '/api/users/abc/status', '/api/users/abc/reset-password',
            '/api/requests', '/api/notifications', '/api/me/bootstrap',
            '/api/account/mfa/enroll', '/api/auth/verify', '/api/user/activity',
            '/api/companies', '/api/packages', '/api/system-settings', '/api/upload',
        ]) {
            expect(moduleForApiPath(path), path).toBeNull()
        }
    })

    it("never gates the security endpoints", () => {
        // MFA, audit logging and password policy stay on for everyone
        // regardless of package.
        for (const path of ['/api/account/mfa/confirm', '/api/admin/audit-logs', '/api/auth/forgot-password/request']) {
            expect(moduleForApiPath(path), path).toBeNull()
        }
    })
})

describe("the endpoints that cross a bundle line", () => {
    it("the task penalty resolves to HR, not to Tasks", () => {
        // A Tasks feature that reads, updates and creates a SalaryRecord. A
        // Company-Management-only company holds Tasks, so the prefix would let
        // it through; the pattern is what stops it.
        expect(moduleForApiPath('/api/tasks/abc-123/penalty')).toBe('SALARY_ADJUSTMENTS')
        expect(requireFeature(sessionFor(CM), 'SALARY_ADJUSTMENTS', { onDeny: 'hide' }).allowed).toBe(false)
        // ...while the rest of Tasks is untouched for that same company.
        expect(requireFeature(sessionFor(CM), 'TASKS', { onDeny: 'lock' }).allowed).toBe(true)
    })

    it("bonuses, deductions and rollbacks under /api/users resolve to HR", () => {
        for (const path of [
            '/api/users/abc/bonus',
            '/api/users/abc/deduction',
            '/api/users/abc/adjustments',
            '/api/users/abc/adjustments/xyz/rollback',
        ]) {
            expect(moduleForApiPath(path), path).toBe('SALARY_ADJUSTMENTS')
        }
    })

    it("puts the whole payroll module behind the module", () => {
        // The gate is one table consulted by one check, and the failure it is
        // built to prevent is a new route shipping without an entry — which is
        // silent, because nothing fails. Payroll arrived as five routes at once
        // under a prefix that had no entry at all, while its own sibling
        // /api/users/:id/salary-history was already gated.
        for (const path of [
            '/api/payroll',
            '/api/payroll/2026/9',
            '/api/payroll/2026/9/approve',
            '/api/payroll/2026/9/issue',
            '/api/payroll/2026/9/paid',
            '/api/payroll/2026/9/export',
            '/api/payslips/abc',
            '/api/settlements/abc',
            '/api/settlements/abc/resend',
            '/api/debts/abc/waive',
        ]) {
            expect(moduleForApiPath(path), path).toBe('PAYROLL')
        }
        expect(moduleForPagePath('/dashboard/payroll')).toBe('PAYROLL')
        expect(moduleForPagePath('/dashboard/documents/payslip/abc')).toBe('PAYROLL')
    })

    it("salary and leave history resolve to HR while the directory stays Core", () => {
        expect(moduleForApiPath('/api/users/abc/salary-history')).toBe('PAYROLL')
        expect(moduleForApiPath('/api/users/abc/costs-history')).toBe('PAYROLL')
        expect(moduleForApiPath('/api/users/abc/day-off-history')).toBe('DAY_OFF')
        // The directory itself is Core — a Company-Management-only buyer needs
        // employees to exist in order to assign anything to them.
        expect(moduleForApiPath('/api/users')).toBeNull()
        expect(moduleForApiPath('/api/users/abc/status')).toBeNull()
    })

    it("an HR-only company keeps its people endpoints and loses operations", () => {
        const session = sessionFor(HR)
        expect(requireFeature(session, moduleForApiPath('/api/users/abc/bonus')!, { onDeny: 'hide' }).allowed).toBe(true)
        expect(requireFeature(session, moduleForApiPath('/api/day-off-requests')!, { onDeny: 'lock' }).allowed).toBe(true)
        expect(requireFeature(session, moduleForApiPath('/api/tasks')!, { onDeny: 'lock' }).allowed).toBe(false)
        expect(requireFeature(session, moduleForApiPath('/api/vendors')!, { onDeny: 'lock' }).allowed).toBe(false)
    })
})

describe("page paths and their guards", () => {
    it("maps each gated dashboard section", () => {
        expect(moduleForPagePath('/dashboard/tasks')).toBe('TASKS')
        expect(moduleForPagePath('/dashboard/tasks/abc')).toBe('TASKS')
        expect(moduleForPagePath('/dashboard/obligations')).toBe('OBLIGATIONS')
        expect(moduleForPagePath('/dashboard/clients/abc/sections/def')).toBe('CLIENTS')
        expect(moduleForPagePath('/dashboard/vendors')).toBe('VENDORS')
        expect(moduleForPagePath('/dashboard/costs')).toBe('COSTS')
        expect(moduleForPagePath('/dashboard/day-off-requests')).toBe('DAY_OFF')
    })

    it("leaves Core pages ungated", () => {
        for (const path of [
            '/dashboard', '/dashboard/employees', '/dashboard/employees/abc',
            '/dashboard/requests', '/dashboard/profile-requests', '/dashboard/usernames',
            '/dashboard/companies', '/dashboard/packages', '/dashboard/security-settings',
        ]) {
            expect(moduleForPagePath(path), path).toBeNull()
        }
    })

    it("every gated page actually has a guard layout on disk", () => {
        // The gate is only real if the file exists. Without this, adding a
        // module to the table looks like gating it while the page stays open.
        const dirs: Record<string, string> = {
            TASKS: 'tasks',
            OBLIGATIONS: 'obligations',
            CLIENTS: 'clients',
            VENDORS: 'vendors',
            COSTS: 'costs',
            DAY_OFF: 'day-off-requests',
        }
        for (const [mod, dir] of Object.entries(dirs)) {
            expect(moduleForPagePath(`/dashboard/${dir}`), dir).toBe(mod)
            expect(
                existsSync(`app/(dashboard)/dashboard/${dir}/layout.tsx`),
                `missing guard layout for ${module}`
            ).toBe(true)
        }
    })

    it("every gated module is reachable as either a page or an API path", () => {
        // A module in the bundle table that no route resolves to is a gate that
        // gates nothing — it would read as sold and enforce nothing.
        const gated = ALL_MODULES.filter(m => MODULE_BUNDLE[m] !== null)
        for (const mod of gated) {
            const reachable =
                ['/dashboard/tasks', '/dashboard/obligations', '/dashboard/clients', '/dashboard/vendors', '/dashboard/costs', '/dashboard/day-off-requests']
                    .some(p => moduleForPagePath(p) === mod) ||
                ['/api/tasks', '/api/obligations', '/api/clients', '/api/vendors', '/api/day-off-requests',
                 '/api/tasks/abc/penalty', '/api/users/abc/salary-history', '/api/tasks/payment/bulk']
                    .some(p => moduleForApiPath(p) === mod)
            expect(reachable, `${module} is gated but nothing routes to it`).toBe(true)
        }
    })
})

describe("what this deploy does on the day it ships", () => {
    // Production at the time of writing: 4 companies, 0 with a package, 0
    // packages defined at all, 13 active non-Super-Admin users. Every company
    // is grandfathered, so no gate can fire — which is the entire reason C1
    // ships before C2 and can be proved in production before it can hurt
    // anybody.
    const grandfathered = sessionFor(null)

    it("every module stays open for every existing company", () => {
        for (const mod of ALL_MODULES) {
            expect(requireFeature(grandfathered, mod, { onDeny: 'lock' }).allowed, mod).toBe(true)
        }
    })

    it("no API path is refused for a grandfathered company", () => {
        for (const path of [
            '/api/tasks', '/api/obligations', '/api/clients', '/api/vendors',
            '/api/day-off-requests', '/api/users/abc/bonus', '/api/users/abc/salary-history',
            '/api/tasks/abc/penalty', '/api/tasks/payment/bulk',
        ]) {
            const mod = moduleForApiPath(path)
            if (mod === null) continue
            expect(requireFeature(grandfathered, mod, { onDeny: 'lock' }).allowed, path).toBe(true)
        }
    })

    it("no sidebar entry is locked for a grandfathered company", () => {
        for (const href of [
            '/dashboard/tasks', '/dashboard/obligations', '/dashboard/clients',
            '/dashboard/vendors', '/dashboard/costs', '/dashboard/day-off-requests',
        ]) {
            const mod = moduleForPagePath(href)!
            expect(requireFeature(grandfathered, mod, { onDeny: 'lock' }).allowed, href).toBe(true)
        }
    })

    it("the first company to be packaged is the first to see any change", () => {
        // Assigning Company Management alone is what turns the gates on, and
        // only for that company.
        for (const mod of ['DAY_OFF', 'PAYROLL', 'SALARY_ADJUSTMENTS'] as const) {
            expect(requireFeature(sessionFor(CM), mod, { onDeny: 'lock' }).allowed, mod).toBe(false)
            expect(requireFeature(grandfathered, mod, { onDeny: 'lock' }).allowed, mod).toBe(true)
        }
    })
})

describe("the locked screen's copy", () => {
    for (const key of ['module_locked_title', 'module_locked_body', 'back_to_dashboard', 'bundle_hr', 'bundle_company_management']) {
        it(key, () => {
            expect(en).toHaveProperty(key)
            expect(ar).toHaveProperty(key)
        })
    }

    it("keeps the {bundle} placeholder in both locales", () => {
        // Rendered with .replace('{bundle}', …) — a translation that drops the
        // token leaves the customer told they are missing something unnamed.
        expect(en.module_locked_body).toContain('{bundle}')
        expect(ar.module_locked_body).toContain('{bundle}')
    })
})
