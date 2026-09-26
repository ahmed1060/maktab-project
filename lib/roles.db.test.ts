import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { decodeGrants } from "@/lib/permissions/grants"
import { RoleService } from "@/lib/services/role.service"
import { RoleAssignmentService } from "@/lib/services/role-assignment.service"
import { holdersOf } from "@/lib/permissions/holders"

/**
 * Roles as data, against a real Postgres.
 *
 * Everything else about roles is tested without a database; the migration,
 * its CHECKs and its triggers cannot be. So this builds a database from the
 * migration files — the ones before roles, then data as it stood, then the
 * roles migration — and checks what came out, what is refused, and that the
 * services write what the database accepts.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database, e.g. postgresql://postgres@localhost:5432/postgres.
 * Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = ["0_init", "20260920000000_team_leader"]
const ROLES = "20260927000000_roles"
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const BEFORE_ROLES = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'A', '1', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('t1', 't1@x', 'p', 'T', '1', 'TEAM_LEADER', 2026, 't1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'E', '1', 'EMPLOYEE', 2026, 'e1', 'c1', 't1'),
 ('e2', 'e2@x', 'p', 'E', '2', 'EMPLOYEE', 2026, 'e2', 'c2', NULL),
 ('sa', 'sa@x', 'p', 'S', 'A', 'SUPER_ADMIN', 2026, 'sa', NULL, NULL),
 ('lone', 'lone@x', 'p', 'L', 'O', 'ADMIN', 2026, 'lone', NULL, NULL);
`

describe.skipIf(!ADMIN_URL)("roles as data, in Postgres", () => {
    const dbName = `roles_test_${Date.now()}`
    let db: Client
    let prisma: PrismaClient

    beforeAll(async () => {
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) await db.query(sql(m))
        await db.query(BEFORE_ROLES)
        await db.query(sql(ROLES))
        prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) })
    }, 60_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await admin.end()
    })

    const refused = async (statement: string) => {
        await expect(db.query(statement)).rejects.toThrow()
    }
    const roleOf = (company: string, builtIn: string) =>
        `(SELECT id FROM "Role" WHERE "companyId" = '${company}' AND "builtIn" = '${builtIn}')`

    describe("the migration", () => {
        it("gives every company its three built-in roles, with the built-in grants", async () => {
            const { rows } = await db.query(`
                SELECT r."companyId", r."builtIn", g.permission, g.scope
                FROM "Role" r JOIN "RoleGrant" g ON g."roleId" = r.id`)
            for (const company of ["c1", "c2"]) {
                for (const builtIn of ["ADMIN", "TEAM_LEADER", "EMPLOYEE"] as const) {
                    const grants = Object.fromEntries(rows
                        .filter(r => r.companyId === company && r.builtIn === builtIn)
                        .map(r => [r.permission, r.scope]))
                    expect(grants, `${company} ${builtIn}`).toEqual(BUILT_IN_GRANTS[builtIn])
                }
            }
        })

        it("puts everyone on the built-in role matching theirs, and the Super Admin and company-less on none", async () => {
            const { rows } = await db.query(`
                SELECT u.id, r."builtIn", r."companyId" FROM "User" u LEFT JOIN "Role" r ON r.id = u."roleId" ORDER BY u.id`)
            expect(rows).toEqual([
                { id: "a1", builtIn: "ADMIN", companyId: "c1" },
                { id: "e1", builtIn: "EMPLOYEE", companyId: "c1" },
                { id: "e2", builtIn: "EMPLOYEE", companyId: "c2" },
                { id: "lone", builtIn: null, companyId: null },
                { id: "sa", builtIn: null, companyId: null },
                { id: "t1", builtIn: "TEAM_LEADER", companyId: "c1" },
            ])
        })
    })

    describe("what the database refuses", () => {
        it("a role whose base is not the person's role", () =>
            refused(`UPDATE "User" SET "roleId" = ${roleOf("c1", "ADMIN")} WHERE id = 'e1'`))
        it("a role changed without the role that sets it", () =>
            refused(`UPDATE "User" SET role = 'TEAM_LEADER' WHERE id = 'e2'`))
        it("another company's role", () =>
            refused(`UPDATE "User" SET "roleId" = ${roleOf("c2", "EMPLOYEE")} WHERE id = 'e1'`))
        it("a move to another company that keeps the old company's role", () =>
            refused(`UPDATE "User" SET "companyId" = 'c2', "teamLeaderId" = NULL WHERE id = 'e1'`))
        it("an account in a company with no role", () =>
            refused(`UPDATE "User" SET "roleId" = NULL WHERE id = 'e1'`))
        it("changing a held role's base role", () =>
            refused(`UPDATE "Role" SET "baseRole" = 'TEAM_LEADER', "builtIn" = NULL WHERE id = ${roleOf("c1", "EMPLOYEE")}`))
        it("deleting a held role", () =>
            refused(`DELETE FROM "Role" WHERE id = ${roleOf("c1", "EMPLOYEE")}`))
        it("a role based on the Super Admin", () =>
            refused(`INSERT INTO "Role"(id, "companyId", name, "baseRole", "updatedAt") VALUES ('r-x', 'c1', 'God', 'SUPER_ADMIN', now())`))
    })

    describe("the services write what the database accepts", () => {
        it("seed a new company's built-in roles", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c3', 'Three', now())`)
            await RoleService.seedBuiltInRoles(prisma, "c3")
            const { rows } = await db.query(`SELECT "builtIn", name FROM "Role" WHERE "companyId" = 'c3' ORDER BY name`)
            expect(rows).toEqual([
                { builtIn: "ADMIN", name: "Admin" },
                { builtIn: "EMPLOYEE", name: "Employee" },
                { builtIn: "TEAM_LEADER", name: "Team Leader" },
            ])
        })

        it("hire onto a company's built-in role", async () => {
            const assignment = await RoleAssignmentService.builtIn(prisma, "EMPLOYEE", "c3")
            await prisma.user.create({
                data: { id: "n1", email: "n1@x", password: "p", firstName: "N", lastName: "1", username: "n1", lastDayOffResetYear: 2026, companyId: "c3", ...assignment },
            })
            const token = await RoleService.forToken("n1", prisma)
            expect(decodeGrants(token.grants)).toEqual(BUILT_IN_GRANTS.EMPLOYEE)
        })

        it("promote, moving role and role together", async () => {
            const assignment = await RoleAssignmentService.builtIn(prisma, "TEAM_LEADER", "c3")
            await prisma.user.update({ where: { id: "n1" }, data: assignment })
            expect(decodeGrants((await RoleService.forToken("n1", prisma)).grants)).toEqual(BUILT_IN_GRANTS.TEAM_LEADER)
        })

        it("move to another company, onto that company's role", async () => {
            const assignment = await RoleAssignmentService.builtIn(prisma, "TEAM_LEADER", "c1")
            await prisma.user.update({ where: { id: "n1" }, data: { companyId: "c1", ...assignment } })
            const { rows } = await db.query(`SELECT r."companyId" FROM "User" u JOIN "Role" r ON r.id = u."roleId" WHERE u.id = 'n1'`)
            expect(rows).toEqual([{ companyId: "c1" }])
        })

        it("give the Super Admin and a company-less account no role, and no grants", async () => {
            expect(await RoleAssignmentService.builtIn(prisma, "SUPER_ADMIN", "c1")).toEqual({ role: "SUPER_ADMIN", roleId: null })
            expect(await RoleAssignmentService.builtIn(prisma, "ADMIN", null)).toEqual({ role: "ADMIN", roleId: null })
            expect(await RoleService.forToken("sa", prisma)).toEqual({ roleId: null, roleVersion: 0, grants: "" })
        })

        it("find who holds a permission by their role's grants", async () => {
            const who = async (where: object) =>
                (await prisma.user.findMany({ where, select: { id: true }, orderBy: { id: "asc" } })).map(u => u.id)
            expect(await who({ companyId: "c1", ...holdersOf("dayoff.approve", "COMPANY") })).toEqual(["a1"])
            expect(await who({ companyId: "c1", ...holdersOf("tasks.review", "TEAM") })).toEqual(["n1", "t1"])
            expect(await who({ companyId: "c1", ...holdersOf("clients.view") })).toEqual(["a1", "e1", "n1", "t1"])
        })

        it("refuse a company whose built-in role is missing, rather than write a null", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c4', 'Broken', now())`)
            await expect(RoleAssignmentService.builtIn(prisma, "EMPLOYEE", "c4")).rejects.toThrow("BUILT_IN_ROLE_MISSING")
        })
    })
})
