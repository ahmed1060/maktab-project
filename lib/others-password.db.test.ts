import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import bcrypt from "bcryptjs"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Somebody else's password or email needs the saver's own password, checked
 * by the server (PR 231). The profile asks for it before every save, but only
 * in the browser (/api/auth/verify), and the save didn't: a session someone
 * else held could set a person's password, or their email and then reset it,
 * and sign in as them. They're the two ways into an account, which a
 * temporary password already asks the saver's own for (resetPassword).
 *
 * The rest of a profile isn't asked for it here: a new salary asks for a
 * recent authenticator code (lib/step-up.ts), and the photo and a suspension
 * are saved on their own. Wrong tries are counted with the rest of one's own
 * (lib/own-password.ts): five in fifteen minutes, then none.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const MINE = "the-savers-own-password"
const THEIRS = "the-persons-own-password"
const NEW_PASSWORD = "a-new-password-123"
const mine = bcrypt.hashSync(MINE, 4)
const theirs = bcrypt.hashSync(THEIRS, 4)
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Nile Works', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', '${mine}', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('a2', 'a2@x', '${mine}', 'Aya', 'Two', 'ADMIN', 2026, 'a2', 'c1'),
 ('e1', 'e1@x', '${theirs}', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', '${theirs}', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', '${theirs}', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1'),
 ('e4', 'e4@x', '${theirs}', 'Eid', 'One', 'EMPLOYEE', 2026, 'e4', 'c1'),
 ('e5', 'e5@x', '${theirs}', 'Ezz', 'One', 'EMPLOYEE', 2026, 'e5', 'c1');
`
const SUPER_ADMINS = `INSERT INTO "SuperAdmin"(id, email, username, password, "firstName", "lastName", "updatedAt") VALUES
 ('sa1', 'sa1@x', 'sa1', '${mine}', 'Sara', 'Adel', now()),
 ('sa2', 'sa2@x', 'sa2', '${theirs}', 'Sami', 'Adel', now());`

const as = (user: Record<string, unknown>) => ({ user: { ...withGrants(user as any), mfaEnabled: true, stepUpAt: Date.now() } }) as any
const admin = as({ id: "a1", role: "ADMIN", companyId: "c1" })
const superAdmin = as({ id: "sa1", role: "SUPER_ADMIN", companyId: null })

describe.skipIf(!ADMIN_URL)("the saver's own password, for somebody else's password or email, in Postgres", () => {
    const dbName = `others_password_test_${Date.now()}`
    let db: Client
    let Users: typeof import("@/lib/services/user.service").UserService
    let prisma: typeof import("@/lib/prisma").prisma

    const row = async (id: string, table = "User") =>
        (await db.query(`SELECT email, password, "firstName", "sessionVersion" FROM "${table}" WHERE id = $1`, [id])).rows[0]
    const tries = async (id: string) =>
        (await db.query(`SELECT count FROM "RateLimit" WHERE key LIKE $1`, [`%own-password:${id}`])).rows[0]?.count ?? 0
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
        await db.query(SUPER_ADMINS)
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

    it("is asked of whoever sets somebody else's password: without it, or wrong, nothing is written", async () => {
        const before = await row("e1")
        expect(await refusal(Users.update({ id: "e1", password: NEW_PASSWORD } as any, admin))).toBe("OWN_PASSWORD_WRONG")
        // Theirs isn't it: it's the saver's own that's asked.
        expect(await refusal(Users.update({ id: "e1", password: NEW_PASSWORD, confirmPassword: THEIRS } as any, admin))).toBe("OWN_PASSWORD_WRONG")
        expect(await row("e1")).toEqual(before)
        // Only the wrong one was a guess.
        expect(await tries("a1")).toBe(1)

        await Users.update({ id: "e1", password: NEW_PASSWORD, confirmPassword: MINE } as any, admin)
        const after = await row("e1")
        expect(await bcrypt.compare(NEW_PASSWORD, after.password)).toBe(true)
        expect(after.sessionVersion).toBe(1)
        // And the right one gave its try back.
        expect(await tries("a1")).toBe(1)
    })

    it("is asked for somebody else's new email too", async () => {
        expect(await refusal(Users.update({ id: "e2", email: "e2-new@x" } as any, admin))).toBe("OWN_PASSWORD_WRONG")
        expect((await row("e2")).email).toBe("e2@x")
        await Users.update({ id: "e2", email: "e2-new@x", confirmPassword: MINE } as any, admin)
        expect((await row("e2")).email).toBe("e2-new@x")
    })

    it("isn't asked for the rest of their profile, nor for their email sent as it is", async () => {
        await Users.update({ id: "e3", firstName: "Essam", lastName: "Two", email: "e3@x", gender: "MALE" } as any, admin)
        expect(await row("e3")).toMatchObject({ email: "e3@x", sessionVersion: 0 })
    })

    it("is a Super Admin's own, for a company's people and another Super Admin alike", async () => {
        expect(await refusal(Users.update({ id: "e4", password: NEW_PASSWORD, confirmPassword: THEIRS } as any, superAdmin))).toBe("OWN_PASSWORD_WRONG")
        await Users.update({ id: "e4", password: NEW_PASSWORD, confirmPassword: MINE } as any, superAdmin)
        expect(await bcrypt.compare(NEW_PASSWORD, (await row("e4")).password)).toBe(true)

        expect(await refusal(Users.update({ id: "sa2", email: "sa2-new@x" } as any, superAdmin))).toBe("OWN_PASSWORD_WRONG")
        await Users.update({ id: "sa2", email: "sa2-new@x", confirmPassword: MINE } as any, superAdmin)
        expect((await row("sa2", "SuperAdmin")).email).toBe("sa2-new@x")
    })

    it("isn't counted where the save is refused anyway", async () => {
        // A Super Admin's account isn't a company Admin's to change.
        const admin2 = as({ id: "a2", role: "ADMIN", companyId: "c1" })
        expect(await refusal(Users.update({ id: "sa1", password: NEW_PASSWORD, confirmPassword: "not-it-at-all" } as any, admin2))).toBe("FORBIDDEN")
        expect(await tries("a2")).toBe(0)
    })

    it("counts its wrong tries with the rest of one's own: five, then none, right or wrong", async () => {
        const admin2 = as({ id: "a2", role: "ADMIN", companyId: "c1" })
        for (let i = 0; i < 3; i++) expect(await refusal(Users.update({ id: "e5", password: NEW_PASSWORD, confirmPassword: "not-it-at-all" } as any, admin2))).toBe("OWN_PASSWORD_WRONG")
        for (let i = 0; i < 2; i++) expect(await Users.verifyPassword("a2", "not-it-at-all")).toEqual({ valid: false })

        // The right one, now, is refused too, and nothing is written.
        const before = await row("e5")
        expect(await refusal(Users.update({ id: "e5", password: NEW_PASSWORD, confirmPassword: MINE } as any, admin2))).toBe("OWN_PASSWORD_TRIES")
        expect(await refusal(Users.update({ id: "e5", email: "e5-new@x", confirmPassword: MINE } as any, admin2))).toBe("OWN_PASSWORD_TRIES")
        expect(await refusal(Users.resetPassword("e5", admin2.user, MINE))).toBe("OWN_PASSWORD_TRIES")
        expect(await row("e5")).toEqual(before)

        // The person's own are theirs: their tries are untouched.
        expect(await Users.verifyPassword("e5", THEIRS)).toEqual({ valid: true })
    })
})
