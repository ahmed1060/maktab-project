import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import bcrypt from "bcryptjs"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A new password ends the account's other sessions (lib/password-ends-
 * sessions.test.ts has why), against a real Postgres: what each way of
 * setting one writes. Its sessions end at their next check, as their
 * version is behind the account's; the one a person sets their own from is
 * kept, at the version it moved to.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const ADMIN_PASSWORD = "the-admins-own-password"
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Nile Works', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', '${bcrypt.hashSync(ADMIN_PASSWORD, 4)}', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1'),
 ('e4', 'e4@x', 'p', 'Eid', 'One', 'EMPLOYEE', 2026, 'e4', 'c1');
`
const SUPER_ADMIN = `INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa1', 'sa1@x', 'sa1', 'p', 'Sara', 'Adel', now());`
const NEW_PASSWORD = "a-new-password-123"

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1" })

describe.skipIf(!ADMIN_URL)("a new password, in Postgres", () => {
    const dbName = `password_sessions_test_${Date.now()}`
    let db: Client
    let Users: typeof import("@/lib/services/user.service").UserService
    let prisma: typeof import("@/lib/prisma").prisma
    let isKept: typeof import("@/lib/session-kept").isKept

    const account = async (id: string, table = "User") =>
        (await db.query(`SELECT "sessionVersion", "keptSession", "mustChangePassword" FROM "${table}" WHERE id = $1`, [id])).rows[0]

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        // Before the migrations that give everyone their company's roles.
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(SUPER_ADMIN)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Users = (await import("@/lib/services/user.service")).UserService
        prisma = (await import("@/lib/prisma")).prisma
        isKept = (await import("@/lib/session-kept")).isKept
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("an Admin gives as a temporary one ends the person's sessions", async () => {
        await Users.resetPassword("e1", admin.user, ADMIN_PASSWORD)
        expect(await account("e1")).toEqual({ sessionVersion: 1, keptSession: null, mustChangePassword: true })
    })

    it("an Admin sets on somebody's profile ends all of theirs, and keeps none", async () => {
        await Users.update({ id: "e2", password: NEW_PASSWORD } as any, admin)
        expect(await account("e2")).toEqual({ sessionVersion: 1, keptSession: null, mustChangePassword: false })
    })

    it("of one's own ends the account's other sessions, and keeps the one it was set from", async () => {
        const e3 = as({ id: "e3", role: "EMPLOYEE", companyId: "c1" })
        await Users.update({ id: "e3", password: NEW_PASSWORD } as any, e3, { sid: "mine", sessionVersion: 0 })
        let row = await account("e3")
        expect(row).toEqual({ sessionVersion: 1, keptSession: "1:mine", mustChangePassword: false })
        expect(isKept(row, { sid: "mine" })).toBe(true)
        expect(isKept(row, { sid: "theirs" })).toBe(false)

        // Again, before its cookie has caught up with the first: still kept.
        await Users.update({ id: "e3", password: `${NEW_PASSWORD}-2` } as any, e3, { sid: "mine", sessionVersion: 0 })
        row = await account("e3")
        expect(row.sessionVersion).toBe(2)
        expect(isKept(row, { sid: "mine" })).toBe(true)

        // From a session the account had already ended: it ends with the rest.
        await Users.update({ id: "e3", password: `${NEW_PASSWORD}-3` } as any, e3, { sid: "theirs", sessionVersion: 0 })
        row = await account("e3")
        expect(row.sessionVersion).toBe(3)
        expect(isKept(row, { sid: "theirs" })).toBe(false)
        expect(isKept(row, { sid: "mine" })).toBe(false)
    })

    it("of a Super Admin's own does the same", async () => {
        await Users.update({ id: "sa1", password: NEW_PASSWORD } as any, as({ id: "sa1", role: "SUPER_ADMIN", companyId: null }), { sid: "mine", sessionVersion: 0 })
        expect(await account("sa1", "SuperAdmin")).toEqual({ sessionVersion: 1, keptSession: "1:mine", mustChangePassword: false })
    })

    it("isn't in a save without one, which ends nothing", async () => {
        await Users.update({ id: "e4", gender: "FEMALE" } as any, admin)
        expect(await account("e4")).toEqual({ sessionVersion: 0, keptSession: null, mustChangePassword: false })
    })

    it("leaves the sessions out of what the audit log says changed", async () => {
        const { rows } = await db.query(`SELECT details FROM "AuditLog" WHERE "entityId" IN ('e1', 'e2', 'e3', 'e4', 'sa1')`)
        for (const { details } of rows) {
            expect(details).not.toHaveProperty("sessionVersion")
            expect(details).not.toHaveProperty("keptSession")
        }
        // What did change is there as before.
        expect(rows.map(r => r.details)).toContainEqual({ gender: { old: "MALE", new: "FEMALE" } })
    })
})
