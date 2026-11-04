import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Each company's own username code, against a real Postgres: the letters
 * before the number in a username Nizmo makes up (ds0, ds1…), one company's
 * and nobody else's. The old way took the name's initials and the highest
 * number anyone had, so "Delta Sites" and "Data Solutions" shared ds and
 * took turns; and a person who left freed their number for the next hire.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) } }, uploadToCloud: async () => { throw new Error("no uploads here") } }))

// Before this change: Delta Sites and Data Solutions shared "ds" (DS3 typed
// with capitals), Karavan had k0 and k1, and Fresh Co and Dark Star had no
// made-up usernames at all.
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt", "createdAt") VALUES
 ('c1', 'Delta Sites', now(), now() - interval '3 days'),
 ('c2', 'Data Solutions', now(), now() - interval '2 days'),
 ('c3', 'Karavan', now(), now() - interval '1 day'),
 ('c4', 'Fresh Co', now(), now()),
 ('c5', 'Dark Star', now(), now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'ds0', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'ds1', 'c1'),
 ('e2', 'e2@x', 'p', 'Mona', 'One', 'EMPLOYEE', 2026, 'DS3', 'c1'),
 ('a2', 'a2@x', 'p', 'Badr', 'Two', 'ADMIN', 2026, 'ds2', 'c2'),
 ('e3', 'e3@x', 'p', 'Nora', 'Two', 'EMPLOYEE', 2026, 'nora', 'c2'),
 ('a3', 'a3@x', 'p', 'Karim', 'Three', 'ADMIN', 2026, 'k0', 'c3'),
 ('e4', 'e4@x', 'p', 'Laila', 'Three', 'EMPLOYEE', 2026, 'k1', 'c3'),
 ('a4', 'a4@x', 'p', 'Fady', 'Four', 'ADMIN', 2026, 'fresh.admin', 'c4'),
 ('a5', 'a5@x', 'p', 'Dina', 'Five', 'ADMIN', 2026, 'dark.admin', 'c5');
