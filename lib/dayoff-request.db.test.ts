import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"

/**
 * Ask for leave for the companies already there (UI_PLAN.md §2.3, part 2b),
 * against a real Postgres: the built-in Employee and Team Leader, who ask
 * today, and every one of a company's own roles, as decided on 2026-10-30;
 * not the built-in Admin.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const GRANTED = "20261124000000_dayoff_request_granted"

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e2', 'e2@x', 'p', 'Ehab', 'Two', 'EMPLOYEE', 2026, 'e2', 'c2');
`

/**
 * A company's own roles before the migration: on each base, and one the
 * Super Admin gave Ask for leave in the role editor already, since 2a.
 */
const OWN_ROLES = `
INSERT INTO "Role"(id, "companyId", name, "baseRole", version, "updatedAt") VALUES
 ('own-desk', 'c1', 'Front desk', 'EMPLOYEE', 3, now()),
 ('own-hr', 'c1', 'HR officer', 'TEAM_LEADER', 2, now()),
 ('own-deputy', 'c1', 'Deputy admin', 'ADMIN', 4, now()),
 ('own-stores', 'c2', 'Stores', 'EMPLOYEE', 5, now());
INSERT INTO "RoleGrant"("roleId", permission, scope) VALUES
 ('own-desk', 'tasks.view', 'TEAM'), ('own-hr', 'dayoff.view', 'COMPANY'), ('own-stores', 'dayoff.request', 'OWN');
`

describe.skipIf(!ADMIN_URL)("Ask for leave for the companies already there, in Postgres", () => {
    const dbName = `dayoff_request_test_${Date.now()}`
    let db: Client
    let before: Record<string, number> = {}
    let after: Record<string, number> = {}
    const versions = async () => Object.fromEntries((await db.query(`SELECT id, version FROM "Role"`)).rows.map(r => [r.id, r.version]))
    const asking = async () => (await db.query(`
        SELECT r.id, r."companyId", r."builtIn", g.scope FROM "Role" r JOIN "RoleGrant" g ON g."roleId" = r.id
        WHERE g.permission = 'dayoff.request' ORDER BY r."companyId", r.id`)).rows

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
            if (m === GRANTED) {
                await db.query(OWN_ROLES)
                before = await versions()
            }
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
            if (m === GRANTED) after = await versions()
        }
    }, 180_000)

    afterAll(async () => {
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("gives each company's built-in Employee and Team Leader Ask for leave, at Own, and not its Admin", async () => {
        const builtIn = (await asking()).filter(r => r.builtIn).map(r => `${r.companyId} ${r.builtIn} ${r.scope}`)
        expect(builtIn.sort()).toEqual(["c1 EMPLOYEE OWN", "c1 TEAM_LEADER OWN", "c2 EMPLOYEE OWN", "c2 TEAM_LEADER OWN"])
    })

    it("gives every one of a company's own roles it, whatever its base, and keeps what they held", async () => {
        expect((await asking()).filter(r => !r.builtIn).map(r => r.id).sort()).toEqual(["own-deputy", "own-desk", "own-hr", "own-stores"])
        const held = (await db.query(`SELECT "roleId", permission FROM "RoleGrant" WHERE "roleId" IN ('own-desk', 'own-hr') AND permission <> 'dayoff.request' ORDER BY 1`)).rows
        expect(held).toEqual([{ roleId: "own-desk", permission: "tasks.view" }, { roleId: "own-hr", permission: "dayoff.view" }])
    })

    it("has the holders of a role given it reload their grants, and only them", async () => {
        const admins = (await db.query(`SELECT id FROM "Role" WHERE "builtIn" = 'ADMIN'`)).rows.map(r => r.id)
        expect(Object.keys(before).length).toBeGreaterThan(6)
        for (const [id, was] of Object.entries(before)) {
            // Stores held it already, and the built-in Admins weren't given it.
            const unchanged = id === "own-stores" || admins.includes(id)
            expect(after[id], id).toBe(unchanged ? was : was + 1)
        }
    })

    it("changes nothing run again", async () => {
        const [rows, was] = [await asking(), await versions()]
        await db.query(sql(GRANTED))
        expect(await asking()).toEqual(rows)
        expect(await versions()).toEqual(was)
    })
})
