import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { Prisma } from "@prisma/client"

/**
 * The attendance add-ons on a package (ATTENDANCE_PLAN.md §16): sold one or
 * both, and only on top of HR. Turning HR off turns both off; asking for one
 * without HR is refused; the audit log shows an add-on that went off with HR.
 */

type Row = {
    id: string; name: string; hasHR: boolean; hasCompanyManagement: boolean
    hasAttendanceTerminals: boolean; hasAttendanceMobile: boolean; isActive: boolean
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
    id: "p1", name: "Pro", hasHR: true, hasCompanyManagement: true,
    hasAttendanceTerminals: true, hasAttendanceMobile: false, isActive: true,
    priceMonthly: new Prisma.Decimal(10), priceAnnual: new Prisma.Decimal(100), priceLifetime: null,
    _count: { companies: 3 }, ...over,
})

beforeEach(() => { state.row = pkg(); state.written = null; state.logged = [] })

describe("creating a package", () => {
    const base = { name: "P", priceMonthly: 1, priceAnnual: 10, hasCompanyManagement: false }

    it("refuses an attendance add-on without HR", async () => {
        const { createPackageSchema } = await import("./validations/package.schema")
        for (const addOn of [{ hasAttendanceTerminals: true }, { hasAttendanceMobile: true }]) {
            expect(createPackageSchema.safeParse({ ...base, hasHR: false, ...addOn }).success, JSON.stringify(addOn)).toBe(false)
            expect(createPackageSchema.safeParse({ ...base, hasHR: true, ...addOn }).success, JSON.stringify(addOn)).toBe(true)
        }
    })

    it("treats a package that never mentions attendance as having none", async () => {
        const { createPackageSchema } = await import("./validations/package.schema")
        const parsed = createPackageSchema.parse({ ...base, hasHR: true })
        expect(parsed.hasAttendanceTerminals).toBe(false)
        expect(parsed.hasAttendanceMobile).toBe(false)
    })

    it("stores and logs the add-ons it was given", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = null
        const created = await PackageService.create({ ...base, hasHR: true, hasAttendanceTerminals: false, hasAttendanceMobile: true, isActive: true, isPublic: true }, session)
        expect(created.hasAttendanceMobile).toBe(true)
        expect(state.logged[0][3].details).toMatchObject({ hasAttendanceMobile: true, hasAttendanceTerminals: false })
    })
})

describe("editing a package", () => {
    it("turns both add-ons off when HR goes off, and logs it", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = pkg({ hasAttendanceMobile: true })
        await PackageService.update({ id: "p1", hasHR: false }, session)
        expect(state.written).toMatchObject({ hasHR: false, hasAttendanceTerminals: false, hasAttendanceMobile: false })
        expect(state.logged[0][3].details.bundleChanges).toEqual({
            hasHR: { from: true, to: false },
            hasAttendanceTerminals: { from: true, to: false },
            hasAttendanceMobile: { from: true, to: false },
        })
    })

    it("refuses an add-on on a package that will not have HR", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = pkg({ hasHR: false, hasAttendanceTerminals: false })
        await expect(PackageService.update({ id: "p1", hasAttendanceMobile: true }, session)).rejects.toThrow("ATTENDANCE_REQUIRES_HR")
        await expect(PackageService.update({ id: "p1", hasHR: false, hasAttendanceTerminals: true }, session)).rejects.toThrow("ATTENDANCE_REQUIRES_HR")
        expect(state.written).toBeNull()
    })

    it("allows HR and an add-on to be switched on together", async () => {
        const { PackageService } = await import("./services/package.service")
        state.row = pkg({ hasHR: false, hasAttendanceTerminals: false })
        await PackageService.update({ id: "p1", hasHR: true, hasAttendanceMobile: true }, session)
        expect(state.written).toMatchObject({ hasHR: true, hasAttendanceMobile: true })
    })

    it("leaves the add-ons alone when the edit is about something else", async () => {
        const { PackageService } = await import("./services/package.service")
        await PackageService.update({ id: "p1", name: "Pro 2" }, session)
        expect(state.written).not.toHaveProperty("hasAttendanceTerminals")
        expect(state.logged[0][3].details.bundleChanges).toBeUndefined()
    })

    it("answers the refusal as a 400, not a fault", async () => {
        const { knownRefusal } = await import("./api-errors")
        expect(knownRefusal(new Error("ATTENDANCE_REQUIRES_HR"))?.status).toBe(400)
    })
})

describe("the database holds the same rule", () => {
    it("has a check that refuses an add-on without HR", () => {
        const migration = readFileSync("prisma/migrations/20261007000000_attendance_addons/migration.sql", "utf8")
        expect(migration).toMatch(/CHECK \("hasHR" OR NOT \("hasAttendanceTerminals" OR "hasAttendanceMobile"\)\)/)
    })
})

describe("every place a package's bundles reach the session", () => {
    it("reads the add-ons too, so a company that bought one is not locked out of it", () => {
        // A select that names only hasCompanyManagement and hasHR resolves
        // every packaged company to "no attendance", whatever it bought.
        for (const file of ["lib/auth.ts", "lib/services/role.service.ts"]) {
            const source = readFileSync(file, "utf8")
            const selects = source.match(/package: \{ select: \{[^}]*\} \}/g) ?? []
            expect(selects.length, file).toBeGreaterThan(0)
            for (const select of selects) {
                expect(select, file).toContain("hasAttendanceTerminals: true")
                expect(select, file).toContain("hasAttendanceMobile: true")
            }
        }
    })
})
