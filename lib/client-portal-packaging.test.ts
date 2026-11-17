import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { Prisma } from "@prisma/client"

/**
 * The client portal add-on on a package (CLIENT_PORTAL_PLAN.md §2, PR 310):
 * sold only on top of Company Management, where clients are. Turning Company
 * Management off turns it off; asking for it without Company Management is
 * refused; the audit log shows it going off with Company Management.
 */

type Row = {
    id: string; name: string; hasHR: boolean; hasCompanyManagement: boolean
    hasAttendanceTerminals: boolean; hasAttendanceMobile: boolean; hasClientPortal: boolean; isActive: boolean
    priceMonthly: Prisma.Decimal; priceAnnual: Prisma.Decimal; priceLifetime: Prisma.Decimal | null
    _count: { companies: number }
}

const state = { row: null as Row | null, written: null as Record<string, unknown> | null, logged: [] as any[] }

vi.mock("@/lib/prisma", () => ({
    prisma: {
        package: {
            findUnique: async ({ where }: any) => (where.id ? state.row : null),
            create: async ({ data }: any) => ({ id: "new", ...data, priceMonthly: new Prisma.Decimal(data.priceMonthly), priceAnnual: new Prisma.Decimal(data.priceAnnual), priceLifetime: null }),
            update: async ({ data }: any) => {
                state.written = data
                return { ...state.row!, ...data }
            },
        },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async (...args: any[]) => { state.logged.push(args) } },
}))

const session = { user: { id: "sa", role: "SUPER_ADMIN" } }
const pkg = (over: Partial<Row> = {}): Row => ({
    id: "p1", name: "Offices", hasHR: false, hasCompanyManagement: true,
    hasAttendanceTerminals: false, hasAttendanceMobile: false, hasClientPortal: true, isActive: true,
    priceMonthly: new Prisma.Decimal(10), priceAnnual: new Prisma.Decimal(100), priceLifetime: null,
    _count: { companies: 2 }, ...over,
})

beforeEach(() => { state.row = pkg(); state.written = null; state.logged = [] })

describe("creating a package", () => {
    const base = { name: "P", priceMonthly: 1, priceAnnual: 10, hasHR: false }

    it("refuses the client portal without Company Management", async () => {
        const { createPackageSchema } = await import("./validations/package.schema")
        expect(createPackageSchema.safeParse({ ...base, hasCompanyManagement: false, hasClientPortal: true }).success).toBe(false)
        expect(createPackageSchema.safeParse({ ...base, hasCompanyManagement: true, hasClientPortal: true }).success).toBe(true)
        // HR is no substitute: clients are Company Management's.
        expect(createPackageSchema.safeParse({ ...base, hasHR: true, hasCompanyManagement: false, hasClientPortal: true }).success).toBe(false)
    })

    it("treats a package that never mentions it as not having it", async () => {
        const { createPackageSchema } = await import("./validations/package.schema")
        expect(createPackageSchema.parse({ ...base, hasCompanyManagement: true }).hasClientPortal).toBe(false)
    })

    it("stores and logs it", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = null
        const created = await PackageService.create({ ...base, hasCompanyManagement: true, hasAttendanceTerminals: false, hasAttendanceMobile: false, hasClientPortal: true, isActive: true, isPublic: true }, session)
        expect(created.hasClientPortal).toBe(true)
        expect(state.logged[0][3].details).toMatchObject({ hasClientPortal: true })
    })
})

