import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * One username, one account, capitals aside, against a real Postgres: a
 * company's person and a Super Admin are never both "ops", nor "Ops" and
 * "ops". The check was on company people only, ignored a Super Admin
 * changing somebody's username, and two saves at once could both pass it;
 * a Super Admin added without a username got "", which the next one
 * couldn't have.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Delta Sites', now()), ('c2', 'Abu Bakr', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'ds0', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'k0', 'c1'),
 ('e2', 'e2@x', 'p', 'Omar', 'One', 'EMPLOYEE', 2026, 'Ops', 'c1'),
 ('a2', 'a2@x', 'p', 'Badr', 'Two', 'ADMIN', 2026, 'abu.admin', 'c2');
`
// Just before this change: Abu Bakr's code, and a Super Admin added without
// a username, as the Super Admins page added one (a second one couldn't be).
const BEFORE = `
UPDATE "Company" SET "usernameCode" = 'ab', "usernameNext" = 0 WHERE id = 'c2';
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", "updatedAt", "createdAt", username) VALUES
 ('sa1', 'sa1@x', 'p', 'The', 'Super Admin', now(), now() - interval '3 days', 'sa.one'),
 ('sa2', 'ops@x.co', 'p', 'Ops', 'One', now(), now() - interval '2 days', '');
`

const adminOf = (id: string, companyId: string) => ({ user: withGrants({ id, role: "ADMIN", companyId, name: "An Admin" }) } as any)
const superAdmin = { user: withGrants({ id: "sa1", role: "SUPER_ADMIN", name: "The Super Admin" }) } as any

describe.skipIf(!ADMIN_URL)("one username, one account, in Postgres", () => {
    const dbName = `username_unique_test_${Date.now()}`
    let db: Client
    let Users: typeof import("@/lib/services/user.service").UserService
    let SuperAdmins: typeof import("@/lib/services/super-admin.service").SuperAdminService

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
            if (m === "20261129000000_company_username_code") await db.query(BEFORE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Users = (await import("@/lib/services/user.service")).UserService
        SuperAdmins = (await import("@/lib/services/super-admin.service")).SuperAdminService
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    let n = 0
    const hire = (session: any, username?: string) => {
        n += 1
        return Users.create({ firstName: "New", lastName: `Hire${n}`, email: `new${n}@x.co`, password: "a-long-password-123", role: "EMPLOYEE", ...(username !== undefined && { username }) } as any, session)
    }
    const usernameOf = async (table: string, id: string) => (await db.query(`SELECT username FROM "${table}" WHERE id = $1`, [id])).rows[0]?.username

    it("gives the Super Admin added without a username one from their email, nobody else's", async () => {
        // Omar has Ops.
        expect(await usernameOf("SuperAdmin", "sa2")).toBe("ops-2")
        expect(await usernameOf("SuperAdmin", "sa1")).toBe("sa.one")
    })

    it("refuses a username typed for someone new that a Super Admin or another person has, capitals aside", async () => {
        await expect(hire(adminOf("a1", "c1"), "OPS-2")).rejects.toThrow("USERNAME_IN_USE")
        await expect(hire(adminOf("a1", "c1"), "OPS")).rejects.toThrow("USERNAME_IN_USE")
        await expect(hire(adminOf("a1", "c1"), "K0")).rejects.toThrow("USERNAME_IN_USE")
        await expect(hire(adminOf("a1", "c1"), "SA.ONE")).rejects.toThrow("USERNAME_IN_USE")
    })

    it("keeps two usernames that differ only in capitals out of the database", async () => {
        await expect(db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
            SELECT 'dup', 'dup@x', 'p', 'D', 'U', 'EMPLOYEE', 2026, 'DS0', 'c1', id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)).rejects.toThrow(/unique/)
        await expect(db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", "updatedAt", username) VALUES ('sa9', 'sa9@x', 'p', 'S', 'A', now(), 'SA.One')`)).rejects.toThrow(/unique/)
    })

    it("refuses a username a Super Admin changes somebody's to when somebody else has it, and lets them change its capitals", async () => {
        await expect(Users.update({ id: "e1", username: "ops-2" } as any, superAdmin)).rejects.toThrow("USERNAME_IN_USE")
        await expect(Users.update({ id: "e1", username: "Ds0" } as any, superAdmin)).rejects.toThrow("USERNAME_IN_USE")
        await Users.update({ id: "e1", username: "K0" } as any, superAdmin)
        expect(await usernameOf("User", "e1")).toBe("K0")
    })

    it("gives a Super Admin added without a username one from their email, and refuses one typed that's taken or another company's", async () => {
        const added = await SuperAdmins.create({ firstName: "Ops", lastName: "Three", email: "ops@z.co", password: "a-long-password-123" } as any, superAdmin)
        expect(added.username).toBe("ops-3")
        await expect(SuperAdmins.create({ firstName: "D", lastName: "S", email: "d@z.co", password: "a-long-password-123", username: "DS0" } as any, superAdmin)).rejects.toThrow("USERNAME_IN_USE")
        await expect(SuperAdmins.create({ firstName: "D", lastName: "S", email: "d@z.co", password: "a-long-password-123", username: "ds9" } as any, superAdmin)).rejects.toThrow("USERNAME_RESERVED")
        expect((await SuperAdmins.create({ firstName: "D", lastName: "S", email: "d@z.co", password: "a-long-password-123", username: "dina.s" } as any, superAdmin)).username).toBe("dina.s")
    })

    // Somebody else is given `name`, in the moment between the check and the
    // save: what two saves at once look like, without depending on timing.
    const takenAtTheLastMoment = async (name: string, companyId: string, act: () => Promise<unknown>) => {
        await db.query(`CREATE FUNCTION take_it() RETURNS trigger AS $$ BEGIN
            IF lower(NEW.username) = '${name}' AND NEW.email <> 'quick@x' THEN
                INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
                SELECT 'quick', 'quick@x', 'p', 'Q', 'K', 'EMPLOYEE', 2026, upper('${name}'), '${companyId}', NEW."roleId";
            END IF;
            RETURN NEW;
        END $$ LANGUAGE plpgsql`)
        await db.query(`CREATE TRIGGER take_it BEFORE INSERT ON "User" FOR EACH ROW EXECUTE FUNCTION take_it()`)
        try {
            return await act()
        } finally {
            await db.query(`DROP TRIGGER take_it ON "User"; DROP FUNCTION take_it()`)
        }
    }

    it("tells somebody given a username at the moment another person was given it that it's in use", async () => {
        await expect(takenAtTheLastMoment("same.name", "c1", () => hire(adminOf("a1", "c1"), "same.name"))).rejects.toThrow("USERNAME_IN_USE")
    })

    it("makes up another username when the one made up is taken at the last moment", async () => {
        const hired: any = await takenAtTheLastMoment("ab0", "c2", () => hire(adminOf("a2", "c2")))
        expect(hired.username).toBe("ab1")
    })
})
