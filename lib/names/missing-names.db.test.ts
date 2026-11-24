import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { encodeGrants } from "@/lib/permissions/grants"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { serializeAccess, resolveBundles } from "@/lib/features/bundles"

/**
 * Employees' names in the page's language on the Employees page
 * (LATER_CHANGES_PLAN.md §3.1, step 5, PR 405; DESIGN.md §5.3), against a real
 * Postgres: GET /api/users lists each name in both languages, finds the ones
 * still missing a language, as the database reads Arabic letters, counts them
 * over everyone the list is for, searches either language, and sorts an
 * Arabic page by the names it has in Arabic first.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

vi.setConfig({ testTimeout: 60_000 })

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const state = { session: null as any }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("next-auth/jwt", () => ({ getToken: async () => null }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

/**
 * Made-up people, put in before the migrations that give everyone their
 * company's roles, as the other database tests do. Each missing one is
 * missing it a different way, so every part of the rule is needed: no
 * Arabic, no first name in Arabic or only spaces, half its Arabic empty, a whole name saved
 * in Arabic (copied into its Arabic by the names migration), only its first
 * or only its last name saved in Arabic, and no first name in English. Two
 * are whole, one of them a team leader; one is deleted, one another
 * company's.
 */
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Nile Works', now()), ('c2', 'Delta Sites', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, status, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 'ACTIVE', 2026, 'a1', 'c1', NULL),
 ('tl1', 'tl1@x', 'p', 'Tarek', 'Lead', 'TEAM_LEADER', 'ACTIVE', 2026, 'tl1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Karim', 'Saeed', 'EMPLOYEE', 'ACTIVE', 2026, 'e1', 'c1', 'tl1'),
 ('e2', 'e2@x', 'p', 'منى', 'عادل', 'EMPLOYEE', 'ACTIVE', 2026, 'e2', 'c1', NULL),
 ('e3', 'e3@x', 'p', 'Hany', 'Said', 'EMPLOYEE', 'ACTIVE', 2026, 'e3', 'c1', NULL),
 ('e4', 'e4@x', 'p', 'Lina', 'Fawzy', 'EMPLOYEE', 'ACTIVE', 2026, 'e4', 'c1', NULL),
 ('e6', 'e6@x', 'p', 'Nour', 'Ali', 'EMPLOYEE', 'ACTIVE', 2026, 'e6', 'c1', NULL),
 ('e7', 'e7@x', 'p', 'سامي', 'Gad', 'EMPLOYEE', 'ACTIVE', 2026, 'e7', 'c1', NULL),
 ('e8', 'e8@x', 'p', 'Rana', 'حسن', 'EMPLOYEE', 'ACTIVE', 2026, 'e8', 'c1', NULL),
 ('e9', 'e9@x', 'p', '', 'Zaki', 'EMPLOYEE', 'ACTIVE', 2026, 'e9', 'c1', NULL),
 ('e10', 'e10@x', 'p', 'Yara', 'Nabil', 'EMPLOYEE', 'ACTIVE', 2026, 'e10', 'c1', NULL),
 ('e5', 'e5_DELETED_1@x', 'p', 'Dalia', 'Gone', 'EMPLOYEE', 'DELETED', 2026, 'e5', 'c1', NULL),
 ('o1', 'o1@x', 'p', 'Omar', 'Other', 'EMPLOYEE', 'ACTIVE', 2026, 'o1', 'c2', NULL);
