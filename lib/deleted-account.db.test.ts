import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * An account deleted while it's signed in (lib/deleted-account.test.ts has
 * why), against a real Postgres: an Admin deletes someone as the Employees
 * list does, and the session that person still has is refused at its next
 * check; a row deleted outright ends its session there.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Nile Works', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1'),
 ('e3', 'e3@x', 'p', 'Essam', 'One', 'EMPLOYEE', 2026, 'e3', 'c1');
`

const admin = { user: { ...withGrants({ id: "a1", role: "ADMIN", companyId: "c1" } as any), mfaEnabled: true, stepUpAt: Date.now() } } as any

describe.skipIf(!ADMIN_URL)("an account deleted while signed in, in Postgres", () => {
    const dbName = `deleted_account_test_${Date.now()}`
    let db: Client
    let prisma: typeof import("@/lib/prisma").prisma
    let Users: typeof import("@/lib/services/user.service").UserService
    let accountRefusal: typeof import("@/lib/account-refusal").accountRefusal
    let jwt: (token: any) => Promise<any>
    let session: (token: any) => Promise<any>
    let CATALOGUE_VERSION: number

    // A session signed in before the delete, whose minute's check is due.
    const signedIn = (id: string) => ({ sub: id, role: "EMPLOYEE", companyId: "c1", userStatus: "ACTIVE", checkedAt: 0, sessionVersion: 0, grants: "", catalogue: CATALOGUE_VERSION })

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
        process.env.POSTGRES_PRISMA_URL = url.toString()
        prisma = (await import("@/lib/prisma")).prisma
        Users = (await import("@/lib/services/user.service")).UserService
        accountRefusal = (await import("@/lib/account-refusal")).accountRefusal
        CATALOGUE_VERSION = (await import("@/lib/permissions/catalogue")).CATALOGUE_VERSION
        const { authOptions } = await import("@/lib/auth")
        jwt = token => authOptions.callbacks!.jwt!({ token } as any) as Promise<any>
        session = token => authOptions.callbacks!.session!({ session: { user: {} } as any, token } as any) as Promise<any>
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("deleted by an Admin, the session they still have is refused from its next check", async () => {
        await Users.delete("e1", admin)
        expect((await db.query(`SELECT status FROM "User" WHERE id = 'e1'`)).rows[0].status).toBe("DELETED")

        const token = await jwt(signedIn("e1"))
        expect(token.sub).toBe("e1")
        expect(token.userStatus).toBe("DELETED")
        expect(accountRefusal((await session(token)).user)).toBe("SUSPENDED")
    })

    it("and the heartbeat tells their browser, which signs out", async () => {
        expect(await Users.updateActivity("e1", "EMPLOYEE")).toEqual({ success: true, status: "DELETED" })
    })

    it("deleted outright, the session ends at its next check", async () => {
        await db.query(`DELETE FROM "User" WHERE id = 'e2'`)
        expect(await jwt(signedIn("e2"))).toEqual({})
    })

    it("someone not deleted goes on as before", async () => {
        const token = await jwt(signedIn("e3"))
        expect(token.sub).toBe("e3")
        expect(accountRefusal((await session(token)).user)).toBeNull()
        expect((await Users.updateActivity("e3", "EMPLOYEE")).status).toBe("ACTIVE")
    })
})
