import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The switch that turns off the high-risk confirmation (ROLES_PLAN.md §6.15,
 * decided on 2026-11-09), against a real Postgres. One on System settings
 * for every company, one on Company settings for each. Where both are on, a
 * high-risk action asks for a code, as before; off, it asks for nothing,
 * not even two-factor sign-in. A Super Admin follows the system's only.
 * Turning either asks for a code once, and is in the audit log.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ exists: async () => ({ data: true }), remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('a2', 'a2@x', 'p', 'Basma', 'Two', 'ADMIN', 2026, 'a2', 'c2', NULL);
`
const SUPER = `INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES ('sa1', 'sa1@x', 'p', 'Sara', 'Admin', 'sa1', now());`

const MINUTE = 60_000
type Who = Record<string, unknown>
/** A session: two-factor on and a code entered just now, or neither. */
const confirmed = (user: Who) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const noCode = (user: Who) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() - 120 * MINUTE } }) as any
const noTwoFactor = (user: Who) => ({ user: { ...withGrants(user as any), mfaEnabled: false, stepUpAt: null } }) as any

const AMAL = { id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One" }
const BASMA = { id: "a2", role: "ADMIN", companyId: "c2", name: "Basma Two" }
const SARA = { id: "sa1", role: "SUPER_ADMIN", name: "Sara Admin" }

describe.skipIf(!ADMIN_URL)("turning off the high-risk confirmation, in Postgres", () => {
    const dbName = `high_risk_switch_test_${Date.now()}`
    let db: Client
    let StepUp: typeof import("@/lib/step-up")
    let Companies: typeof import("@/lib/services/company.service").CompanyService
    let Settings: typeof import("@/lib/services/system-settings.service").SystemSettingsService
    let prisma: typeof import("@/lib/prisma").prisma

    const outcome = (p: Promise<unknown>) => p.then(() => "goes through", (e: Error & { code?: string }) => e.code ?? e.message)
    const asks = (session: unknown, permission = "tasks.pay") => outcome(StepUp.assertStepUp(session as any, permission as any))
    const companyOn = async (id: string) => (await db.query(`SELECT "confirmHighRisk" AS on FROM "Company" WHERE id = $1`, [id])).rows[0].on as boolean
    const setCompany = (id: string, on: boolean) => db.query(`UPDATE "Company" SET "confirmHighRisk" = $2 WHERE id = $1`, [id, on])
    const setSystem = (on: boolean) => db.query(`UPDATE "SystemSettings" SET "confirmHighRisk" = $1 WHERE id = 'default'`, [on])

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(SUPER)
        await db.query(`INSERT INTO "SystemSettings"(id, "updatedAt") VALUES ('default', now()) ON CONFLICT (id) DO NOTHING`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        StepUp = await import("@/lib/step-up")
        Companies = (await import("@/lib/services/company.service")).CompanyService
        Settings = (await import("@/lib/services/system-settings.service")).SystemSettingsService
        prisma = (await import("@/lib/prisma")).prisma
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("is on for every company, and the system, as the migration leaves them", async () => {
        expect(await companyOn("c1")).toBe(true)
        expect(await companyOn("c2")).toBe(true)
        expect((await Settings.get()).confirmHighRisk).toBe(true)
        expect(await asks(noCode(AMAL))).toBe("STEP_UP_REQUIRED")
        expect(await asks(noTwoFactor(AMAL))).toBe("MFA_ENROL_REQUIRED")
        expect(await asks(confirmed(AMAL))).toBe("goes through")
    })

    it("asks nothing in a company that turned it off, not even two-factor sign-in, and still asks in the others", async () => {
        await setCompany("c1", false)
        try {
            expect(await asks(noCode(AMAL))).toBe("goes through")
            expect(await asks(noTwoFactor(AMAL), "payroll.approve")).toBe("goes through")
            expect(await asks(noCode(BASMA))).toBe("STEP_UP_REQUIRED")
            // What isn't high-risk was never asked.
            expect(await asks(noTwoFactor(BASMA), "tasks.view")).toBe("goes through")
        } finally { await setCompany("c1", true) }
    })

    it("asks nothing in any company once the system's is off, whatever a company's says", async () => {
        await setSystem(false)
        try {
            expect(await asks(noCode(BASMA))).toBe("goes through")
            expect(await asks(noTwoFactor(BASMA), "cash_advances.give")).toBe("goes through")
        } finally { await setSystem(true) }
    })

    it("asks a Super Admin as the system's switch says, whatever the company's", async () => {
        await setCompany("c1", false)
        try {
            expect(await asks(noCode(SARA))).toBe("STEP_UP_REQUIRED")
            await setSystem(false)
            expect(await asks(noCode(SARA))).toBe("goes through")
        } finally {
            await setSystem(true)
            await setCompany("c1", true)
        }
    })

    it("still asks for the Super Admin's own actions with the system's off", async () => {
        await setSystem(false)
        try {
            expect(await outcome(StepUp.assertRecentStepUp(noCode(SARA)))).toBe("STEP_UP_REQUIRED")
        } finally { await setSystem(true) }
    })

    it("asks for a code to turn a company's off or on, and the audit says who, from what to what", async () => {
        // Without a code, or without two-factor sign-in: refused, and nothing changes.
        expect(await outcome(Companies.update({ id: "c1", confirmHighRisk: false } as any, noCode(AMAL)))).toBe("STEP_UP_REQUIRED")
        expect(await outcome(Companies.update({ id: "c1", confirmHighRisk: false } as any, noTwoFactor(AMAL)))).toBe("MFA_ENROL_REQUIRED")
        expect(await companyOn("c1")).toBe(true)
        // With one: off, then on again.
        expect(await outcome(Companies.update({ id: "c1", confirmHighRisk: false } as any, confirmed(AMAL)))).toBe("goes through")
        expect(await companyOn("c1")).toBe(false)
        // Turning it on asks too.
        expect(await outcome(Companies.update({ id: "c1", confirmHighRisk: true } as any, noCode(AMAL)))).toBe("STEP_UP_REQUIRED")
        expect(await companyOn("c1")).toBe(false)
        expect(await outcome(Companies.update({ id: "c1", confirmHighRisk: true } as any, confirmed(AMAL)))).toBe("goes through")
        expect(await companyOn("c1")).toBe(true)
        const logged = (await db.query(`SELECT "userId", details FROM "AuditLog" WHERE action::text = 'UPDATE_COMPANY' AND "entityId" = 'c1' AND details ? 'confirmHighRisk' ORDER BY "createdAt"`)).rows
        expect(logged.map(l => [l.userId, l.details.confirmHighRisk])).toEqual([
            ["a1", { old: true, new: false }],
            ["a1", { old: false, new: true }],
        ])
    })

    it("asks for nothing to save a company's other settings, or the switch as it already is", async () => {
        expect(await outcome(Companies.update({ id: "c2", autoVerifyLocation: true } as any, noCode(BASMA)))).toBe("goes through")
        expect(await outcome(Companies.update({ id: "c2", confirmHighRisk: true } as any, noTwoFactor(BASMA)))).toBe("goes through")
    })

    it("lets the Super Admin turn a company's off with a code, logged as theirs", async () => {
        expect(await outcome(Companies.update({ id: "c2", confirmHighRisk: false } as any, noCode(SARA)))).toBe("STEP_UP_REQUIRED")
        expect(await outcome(Companies.update({ id: "c2", confirmHighRisk: false } as any, confirmed(SARA)))).toBe("goes through")
        expect(await companyOn("c2")).toBe(false)
        const logged = (await db.query(`SELECT "userId", "superAdminId" FROM "AuditLog" WHERE action::text = 'UPDATE_COMPANY' AND "entityId" = 'c2' AND details ? 'confirmHighRisk'`)).rows
        expect(logged).toEqual([{ userId: null, superAdminId: "sa1" }])
        await setCompany("c2", true)
    })
})