`
/** Their names in Arabic, once there's a column for them. */
const IN_ARABIC = `
UPDATE "User" SET "firstNameAr" = 'أمل', "lastNameAr" = 'واحد' WHERE id = 'a1';
UPDATE "User" SET "firstNameAr" = 'طارق', "lastNameAr" = 'ليد' WHERE id = 'tl1';
UPDATE "User" SET "firstNameAr" = 'هاني', "lastNameAr" = '' WHERE id = 'e3';
UPDATE "User" SET "firstNameAr" = 'لينا', "lastNameAr" = 'فوزي' WHERE id = 'e4';
UPDATE "User" SET "lastNameAr" = 'علي' WHERE id = 'e6';
UPDATE "User" SET "lastNameAr" = 'جاد' WHERE id = 'e7';
UPDATE "User" SET "firstNameAr" = 'رنا' WHERE id = 'e8';
UPDATE "User" SET "firstNameAr" = 'زين', "lastNameAr" = 'زكي' WHERE id = 'e9';
UPDATE "User" SET "firstNameAr" = '  ', "lastNameAr" = 'نبيل' WHERE id = 'e10';
`

const admin = {
    user: { id: "a1", role: "ADMIN", companyId: "c1", grants: encodeGrants(BUILT_IN_GRANTS.ADMIN as any), featureAccess: serializeAccess(resolveBundles(null, { isSuperAdmin: false })) },
}

describe.skipIf(!ADMIN_URL)("employees' names on the Employees page, in Postgres", () => {
    const dbName = `missing_names_test_${Date.now()}`
    let db: Client

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        // In UTF-8, as production's is, for Arabic letters to be read as letters.
        await a.query(`CREATE DATABASE ${dbName} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(IN_ARABIC)
        process.env.POSTGRES_PRISMA_URL = url.toString()
        state.session = admin
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    const list = async (qs: string) => {
        const res = await (await import("@/app/api/users/route")).GET(new Request(`https://nizmo.test/api/users?page=1&limit=10&excludeRole=SUPER_ADMIN&excludeUserId=a1&${qs}`))
        expect(res.status).toBe(200)
        return (await res.json()).data
    }
    const ids = (data: any) => data.data.map((u: any) => u.id)

    it("lists each name in both languages, their team leader's too", async () => {
        const rows = (await list("sort=name&order=asc")).data
        expect(rows.find((u: any) => u.id === "e4")).toMatchObject({ firstName: "Lina", firstNameAr: "لينا", lastName: "Fawzy", lastNameAr: "فوزي" })
        expect(rows.find((u: any) => u.id === "e1").teamLeader).toMatchObject({ firstName: "Tarek", firstNameAr: "طارق", lastNameAr: "ليد" })
    })

    it("finds the names still missing a language, and counts them over everyone the list is for", async () => {
        // Each missing it its own way; not a whole one, a deleted one, nor another company's.
        const missing = await list("names=missing&counts=names&sort=name&order=asc")
        expect(ids(missing)).toEqual(["e9", "e3", "e1", "e6", "e8", "e10", "e7", "e2"])
        expect(missing.missingNames).toBe(8)
        // Searched or filtered, the count stays everyone's.
        const searched = await list("names=missing&counts=names&search=karim")
        expect(ids(searched)).toEqual(["e1"])
        expect(searched.missingNames).toBe(8)
        // Not asked, not counted.
        expect((await list("sort=name")).missingNames).toBeUndefined()
    })

    it("searches either language", async () => {
        expect(ids(await list("search=لينا"))).toEqual(["e4"])
        expect(ids(await list("search=lina"))).toEqual(["e4"])
    })

    it("sorts an Arabic page by the names it has in Arabic first, then the rest in English", async () => {
        expect(ids(await list("sort=name&order=asc&lang=ar"))).toEqual(["e10", "e8", "e9", "e7", "tl1", "e4", "e2", "e3", "e6", "e1"])
        expect(ids(await list("sort=name&order=asc&lang=en"))).toEqual(["e9", "e3", "e1", "e4", "e6", "e8", "tl1", "e10", "e7", "e2"])
    })

    it("are looked up in the company asked, or every company where none is", async () => {
        const { missingNameIds } = await import("@/lib/names/missing")
        expect((await missingNameIds("c1")).sort()).toEqual(["e1", "e10", "e2", "e3", "e5", "e6", "e7", "e8", "e9"])
        expect(await missingNameIds("c2")).toEqual(["o1"])
        expect(await missingNameIds(null)).toEqual(expect.arrayContaining(["e1", "o1"]))
    })
})
