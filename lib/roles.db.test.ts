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
import { RoleTemplateService } from "@/lib/services/role-template.service"

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
const TEMPLATES = "20260928000000_role_templates"
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
        await db.query(sql(TEMPLATES))
        prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) })
        // The services that manage roles use the application's client; point it
        // here before its first use (it is built lazily).
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 60_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await (await import("@/lib/prisma")).prisma.$disconnect()
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

        it("keep a company's last Admin at work (rule 8)", async () => {
            // In c1, a1 is the only Admin.
            for (const next of [{ status: "SUSPENDED" }, { status: "ARCHIVED" }, { status: "DELETED" }, { companyId: "c3" }, { roleId: "someone-else" }]) {
                await expect(RoleAssignmentService.keepsAnAdmin(prisma, "a1", next), JSON.stringify(next)).rejects.toThrow("LAST_ADMIN")
            }
            // Presence is not leaving: OFFLINE keeps them at work.
            await expect(RoleAssignmentService.keepsAnAdmin(prisma, "a1", { status: "OFFLINE" })).resolves.toBeUndefined()
            // Somebody who is not an Admin is not this rule's business.
            await expect(RoleAssignmentService.keepsAnAdmin(prisma, "e1", { status: "SUSPENDED" })).resolves.toBeUndefined()
            // A second Admin at work, and the first may go.
            const assignment = await RoleAssignmentService.builtIn(prisma, "ADMIN", "c1")
            await prisma.user.create({ data: { id: "a1b", email: "a1b@x", password: "p", firstName: "A", lastName: "B", username: "a1b", lastDayOffResetYear: 2026, companyId: "c1", status: "ACTIVE", ...assignment } })
            await expect(RoleAssignmentService.keepsAnAdmin(prisma, "a1", { status: "SUSPENDED" })).resolves.toBeUndefined()
            // …unless that second one is not at work.
            await prisma.user.update({ where: { id: "a1b" }, data: { status: "SUSPENDED" } })
            await expect(RoleAssignmentService.keepsAnAdmin(prisma, "a1", { status: "SUSPENDED" })).rejects.toThrow("LAST_ADMIN")
        })

        it("give a company with no roles at all its built-in ones — one made while the migration ran", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c4', 'Made mid-deploy', now())`)
            const assignment = await RoleAssignmentService.builtIn(prisma, "EMPLOYEE", "c4")
            expect(assignment.roleId).toBeTruthy()
            const { rows } = await db.query(`SELECT count(*)::int AS n FROM "Role" WHERE "companyId" = 'c4'`)
            expect(rows[0].n).toBe(3)
        })

        it("refuse a company missing only some of them, rather than write a null", async () => {
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c5', 'Broken', now())`)
            await db.query(`INSERT INTO "Role"(id, "companyId", name, "baseRole", "builtIn", "updatedAt") VALUES ('r-c5', 'c5', 'Admin', 'ADMIN', 'ADMIN', now())`)
            await expect(RoleAssignmentService.builtIn(prisma, "EMPLOYEE", "c5")).rejects.toThrow("BUILT_IN_ROLE_MISSING")
        })
    })

    describe("managing roles (B3)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        // Every change is audited under the Super Admin who made it, and the
        // audit row's foreign key wants that account to exist.
        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
        })
        const auditOf = async (entityId: string) =>
            (await db.query(`SELECT action, details FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [entityId])).rows

        it("creates a role from scratch, with what its grants need added", async () => {
            const role = await RoleService.create({ companyId: "c2", name: "Accountant", baseRole: "EMPLOYEE", grants: [{ permission: "payroll.approve", scope: "COMPANY" }] }, sa)
            expect(role.grants).toEqual([
                { permission: "salary.view", scope: "COMPANY" },
                { permission: "payroll.view", scope: "COMPANY" },
                { permission: "payroll.approve", scope: "COMPANY" },
            ])
            expect(role).toMatchObject({ builtIn: null, holders: 0, isDefault: false, locked: false, version: 1 })
            expect((await auditOf(role.id)).map(a => a.action)).toEqual(["CREATE_ROLE"])
        })

        it("creates one as a copy of a template", async () => {
            const template = await RoleTemplateService.create({ name: "HR Officer", baseRole: "EMPLOYEE", grants: [{ permission: "dayoff.approve", scope: "COMPANY" }] }, sa)
            const role = await RoleService.create({ companyId: "c2", name: "HR", fromTemplateId: template.id }, sa)
            expect(role).toMatchObject({ baseRole: "EMPLOYEE", copiedFromTemplateId: template.id })
            expect(role.grants.map(g => g.permission)).toEqual(["dayoff.view", "dayoff.approve"])
            // A copy, never a link: changing the template changes no company.
            await RoleTemplateService.update({ id: template.id, grants: [] }, sa)
            expect((await RoleService.getById(role.id)).grants.map(g => g.permission)).toEqual(["dayoff.view", "dayoff.approve"])
        })

        it("refuses grants the catalogue does not allow", async () => {
            await expect(RoleService.create({ companyId: "c2", name: "Bad", baseRole: "EMPLOYEE", grants: [{ permission: "payroll.approve", scope: "TEAM" }] }, sa))
                .rejects.toThrow("INVALID_GRANTS")
        })

        it("locks the built-in Admin role", async () => {
            const admin = (await RoleService.listForCompany("c2")).find(r => r.builtIn === "ADMIN")!
            expect(admin.locked).toBe(true)
            await expect(RoleService.update({ id: admin.id, grants: [] }, sa)).rejects.toThrow("ROLE_LOCKED")
            await expect(RoleService.update({ id: admin.id, name: "Boss" }, sa)).rejects.toThrow("ROLE_LOCKED")
        })

        it("lets a company's Employee role hold different grants, but not a new name or base", async () => {
            const employee = (await RoleService.listForCompany("c2")).find(r => r.builtIn === "EMPLOYEE")!
            await expect(RoleService.update({ id: employee.id, name: "Staff" }, sa)).rejects.toThrow("ROLE_BUILT_IN_FIXED")
            await expect(RoleService.delete(employee.id, sa)).rejects.toThrow("ROLE_BUILT_IN_FIXED")
            const updated = await RoleService.update({ id: employee.id, grants: [{ permission: "clients.view", scope: "COMPANY" }] }, sa)
            expect(updated.grants).toEqual([{ permission: "clients.view", scope: "COMPANY" }])
            // What its holders may do changed, so their sessions reload (§4.4)…
            expect(updated.version).toBe(employee.version + 1)
            const token = await RoleService.forToken("e2", prisma)
            expect(decodeGrants(token.grants)).toEqual({ "clients.view": "COMPANY" })
            expect(token.roleVersion).toBe(updated.version)
            // …and the change is audited, before and after.
            const [audit] = (await auditOf(employee.id)).filter(a => a.action === "UPDATE_ROLE")
            expect(audit.details.before.grants).toHaveLength(2)
            expect(audit.details.after.grants).toEqual([{ permission: "clients.view", scope: "COMPANY" }])
            expect(audit.details.holders).toBe(1)
        })

        it("signs holders out at once when asked to apply now", async () => {
            const employee = (await RoleService.listForCompany("c2")).find(r => r.builtIn === "EMPLOYEE")!
            const before = (await db.query(`SELECT "sessionVersion" FROM "User" WHERE id = 'e2'`)).rows[0].sessionVersion
            await RoleService.update({ id: employee.id, grants: [], applyNow: true }, sa)
            const after = (await db.query(`SELECT "sessionVersion" FROM "User" WHERE id = 'e2'`)).rows[0].sessionVersion
            expect(after).toBe(before + 1)
        })

        it("does not bump a role's version for a new name alone", async () => {
            const role = await RoleService.create({ companyId: "c2", name: "Clerk", baseRole: "EMPLOYEE", grants: [] }, sa)
            expect((await RoleService.update({ id: role.id, name: "Senior Clerk" }, sa)).version).toBe(role.version)
        })

        it("refuses moving a held role's base, and deleting it", async () => {
            const role = await RoleService.create({ companyId: "c2", name: "Supervisor", baseRole: "EMPLOYEE", grants: [] }, sa)
            await prisma.user.update({ where: { id: "e2" }, data: { roleId: role.id } })
            await expect(RoleService.update({ id: role.id, baseRole: "TEAM_LEADER" }, sa)).rejects.toThrow("ROLE_HELD")
            await expect(RoleService.delete(role.id, sa)).rejects.toThrow("ROLE_HELD")
            const employee = (await RoleService.listForCompany("c2")).find(r => r.builtIn === "EMPLOYEE")!
            await prisma.user.update({ where: { id: "e2" }, data: { roleId: employee.id } })
            // Unheld, it may be rebased, and deleted.
            expect((await RoleService.update({ id: role.id, baseRole: "TEAM_LEADER" }, sa)).baseRole).toBe("TEAM_LEADER")
            await RoleService.delete(role.id, sa)
            await expect(RoleService.getById(role.id)).rejects.toThrow("ROLE_NOT_FOUND")
        })

        it("keeps a company's default role its own, and not Admin-based", async () => {
            const role = await RoleService.create({ companyId: "c2", name: "Trainee", baseRole: "EMPLOYEE", grants: [] }, sa)
            await db.query(`UPDATE "Company" SET "defaultRoleId" = $1 WHERE id = 'c2'`, [role.id])
            expect((await RoleService.getById(role.id)).isDefault).toBe(true)
            await expect(RoleService.delete(role.id, sa)).rejects.toThrow("ROLE_IS_DEFAULT")
            await expect(RoleService.update({ id: role.id, baseRole: "ADMIN" }, sa)).rejects.toThrow("DEFAULT_ROLE_ADMIN")
            // The database refuses both too.
            await refused(`UPDATE "Role" SET "baseRole" = 'ADMIN' WHERE id = '${role.id}'`)
            await refused(`UPDATE "Company" SET "defaultRoleId" = ${roleOf("c1", "EMPLOYEE")} WHERE id = 'c2'`)
            await refused(`UPDATE "Company" SET "defaultRoleId" = ${roleOf("c2", "ADMIN")} WHERE id = 'c2'`)
            await db.query(`UPDATE "Company" SET "defaultRoleId" = NULL WHERE id = 'c2'`)
        })

        it("refuses a template based on the Super Admin", () =>
            refused(`INSERT INTO "RoleTemplate"(id, name, "baseRole", grants, "updatedAt") VALUES ('t-x', 'God', 'SUPER_ADMIN', '[]', now())`))
    })
})
