import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"

/**
 * clients.manage split into clients.create, clients.edit and clients.delete
 * (LATER_CHANGES_PLAN.md §2, PR 365), against a real Postgres: a role or a
 * template saved with clients.manage before the grant for companies already
 * there (PR 385) is read everywhere as holding the three, at its scope, as
 * that grant wrote them, clients.manage being retired since (PR 386).
 * lib/clients-split.test.ts has the routes and screens.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x.co', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x.co', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL);
`
// A template and a role made from it, both holding clients.manage as they
// were saved before the split, and Eman holding the role: there before the
// grant for companies already there.
const OLD_GRANTS = `
INSERT INTO "RoleTemplate"(id, name, "baseRole", grants, "updatedAt") VALUES
 ('t-desk', 'Clients desk', 'EMPLOYEE', '[{"permission":"clients.view","scope":"COMPANY"},{"permission":"clients.manage","scope":"COMPANY"}]', now());
INSERT INTO "Role"(id, "companyId", name, "baseRole", "copiedFromTemplateId", "updatedAt") VALUES ('r-desk', 'c1', 'Clients desk', 'EMPLOYEE', 't-desk', now());
INSERT INTO "RoleGrant"("roleId", permission, scope) VALUES ('r-desk', 'clients.view', 'COMPANY'), ('r-desk', 'clients.manage', 'COMPANY');
UPDATE "User" SET "roleId" = 'r-desk' WHERE id = 'e1';
`

const PARTS = ["clients.create", "clients.edit", "clients.delete"]
const SPLIT_GRANTED = "20270118000000_split_permissions_granted"

describe.skipIf(!ADMIN_URL)("a role and a template saved with clients.manage, in Postgres", () => {
    const dbName = `clients_split_test_${Date.now()}`
    let db: Client
    let prisma: typeof import("@/lib/prisma").prisma

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
            if (m === SPLIT_GRANTED) await db.query(OLD_GRANTS)
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        process.env.POSTGRES_PRISMA_URL = url.toString()
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

    it("gives the session of whoever holds it the three, and not clients.manage", async () => {
        const { RoleService } = await import("@/lib/services/role.service")
        const { decodeGrants } = await import("@/lib/permissions/grants")
        expect(decodeGrants((await RoleService.forToken("e1")).grants)).toEqual({
            "clients.view": "COMPANY", "clients.create": "COMPANY", "clients.edit": "COMPANY", "clients.delete": "COMPANY",
        })
    })

    it("counts them among who can do each of the three, at its scope, with the Admin, whose built-in role a migration gave clients.manage", async () => {
        const { AccessReportService } = await import("@/lib/services/access-report.service")
        for (const permission of PARTS) {
            const { holders } = await AccessReportService.whoCan("c1", permission)
            expect(holders.map(h => [h.user.id, h.role.name, h.scope]), permission).toEqual([["a1", "Admin", "COMPANY"], ["e1", "Clients desk", "COMPANY"]])
        }
    })

    it("lists the three in what they can do, and not clients.manage", async () => {
        const { AccessReportService } = await import("@/lib/services/access-report.service")
        const { grants } = await AccessReportService.whatCan("e1")
        expect(grants.map(g => g.permission)).toEqual(["clients.view", ...PARTS])
    })

    it("shows the template as the three, and the role made from it as no different from it", async () => {
        const { RoleTemplateService } = await import("@/lib/services/role-template.service")
        expect((await RoleTemplateService.getById("t-desk")).grants.map(g => g.permission)).toEqual(["clients.view", ...PARTS])
        const { roles } = await RoleTemplateService.offers("t-desk")
        expect(roles).toEqual([expect.objectContaining({ id: "r-desk", difference: { added: [], removed: [], rescoped: [] } })])
    })
})
