import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { builtInGrantsToken } from "@/lib/permissions/built-in"
import { serializeAccess, type Bundle } from "@/lib/features/bundles"
import { UserService } from "@/lib/services/user.service"

/**
 * Pay and a day off balance, where the company's package doesn't include
 * them (DESIGN.md §5.5, Page layout): Add employee and the profile no longer
 * ask for them, and the server doesn't write them either, whatever a request
 * sends, as it doesn't write what the sender's role may not set. Both were
 * written whatever the package. Against a real Postgres built from the
 * migrations.
 */

// A new pay figure asks for a code (ROLES_PLAN.md §6.15), which has its own
// tests; here it's what gets written.
vi.mock("@/lib/step-up", async importOriginal => ({ ...(await importOriginal<typeof import("@/lib/step-up")>()), assertStepUp: async () => {} }))

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

// Before the roles, so the company gets its built-in ones as it would.
const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", salary, "dayOffCredit", "baseDayOffCredit") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', 0, 0, 0),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 5000, 21, 21);
`

/** The company's Admin, under a package of these bundles. */
const admin = (...bundles: Bundle[]) => ({
    user: { id: "a1", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN"), featureAccess: serializeAccess({ unrestricted: false, bundles: new Set(bundles) }) },
})

describe.skipIf(!ADMIN_URL)("pay and day off credit the package doesn't include, in Postgres", () => {
    const dbName = `package_pay_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        await root.query(`CREATE DATABASE ${dbName}`)
        await root.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(BEFORE_ROLES)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const root = new Client({ connectionString: ADMIN_URL })
        await root.connect()
        await root.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await root.end()
    })

    const person = async (where: string, value: string) => {
        const { rows: [row] } = await db.query(`SELECT id, salary, "dayOffCredit", "baseDayOffCredit" FROM "User" WHERE ${where} = $1`, [value])
        return { id: row.id as string, salary: Number(row.salary), dayOffCredit: Number(row.dayOffCredit), baseDayOffCredit: Number(row.baseDayOffCredit) }
    }
    const rates = async (userId: string) => (await db.query(`SELECT "monthlyAmount" FROM "SalaryChange" WHERE "userId" = $1 ORDER BY "createdAt"`, [userId])).rows.map(r => Number(r.monthlyAmount))
    const hire = (email: string, session: ReturnType<typeof admin>) =>
        UserService.create({ firstName: "Nada", lastName: "Hired", email, password: "a-long-password-123", role: "EMPLOYEE", salary: 7000, dayOffCredit: 10 } as any, session)

    it("adds someone without the pay or day off credit sent, where the package hasn't HR", async () => {
        await hire("nada@x.co", admin("COMPANY_MANAGEMENT"))
        const hired = await person("email", "nada@x.co")
        expect(hired).toMatchObject({ salary: 0, dayOffCredit: 0, baseDayOffCredit: 0 })
        // Their pay history opens at nothing, as for whoever adds someone without the pay permission.
        expect(await rates(hired.id)).toEqual([0])
    })

    it("adds them with both where it has", async () => {
        await hire("hany@x.co", admin("COMPANY_MANAGEMENT", "HR"))
        const hired = await person("email", "hany@x.co")
        expect(hired).toMatchObject({ salary: 7000, dayOffCredit: 10, baseDayOffCredit: 10 })
        expect(await rates(hired.id)).toEqual([7000])
    })

    it("leaves someone's pay and day off credit as they are, where the package hasn't HR", async () => {
        await UserService.update({ id: "e1", salary: 9000, baseDayOffCredit: 30 } as any, admin("COMPANY_MANAGEMENT"))
        expect(await person("id", "e1")).toMatchObject({ salary: 5000, dayOffCredit: 21, baseDayOffCredit: 21 })
        expect(await rates("e1")).toEqual([])
    })

    it("changes them where it has", async () => {
        await UserService.update({ id: "e1", salary: 9000, baseDayOffCredit: 30 } as any, admin("COMPANY_MANAGEMENT", "HR"))
        expect(await person("id", "e1")).toMatchObject({ salary: 9000, dayOffCredit: 30, baseDayOffCredit: 30 })
        expect(await rates("e1")).toEqual([9000])
    })
})
