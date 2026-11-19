import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import bcrypt from "bcryptjs"

/**
 * Change password for one of a client's people (CLIENT_PORTAL_PLAN.md §5.3,
 * §12 step 7d-2; PR 335), against a real Postgres: the current password
 * checked, with the wrong tries a person's own password has; the new one
 * set, ending the account's other sessions and keeping the one it was set
 * from; and the audit log's entry under the client.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Al Amal Accounting', now());
`
const OFFICE = `
INSERT INTO "Package"(id, name, "hasCompanyManagement", "hasClientPortal", "updatedAt") VALUES ('portal', 'Portal', true, true, now());
UPDATE "Company" SET "packageId" = 'portal' WHERE id = 'c1';
INSERT INTO "Client"(id, "companyId", name, "ownerName", "mobileNumber", "locationName", "updatedAt") VALUES
 ('noor', 'c1', 'Al Noor Trading', 'Omar', '0100', 'Cairo', now());
`
const CURRENT = "their-current-password"
const NEW = "a-new-password-123"
const OTHER = "another-new-password-1"

describe.skipIf(!ADMIN_URL)("Change password for a client's person, in Postgres", () => {
    const dbName = `client_password_change_test_${Date.now()}`
    let db: Client
    let change: typeof import("@/lib/client-password-change").changeClientPassword
    let stands: typeof import("@/lib/client-sign-in").clientSessionStands
    let prisma: typeof import("@/lib/prisma").prisma

    let n = 0
    /** One of the client's people, their password set, at the session version given. */
    const person = async (sessionVersion = 0, password: string | null = CURRENT) => {
        n += 1
        const id = `acct-${n}`
        await db.query(`INSERT INTO "ClientAccount"(id, "companyId", "clientId", name, email, password, "activatedAt", "sessionVersion", "updatedAt") VALUES ($1, 'c1', 'noor', $2, $3, $4, $5, $6, now())`,
            [id, `Person ${n}`, `person${n}@client.co`, password && bcrypt.hashSync(password, 4), password && new Date(), sessionVersion])
        return { id, name: `Person ${n}`, email: `person${n}@client.co` }
    }
    const row = async (id: string) => (await db.query(`SELECT password, "sessionVersion", "keptSession" FROM "ClientAccount" WHERE id = $1`, [id])).rows[0]
    const logged = async (id: string) => (await db.query(`SELECT action, "entityType", "entityId", details, "userId", "superAdminId" FROM "AuditLog" WHERE action = 'CLIENT_PASSWORD_CHANGE' AND details->>'account' = $1`, [id])).rows
    const sent = (current: string, password = NEW) => ({ currentPassword: current, newPassword: password, confirmPassword: password })
    const why = (p: Promise<unknown>) => p.then(() => "changed", (error: Error) => error.message)

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
        await db.query(OFFICE)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        change = (await import("@/lib/client-password-change")).changeClientPassword
        stands = (await import("@/lib/client-sign-in")).clientSessionStands
        prisma = (await import("@/lib/prisma")).prisma
    }, 120_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("the current password right: the new one is set, the other sessions end, and the one it's set from is kept", async () => {
        const p = await person(2)
        await change(p.id, { sid: "sid-a", sessionVersion: 2 }, sent(CURRENT))
        const after = await row(p.id)
        expect(bcrypt.compareSync(NEW, after.password)).toBe(true)
        expect(after.sessionVersion).toBe(3)
        expect(after.keptSession).toBe("3:sid-a")
        // At the next minute's check: this session stands, at the new version; any other ends.
        const mine = { sub: p.id, sid: "sid-a", sessionVersion: 2 } as any
        expect(await stands(mine)).toBe(true)
        expect(mine.sessionVersion).toBe(3)
        expect(await stands({ sub: p.id, sid: "sid-b", sessionVersion: 2 } as any)).toBe(false)
    })

    it("is in the audit log under the client, naming the person, by none of the company's people", async () => {
        const p = await person()
        await change(p.id, { sid: "sid-a", sessionVersion: 0 }, sent(CURRENT))
        expect(await logged(p.id)).toEqual([{
            action: "CLIENT_PASSWORD_CHANGE", entityType: "VENDOR", entityId: "noor",
            details: { name: "Al Noor Trading", person: p.name, email: p.email, account: p.id },
            userId: null, superAdminId: null,
        }])
    })

    it("a wrong current password changes nothing, and isn't logged", async () => {
        const p = await person()
        const before = await row(p.id)
        expect(await why(change(p.id, { sid: "sid-a", sessionVersion: 0 }, sent("not-their-password")))).toBe("CURRENT_PASSWORD_WRONG")
        expect(await row(p.id)).toEqual(before)
        expect(await logged(p.id)).toEqual([])
    })

    it("five wrong tries in fifteen minutes, then none, right or wrong, as a person's own password has", async () => {
        const p = await person()
        for (let i = 0; i < 5; i++) expect(await why(change(p.id, null, sent("not-their-password")))).toBe("CURRENT_PASSWORD_WRONG")
        expect(await why(change(p.id, null, sent(CURRENT)))).toBe("OWN_PASSWORD_TRIES")
        expect(bcrypt.compareSync(CURRENT, (await row(p.id)).password)).toBe(true)
    })

    it("a session the account has already ended isn't kept by setting a password", async () => {
        const p = await person(4)
        await change(p.id, { sid: "sid-a", sessionVersion: 3 }, sent(CURRENT))
        expect(await row(p.id)).toMatchObject({ sessionVersion: 5, keptSession: null })
    })

    it("nor any, where the request names none", async () => {
        const p = await person(1)
        await change(p.id, null, sent(CURRENT))
        expect(await row(p.id)).toMatchObject({ sessionVersion: 2, keptSession: null })
    })

    it("two at once with the same current password: one is saved, and the other is told it isn't the current one now", async () => {
        const p = await person()
        const [first, second] = await Promise.all([
            why(change(p.id, { sid: "sid-a", sessionVersion: 0 }, sent(CURRENT, NEW))),
            why(change(p.id, { sid: "sid-b", sessionVersion: 0 }, sent(CURRENT, OTHER))),
        ])
        expect([first, second].sort()).toEqual(["CURRENT_PASSWORD_WRONG", "changed"])
        const after = await row(p.id)
        expect(bcrypt.compareSync(first === "changed" ? NEW : OTHER, after.password)).toBe(true)
        expect(after.sessionVersion).toBe(1)
        expect(after.keptSession).toBe(first === "changed" ? "1:sid-a" : "1:sid-b")
        expect((await logged(p.id)).length).toBe(1)
    })

    it("an account removed meanwhile, or one whose password was never set, is gone", async () => {
        const p = await person()
        await db.query(`DELETE FROM "ClientAccount" WHERE id = $1`, [p.id])
        expect(await why(change(p.id, null, sent(CURRENT)))).toBe("CLIENT_ACCOUNT_GONE")
        const invited = await person(0, null)
        expect(await why(change(invited.id, null, sent(CURRENT)))).toBe("CLIENT_ACCOUNT_GONE")
    })

    it("what was sent is checked before anything is read", async () => {
        const p = await person()
        expect(await why(change(p.id, null, { newPassword: NEW, confirmPassword: NEW }))).toBe("CURRENT_PASSWORD_MISSING")
        expect(await why(change(p.id, null, sent(CURRENT, "short")))).toBe("NEW_PASSWORD_SHORT")
        expect(await why(change(p.id, null, sent(CURRENT, "x".repeat(73))))).toBe("NEW_PASSWORD_LONG")
        expect(await why(change(p.id, null, { currentPassword: CURRENT, newPassword: NEW, confirmPassword: OTHER }))).toBe("NEW_PASSWORD_MISMATCH")
        expect(bcrypt.compareSync(CURRENT, (await row(p.id)).password)).toBe(true)
    })
})
