import { beforeEach, describe, it, expect, vi } from "vitest"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { serializeAccess, type Bundle } from "./bundles"

/**
 * A module's page, opened by its address where the company's package doesn't
 * include it (DESIGN.md §5.1, §5.5): it says it can't be opened, and why. It
 * was a card naming the bundle to buy, under a padlock emoji, as the side
 * bar's faded entry was a way to find out what else the product does
 * (decided otherwise by the product owner on 2026-11-05).
 */

const state = { session: null as unknown, attempts: [] as unknown[][] }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/feature-access.service", () => ({
    FeatureAccessService: { recordAttempt: async (...args: unknown[]) => { state.attempts.push(args) } },
}))
vi.mock("@/components/AccessDenied", () => ({ default: function AccessDenied() { return null } }))

const company = (...bundles: Bundle[]) => ({ user: { id: "u1", role: "ADMIN", companyId: "c1", featureAccess: serializeAccess({ unrestricted: false, bundles: new Set(bundles) }) } })

beforeEach(() => { state.attempts = [] })

describe("a module's page the package doesn't include", () => {
    it("says it can't be opened because of the package, and still counts the attempt", async () => {
        const { guardModule } = await import("./guard")
        const AccessDenied = (await import("@/components/AccessDenied")).default
        state.session = company("COMPANY_MANAGEMENT")
        const shown = await guardModule("PAYROLL") as { type: unknown; props: Record<string, unknown> }
        expect(shown.type).toBe(AccessDenied)
        expect(shown.props).toEqual({ notInPackage: true })
        expect(state.attempts).toEqual([["c1", "PAYROLL"]])
    })

    it("lets the page be where the package includes it", async () => {
        const { guardModule } = await import("./guard")
        state.session = company("COMPANY_MANAGEMENT", "HR")
        expect(await guardModule("PAYROLL")).toBeNull()
        expect(state.attempts).toEqual([])
    })

    it("leaves nothing of the locked screen behind", () => {
        expect(existsSync("components/LockedModule.tsx")).toBe(false)
        const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
            const path = join(dir, name)
            return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : []
        })
        for (const file of [...files("app"), ...files("components"), ...files("lib")]) {
            if (file.endsWith(".test.ts")) continue
            const src = readFileSync(file, "utf8")
            expect(src, file).not.toMatch(/LockedModule\b(?!Attempt)|module_locked_title|module_locked_body/)
        }
    })
})

describe("an employee's history, and adding a bonus or a deduction", () => {
    // HR's pages under the employee directory, which is Core: reached from a
    // person's row in the list and, for their own history, the account menu.
    // Opened by their address, they showed their tabs and forms, and every
    // part of them was refused.
    const pages = [["history", "PAYROLL"], ["bonus", "SALARY_ADJUSTMENTS"], ["deduction", "SALARY_ADJUSTMENTS"]] as const

    it("say they can't be opened where the package doesn't include them", () => {
        for (const [page, module] of pages) {
            const layout = `app/(dashboard)/dashboard/employees/[id]/${page}/layout.tsx`
            expect(existsSync(layout), layout).toBe(true)
            expect(readFileSync(layout, "utf8"), layout).toContain(`guardModule('${module}')`)
        }
    })

    it("aren't offered there", () => {
        const list = readFileSync("app/(dashboard)/dashboard/employees/page.tsx", "utf8")
        expect(list).toMatch(/features\.has\('PAYROLL'\) && can\('salary\.view'\)[^\n]*key: 'history'/)
        expect(list).toMatch(/features\.has\('SALARY_ADJUSTMENTS'\) && can\('salary_adjustments\.manage'\)[^\n]*\{\n\s*items\.push\(\{ key: 'bonus'/)
        const menu = readFileSync("components/DashboardHeader.tsx", "utf8")
        expect(menu).toMatch(/features\.has\('PAYROLL'\) && !\['ADMIN', 'SUPER_ADMIN'\]\.includes\(currentUser\.role\) && \(\s*<Link\s+href=\{`\/dashboard\/employees\/\$\{currentUser\.id\}\/history`\}/)
    })
})