`

const adminOf = (id: string, companyId: string) => ({ user: withGrants({ id, role: "ADMIN", companyId, name: "An Admin" }) } as any)
const superAdmin = { user: withGrants({ id: "sa1", role: "SUPER_ADMIN", name: "The Super Admin" }) } as any

describe.skipIf(!ADMIN_URL)("each company's username code, in Postgres", () => {
    const dbName = `username_codes_test_${Date.now()}`
    let db: Client
    let Users: typeof import("@/lib/services/user.service").UserService
    let Companies: typeof import("@/lib/services/company.service").CompanyService
    let generateUsername: typeof import("@/lib/username").generateUsername

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
        await db.query(`INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", "updatedAt", username) VALUES ('sa1', 'sa1@x', 'p', 'The', 'Super Admin', now(), 'sa.one')`)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Users = (await import("@/lib/services/user.service")).UserService
        Companies = (await import("@/lib/services/company.service")).CompanyService
        generateUsername = (await import("@/lib/username")).generateUsername
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    // Somebody added straight to the database, with a username typed by hand.
    const typed = (id: string, username: string, companyId: string) => db.query(
        `INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "roleId")
         SELECT $1, $1 || '@x', 'p', 'Typed', 'Name', 'EMPLOYEE', 2026, $2, $3, id FROM "Role" WHERE "companyId" = $3 AND "builtIn" = 'EMPLOYEE'`,
        [id, username, companyId])
    const codeOf = async (id: string) => (await db.query(`SELECT "usernameCode" AS code, "usernameNext" AS next FROM "Company" WHERE id = $1`, [id])).rows[0]
    let n = 0
    const hire = (session: any, username?: string) => {
        n += 1
        return Users.create({ firstName: "New", lastName: `Hire${n}`, email: `new${n}@x.co`, password: "a-long-password-123", role: "EMPLOYEE", ...(username !== undefined && { username }) } as any, session)
    }

    it("gives the companies already there the code their people's usernames use, carrying on after the highest number", async () => {
        // Delta Sites has three ds names to Data Solutions' one, so ds is
        // Delta Sites'; the next is after ds3, whoever had ds2.
        expect(await codeOf("c1")).toEqual({ code: "ds", next: 4 })
        expect(await codeOf("c2")).toEqual({ code: null, next: 0 })
        expect(await codeOf("c3")).toEqual({ code: "k", next: 2 })
        expect(await codeOf("c4")).toEqual({ code: null, next: 0 })
        expect(await codeOf("c5")).toEqual({ code: null, next: 0 })
    })

    it("carries on from there: Karavan's next is k2, then k3", async () => {
        expect(await generateUsername("c3")).toBe("k2")
        expect(await generateUsername("c3")).toBe("k3")
        expect(await codeOf("c3")).toEqual({ code: "k", next: 4 })
    })

    it("gives a company without a code one from its name the first time, counting from 0", async () => {
        expect(await generateUsername("c4")).toBe("fc0")
        expect(await generateUsername("c4")).toBe("fc1")
        expect(await codeOf("c4")).toEqual({ code: "fc", next: 2 })
    })

    it("never gives two companies the same code: one whose initials another company has gets the next suggestion", async () => {
        // ds is Delta Sites'.
        expect(await generateUsername("c2")).toBe("dso0")
        expect(await generateUsername("c5")).toBe("dst0")
        expect((await codeOf("c2")).code).toBe("dso")
        expect((await codeOf("c5")).code).toBe("dst")
    })

    it("skips a username somebody already has, capitals aside", async () => {
        await typed("e5", "FC2", "c4")
        expect(await generateUsername("c4")).toBe("fc3")
    })

    it("never gives a number again, even once the person who had it has gone", async () => {
        const first = await hire(adminOf("a3", "c3"))
        expect(first.username).toBe("k4")
        await Users.delete(first.id, adminOf("a3", "c3"), false)
        expect((await db.query(`SELECT username FROM "User" WHERE id = $1`, [first.id])).rows[0].username).not.toBe("k4")
        expect((await hire(adminOf("a3", "c3"))).username).toBe("k5")
    })

    it("gives people added at the same moment different usernames", async () => {
        const names = await Promise.all([1, 2, 3, 4, 5].map(() => generateUsername("c5")))
        expect(new Set(names).size).toBe(5)
        expect(names.every(name => /^dst\d+$/.test(name))).toBe(true)
    })

    it("refuses a username typed for someone new that follows another company's code and a number", async () => {
        await expect(hire(adminOf("a3", "c3"), "ds7")).rejects.toThrow("USERNAME_RESERVED")
        await expect(hire(adminOf("a3", "c3"), "DSO9")).rejects.toThrow("USERNAME_RESERVED")
        // Its own code, and letters with no number, are anybody's to type.
        expect((await hire(adminOf("a3", "c3"), "k90")).username).toBe("k90")
        expect((await hire(adminOf("a3", "c3"), "dsx")).username).toBe("dsx")
    })

    it("refuses one a Super Admin types for somebody already there, but keeps the one they have", async () => {
        await expect(Users.update({ id: "e4", username: "ds8" } as any, superAdmin)).rejects.toThrow("USERNAME_RESERVED")
        // Data Solutions' ds2 dates from before codes: saving it unchanged is fine.
        await Users.update({ id: "a2", username: "ds2" } as any, superAdmin)
        expect((await db.query(`SELECT username FROM "User" WHERE id = 'a2'`)).rows[0].username).toBe("ds2")
    })

    it("takes the code typed for a new company, or suggests one, and refuses one another company has or uses", async () => {
        await expect(Companies.create({ name: "Delta Sun", usernameCode: "ds" } as any, superAdmin)).rejects.toThrow("COMPANY_CODE_TAKEN")
        await typed("e6", "zed4", "c4")
        await expect(Companies.create({ name: "Zed Works", usernameCode: "zed" } as any, superAdmin)).rejects.toThrow("COMPANY_CODE_TAKEN")

        const sun = await Companies.create({ name: "Delta Sun", usernameCode: "dsun" } as any, superAdmin)
        expect(await codeOf(sun.id)).toEqual({ code: "dsun", next: 0 })
        const sea = await Companies.create({ name: "Delta Sea" } as any, superAdmin)
        expect((await codeOf(sea.id)).code).toBe("dse")
        expect(await generateUsername(sea.id)).toBe("dse0")
    })

    it("lets a company's code change only until its first username is given", async () => {
        await expect(Companies.update({ id: "c3", usernameCode: "kv" } as any, superAdmin)).rejects.toThrow("COMPANY_CODE_LOCKED")
        // The same one again is no change.
        await Companies.update({ id: "c3", name: "Karavan", usernameCode: "k" } as any, superAdmin)
        expect(await codeOf("c3")).toEqual({ code: "k", next: 6 })

        const fresh = await Companies.create({ name: "Nile Tours", usernameCode: "nt" } as any, superAdmin)
        await expect(Companies.update({ id: fresh.id, usernameCode: "fc" } as any, superAdmin)).rejects.toThrow("COMPANY_CODE_TAKEN")
        await Companies.update({ id: fresh.id, usernameCode: "nil" } as any, superAdmin)
        expect(await codeOf(fresh.id)).toEqual({ code: "nil", next: 0 })
    })

    it("leaves the code as it was when the rest of the save is refused (Codex on PR 184)", async () => {
        const tours = await Companies.create({ name: "Red Sea Tours", usernameCode: "rst" } as any, superAdmin)
        // Karavan's name is taken: the whole save is refused, the code with it.
        await expect(Companies.update({ id: tours.id, name: "Karavan", usernameCode: "rsx" } as any, superAdmin)).rejects.toThrow()
        expect(await codeOf(tours.id)).toEqual({ code: "rst", next: 0 })
    })

    it("suggests a code for a name as the dialog is filled in, skipping those taken", async () => {
        // ds is Delta Sites', dst Dark Star's.
        expect(await Companies.suggestUsernameCode("Dawn Star", null)).toBe("dsta")
        // A company's own code is free for it.
        expect(await Companies.suggestUsernameCode("Dark Star", "c5")).toBe("dst")
    })
})
