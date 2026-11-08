import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import bcrypt from "bcryptjs"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * A new password of one's own needs the current one, checked by the server
 * (PR 229). The profile asked for it before a save, but only in the browser
 * (/api/auth/verify), and the save itself didn't: a session someone else held
 * could set a new password without knowing the old one, and since PR 228 that
 * ends the owner's other sessions too.
 *
 * The forced change after a temporary password doesn't ask again for the one
 * just used to sign in, from a session signed in since it was given. Wrong
 * tries at one's own password are counted per account, the profile's check
 * and the save together: five in fifteen minutes, then none until the
 * fifteen minutes are up.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const CURRENT = "the-current-password"
const NEW_PASSWORD = "a-new-password-123"
const hash = bcrypt.hashSync(CURRENT, 4)
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Nile Works', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', '${hash}', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('a2', 'a2@x', '${hash}', 'Aya', 'Two', 'ADMIN', 2026, 'a2', 'c1'),
 ('e1', 'e1@x', '${hash}', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', '${hash}', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', '${hash}', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1'),
 ('e4', 'e4@x', '${hash}', 'Eid', 'One', 'EMPLOYEE', 2026, 'e4', 'c1'),
 ('e5', 'e5@x', '${hash}', 'Ezz', 'One', 'EMPLOYEE', 2026, 'e5', 'c1'),
 ('e6', 'e6@x', '${hash}', 'Eslam', 'One', 'EMPLOYEE', 2026, 'e6', 'c1'),
 ('e7', 'e7@x', '${hash}', 'Emad', 'One', 'EMPLOYEE', 2026, 'e7', 'c1');
`
const SUPER_ADMIN = `INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES ('sa1', 'sa1@x', 'sa1', '${hash}', 'Sara', 'Adel', now());`

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const employee = (id: string) => as({ id, role: "EMPLOYEE", companyId: "c1" })
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1" })

describe.skipIf(!ADMIN_URL)("one's own current password, checked by the server, in Postgres", () => {
    const dbName = `own_password_test_${Date.now()}`
    let db: Client
    let Users: typeof import("@/lib/services/user.service").UserService
    let prisma: typeof import("@/lib/prisma").prisma

    const row = async (id: string, table = "User") =>
        (await db.query(`SELECT password, "sessionVersion", "mustChangePassword" FROM "${table}" WHERE id = $1`, [id])).rows[0]
    const refusal = (p: Promise<unknown>) => p.then(() => "saved", (e: Error) => e.message)

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
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("is asked for a new password of one's own: without it, or wrong, nothing is written", async () => {
        const before = await row("e1")
        expect(await refusal(Users.update({ id: "e1", password: NEW_PASSWORD } as any, employee("e1"), { sid: "mine", sessionVersion: 0 }))).toBe("CURRENT_PASSWORD_WRONG")
        expect(await refusal(Users.update({ id: "e1", password: NEW_PASSWORD, currentPassword: "not-it-at-all" } as any, employee("e1"), { sid: "mine", sessionVersion: 0 }))).toBe("CURRENT_PASSWORD_WRONG")
        expect(await row("e1")).toEqual(before)
    })

    it("saves it with the current one", async () => {
        await Users.update({ id: "e2", password: NEW_PASSWORD, currentPassword: CURRENT } as any, employee("e2"), { sid: "mine", sessionVersion: 0 })
        const after = await row("e2")
        expect(await bcrypt.compare(NEW_PASSWORD, after.password)).toBe(true)
        expect(after.sessionVersion).toBe(1)
    })

    it("asks a Super Admin for theirs the same way", async () => {
        const sa = as({ id: "sa1", role: "SUPER_ADMIN", companyId: null })
        expect(await refusal(Users.update({ id: "sa1", password: NEW_PASSWORD, currentPassword: "not-it-at-all" } as any, sa, { sid: "mine", sessionVersion: 0 }))).toBe("CURRENT_PASSWORD_WRONG")
        await Users.update({ id: "sa1", password: NEW_PASSWORD, currentPassword: CURRENT } as any, sa, { sid: "mine", sessionVersion: 0 })
        expect(await bcrypt.compare(NEW_PASSWORD, (await row("sa1", "SuperAdmin")).password)).toBe(true)
    })

    it("isn't asked of an Admin setting somebody else's, which isn't theirs to know", async () => {
        await Users.update({ id: "e3", password: NEW_PASSWORD } as any, admin)
        expect(await bcrypt.compare(NEW_PASSWORD, (await row("e3")).password)).toBe(true)
    })

    it("isn't asked again on the forced change, from a session signed in with the temporary password", async () => {
        const { password: temporary } = await Users.resetPassword("e4", admin.user, CURRENT)
        const given = await row("e4")
        expect(given).toMatchObject({ sessionVersion: 1, mustChangePassword: true })

        // A session from before the temporary password, which it ended, is asked.
        expect(await refusal(Users.update({ id: "e4", password: NEW_PASSWORD } as any, employee("e4"), { sid: "theirs", sessionVersion: 0 }))).toBe("CURRENT_PASSWORD_WRONG")
        expect(await row("e4")).toEqual(given)

        // One signed in with it since isn't.
        await Users.update({ id: "e4", password: NEW_PASSWORD } as any, employee("e4"), { sid: "mine", sessionVersion: 1 })
        const after = await row("e4")
        expect(await bcrypt.compare(NEW_PASSWORD, after.password)).toBe(true)
        expect(await bcrypt.compare(temporary, after.password)).toBe(false)
        expect(after.mustChangePassword).toBe(false)
    })

    it("takes five wrong tries, the profile's check and the save together, then none for fifteen minutes", async () => {
        for (let i = 0; i < 3; i++) expect(await Users.verifyPassword("e5", "not-it-at-all")).toEqual({ valid: false })
        for (let i = 0; i < 2; i++) expect(await refusal(Users.update({ id: "e5", password: NEW_PASSWORD, currentPassword: "not-it-at-all" } as any, employee("e5"), { sid: "mine", sessionVersion: 0 }))).toBe("CURRENT_PASSWORD_WRONG")

        // The right one, now, is refused too, and nothing is written.
        const before = await row("e5")
        expect(await refusal(Users.verifyPassword("e5", CURRENT))).toBe("OWN_PASSWORD_TRIES")
        expect(await refusal(Users.update({ id: "e5", password: NEW_PASSWORD, currentPassword: CURRENT } as any, employee("e5"), { sid: "mine", sessionVersion: 0 }))).toBe("OWN_PASSWORD_TRIES")
        expect(await row("e5")).toEqual(before)

        // Each account's own: another's tries are untouched.
        expect(await Users.verifyPassword("e6", CURRENT)).toEqual({ valid: true })

        // Fifteen minutes on, it's asked again.
        await db.query(`UPDATE "RateLimit" SET "resetAt" = now() - interval '1 second' WHERE key LIKE '%e5%'`)
        expect(await Users.verifyPassword("e5", CURRENT)).toEqual({ valid: true })
    })

    it("counts an Admin's own, confirming a temporary password, with the rest", async () => {
        const admin2 = as({ id: "a2", role: "ADMIN", companyId: "c1" })
        for (let i = 0; i < 5; i++) expect(await refusal(Users.resetPassword("e3", admin2.user, "not-it-at-all"))).toBe("INVALID_ADMIN_PASSWORD")
        expect(await refusal(Users.resetPassword("e3", admin2.user, CURRENT))).toBe("OWN_PASSWORD_TRIES")
        expect(await refusal(Users.verifyPassword("a2", CURRENT))).toBe("OWN_PASSWORD_TRIES")
    })

    // Unlock, beside their status, lifts it before the fifteen minutes are up,
    // as it lifts a sign-in lock (decided 2026-11-08).
    it("says until when an account's tries are paused, for the list, and Unlock lifts them", async () => {
        const { ownPasswordPausedUntil, unpauseOwnPassword } = await import("@/lib/own-password")
        for (let i = 0; i < 4; i++) await Users.verifyPassword("e7", "not-it-at-all")
        expect((await ownPasswordPausedUntil(["e7", "e6"])).size).toBe(0)
        await Users.verifyPassword("e7", "not-it-at-all")
        const paused = await ownPasswordPausedUntil(["e7", "e6"])
        expect([...paused.keys()]).toEqual(["e7"])
        expect(paused.get("e7")!.getTime()).toBeGreaterThan(Date.now())
        expect(await refusal(Users.verifyPassword("e7", CURRENT))).toBe("OWN_PASSWORD_TRIES")

        await unpauseOwnPassword("e7")
        expect((await ownPasswordPausedUntil(["e7"])).size).toBe(0)
        expect(await Users.verifyPassword("e7", CURRENT)).toEqual({ valid: true })
    })

    it("counts only the wrong ones: the right ones give their try back", async () => {
        for (let i = 0; i < 8; i++) expect(await Users.verifyPassword("e6", CURRENT)).toEqual({ valid: true })
        expect(await Users.verifyPassword("e6", "not-it-at-all")).toEqual({ valid: false })
        expect(await Users.verifyPassword("e6", CURRENT)).toEqual({ valid: true })
    })
})