describe("editing a package", () => {
    it("turns it off when Company Management goes off, and logs it", async () => {
        const { PackageService } = await import("./services/package.service")
        await PackageService.update({ id: "p1", hasCompanyManagement: false }, session)
        expect(state.written).toMatchObject({ hasCompanyManagement: false, hasClientPortal: false })
        expect(state.logged[0][3].details.bundleChanges).toMatchObject({
            hasCompanyManagement: { from: true, to: false },
            hasClientPortal: { from: true, to: false },
        })
    })

    it("refuses it on a package that will not have Company Management", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = pkg({ hasCompanyManagement: false, hasClientPortal: false })
        await expect(PackageService.update({ id: "p1", hasClientPortal: true }, session)).rejects.toThrow("CLIENT_PORTAL_REQUIRES_COMPANY_MANAGEMENT")
        state.row = pkg()
        await expect(PackageService.update({ id: "p1", hasCompanyManagement: false, hasClientPortal: true }, session)).rejects.toThrow("CLIENT_PORTAL_REQUIRES_COMPANY_MANAGEMENT")
        expect(state.written).toBeNull()
    })

    it("allows Company Management and the client portal to be switched on together", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = pkg({ hasCompanyManagement: false, hasClientPortal: false })
        await PackageService.update({ id: "p1", hasCompanyManagement: true, hasClientPortal: true }, session)
        expect(state.written).toMatchObject({ hasCompanyManagement: true, hasClientPortal: true })
        expect(state.logged[0][3].details.bundleChanges).toMatchObject({ hasClientPortal: { from: false, to: true } })
    })

    it("leaves it alone when the edit is about something else, HR going off included", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = pkg({ hasHR: true })
        await PackageService.update({ id: "p1", name: "Renamed" }, session)
        expect(state.written).not.toHaveProperty("hasClientPortal")
        expect(state.logged[0][3].details.bundleChanges).toBeUndefined()
        await PackageService.update({ id: "p1", hasHR: false }, session)
        expect(state.written).not.toHaveProperty("hasClientPortal")
    })

    it("answers the refusal as a 400, not a fault", async () => {
        const { knownRefusal } = await import("./api-errors")
        expect(knownRefusal(new Error("CLIENT_PORTAL_REQUIRES_COMPANY_MANAGEMENT"))?.status).toBe(400)
    })
})

describe("the database holds the same rule", () => {
    const migration = readFileSync("prisma/migrations/20270101000000_client_portal_addon/migration.sql", "utf8")

    it("adds the switch, off for every package there", () => {
        expect(migration).toMatch(/ADD COLUMN\s+"hasClientPortal" BOOLEAN NOT NULL DEFAULT false/)
        expect(readFileSync("prisma/schema.prisma", "utf8")).toMatch(/hasClientPortal\s+Boolean\s+@default\(false\)/)
    })

    it("has a check that refuses it without Company Management", () => {
        expect(migration).toMatch(/CHECK \("hasCompanyManagement" OR NOT "hasClientPortal"\)/)
    })

    it("changes nothing else: additive, as previews migrate production", () => {
        expect(migration).not.toMatch(/\bDROP\b|\bDELETE\b|\bUPDATE\b|\bRENAME\b/i)
    })
})

describe("every place a package's bundles are read", () => {
    it("reads the client portal too, so a company that bought it is not locked out of it", () => {
        // A select that leaves it out resolves every packaged company to
        // "no client portal", whatever it bought.
        for (const file of ["lib/auth.ts", "lib/services/role.service.ts", "lib/services/company.service.ts", "lib/services/company-package.ts", "app/api/companies/route.ts", "app/api/company-settings/route.ts"]) {
            const source = readFileSync(file, "utf8")
            const selects = source.match(/select: \{[^{}]*hasCompanyManagement: true[^{}]*\}/g) ?? []
            expect(selects.length, file).toBeGreaterThan(0)
            for (const select of selects) expect(select, file).toContain("hasClientPortal: true")
        }
    })

    it("names it among what a package has, on its card and a company's row", async () => {
        const { bundleLabelKeys } = await import("./subscription-display")
        expect(bundleLabelKeys({ hasCompanyManagement: true, hasHR: false, hasClientPortal: true })).toEqual(["bundle_company_management", "bundle_client_portal"])
        expect(bundleLabelKeys({ hasCompanyManagement: true, hasHR: false })).toEqual(["bundle_company_management"])
    })
})
