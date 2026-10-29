import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync } from "node:fs"
import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { BUILT_IN_GRANTS, builtInGrantsToken } from "@/lib/permissions/built-in"
import { decodeGrants, encodeGrants } from "@/lib/permissions/grants"
import { RoleService } from "@/lib/services/role.service"
import { RoleAssignmentService } from "@/lib/services/role-assignment.service"
import { holdersOf } from "@/lib/permissions/holders"
import { AccessReportService } from "@/lib/services/access-report.service"
import { RoleRequestService } from "@/lib/services/role-request.service"
import { RoleChangeRequestService } from "@/lib/services/role-change-request.service"
import { AccessReviewService } from "@/lib/services/access-review.service"
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
const REQUESTS = "20260929000000_role_requests"
const ACTING = "20260930000000_acting_roles"
const CHANGES = "20261001000000_role_change_requests"
const STEP_UP = "20261002000000_step_up"
const REVIEWS = "20261003000000_access_reviews"
const NOTICE_KEYS = "20261004000000_notification_keys"
const REVIEW_SNAPSHOTS = "20261005000000_access_review_snapshots"
const ADMIN_SETTINGS = "20261006000000_admin_settings"
const ATTENDANCE_ADDONS = "20261007000000_attendance_addons"
const ATTENDANCE_PUNCHES = "20261010000000_attendance_punches"
const ATTENDANCE_DAYS = "20261011000000_attendance_days"
const ATTENDANCE_REQUESTS = "20261012000000_attendance_requests"
// Adds a column to Company, which the role services read and write.
const ATTENDANCE_PAYROLL = "20261014000000_attendance_payroll"
// Notification.priority, which every notice written here now carries; it
// alters the terminals' tables, so those come first.
const ATTENDANCE_TERMINALS = "20261018000000_attendance_terminals"
const TERMINAL_ALERTS = "20261019000000_attendance_terminal_alerts"
// The built-in Admin role's attendance.approve_devices (§9.3).
const CHECK_IN_PHONES = "20261021000000_attendance_check_in_phones"
// Notification.pushedAt, which every notice written here now carries (§13.4).
const PUSH = "20261023000000_attendance_push"
const PUSH_CLAIM = "20261024000000_push_claim"
// The App Attest columns, and face verification: the built-in Admin role's
// attendance.approve_face, and User.faceVerificationRequired, which the
// services here read (§9.5).
const APP_ATTEST = "20261025000000_app_attest"
const FACE = "20261026000000_face_switches"
const FACE_REVIEWS = "20261027000000_face_reviews"
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
// clients.* became records.* (CLIENTS_PLAN.md §0.2): the built-in roles'
// grants went through it.
const RECORDS = "20261104000000_records_on_clients"
// And on: 0a kept Records grants from editors that didn't know them, 0b
// dropped that and the renaming on the way in, and 0c rewrote vendors.* to
// clients.* (CLIENTS_PLAN.md §0.3), which this release writes.
const RECORDS_KEPT = "20261104000003_records_grants_kept"
const RECORDS_COMPAT_DROPPED = "20261106000000_records_compat_dropped"
const CLIENT_NAMES = "20261107000000_client_names_stored"
// The built-in Admin and Team Leader roles' locations.* (CLIENTS_PLAN.md §2.9).
const LOCATIONS_GRANTED = "20261110000000_locations_granted"
// Every role's lists.add, and the built-in Admin's lists.manage (CLIENTS_PLAN.md §5.10).
const LISTS_GRANTED = "20261116000000_lists_granted"

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
        await db.query(sql(REQUESTS))
        await db.query(sql(ACTING))
        await db.query(sql(CHANGES))
        await db.query(sql(STEP_UP))
        await db.query(sql(REVIEWS))
        await db.query(sql(NOTICE_KEYS))
        await db.query(sql(REVIEW_SNAPSHOTS))
        await db.query(sql(ADMIN_SETTINGS))
        await db.query(sql(ATTENDANCE_ADDONS))
        await db.query(sql(ATTENDANCE_PUNCHES))
        await db.query(sql(ATTENDANCE_DAYS))
        await db.query(sql(ATTENDANCE_REQUESTS))
        await db.query(sql(ATTENDANCE_PAYROLL))
        await db.query(sql(ATTENDANCE_TERMINALS))
        await db.query(sql(TERMINAL_ALERTS))
        await db.query(sql(CHECK_IN_PHONES))
        await db.query(sql(PUSH))
        await db.query(sql(PUSH_CLAIM))
        await db.query(sql(APP_ATTEST))
        await db.query(sql(FACE))
        await db.query(sql(FACE_REVIEWS))
        await db.query(sql(RECORDS))
        await db.query(sql(RECORDS_KEPT))
        await db.query(sql(RECORDS_COMPAT_DROPPED))
        await db.query(sql(CLIENT_NAMES))
        await db.query(sql(LOCATIONS_GRANTED))
        await db.query(sql(LISTS_GRANTED))
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

        it("later gives the built-in Admin role the settings and attendance permissions, has its holders reload, and shows no company its settings", async () => {
            // ATTENDANCE_PLAN.md §5.2: the grants open nothing while the switch is off.
            // Five later grants to the Admin role (settings, attendance, attendance requests, check-in phones, face verification), each a reload.
            // And one for every built-in role: clients.* became records.* (CLIENTS_PLAN.md §0.2).
            // And one for the Admin and Team Leader roles: locations.* (CLIENTS_PLAN.md §2.9).
            // And one for every built-in role: lists.* (CLIENTS_PLAN.md §5.10).
            const { rows: roles } = await db.query(`SELECT "companyId", "builtIn", version FROM "Role" ORDER BY "companyId", "builtIn"`)
            const version = { ADMIN: 9, TEAM_LEADER: 4, EMPLOYEE: 3 } as Record<string, number>
            for (const role of roles) expect(role.version, `${role.companyId} ${role.builtIn}`).toBe(version[role.builtIn])
            const { rows: companies } = await db.query(`SELECT "adminSettingsEnabled", "adminSettingsTabs" FROM "Company"`)
            expect(companies).toEqual([
                { adminSettingsEnabled: false, adminSettingsTabs: [] },
                { adminSettingsEnabled: false, adminSettingsTabs: [] },
            ])
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
            expect(await who({ companyId: "c1", ...holdersOf("records.view") })).toEqual(["a1", "e1", "n1", "t1"])
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
            const updated = await RoleService.update({ id: employee.id, grants: [{ permission: "records.view", scope: "COMPANY" }] }, sa)
            expect(updated.grants).toEqual([{ permission: "records.view", scope: "COMPANY" }])
            // What its holders may do changed, so their sessions reload (§4.4)…
            expect(updated.version).toBe(employee.version + 1)
            const token = await RoleService.forToken("e2", prisma)
            expect(decodeGrants(token.grants)).toEqual({ "records.view": "COMPANY" })
            expect(token.roleVersion).toBe(updated.version)
            // …and the change is audited, before and after.
            const [audit] = (await auditOf(employee.id)).filter(a => a.action === "UPDATE_ROLE")
            // Its built-in grants, before.
            expect(audit.details.before.grants).toHaveLength(Object.keys(BUILT_IN_GRANTS.EMPLOYEE).length)
            expect(audit.details.after.grants).toEqual([{ permission: "records.view", scope: "COMPANY" }])
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

        it("refuses deleting a role somebody has asked for, until the request is settled", async () => {
            const role = await RoleService.create({ companyId: "c2", name: "Asked for", baseRole: "EMPLOYEE", grants: [] }, sa)
            const request = await prisma.roleRequest.create({ data: { companyId: "c2", userId: "e2", roleId: role.id, requestedById: "e2" } })
            await expect(RoleService.delete(role.id, sa)).rejects.toThrow("ROLE_REQUESTED")
            expect(await prisma.roleRequest.count({ where: { id: request.id } })).toBe(1)
            await prisma.roleRequest.update({ where: { id: request.id }, data: { status: "CANCELLED" } })
            await RoleService.delete(role.id, sa)
            await expect(RoleService.getById(role.id)).rejects.toThrow("ROLE_NOT_FOUND")
        })

        it("refuses deleting a role somebody is asking for at that moment, rather than taking the request with it (review on #3)", async () => {
            const role = await RoleService.create({ companyId: "c2", name: "Asked for meanwhile", baseRole: "EMPLOYEE", grants: [] }, sa)
            // The request is written and not yet committed. Counted before it
            // committed, the delete found none and its cascade took the request.
            await db.query("BEGIN")
            let deleting: Promise<unknown>
            try {
                await db.query(`INSERT INTO "RoleRequest" (id, "companyId", "userId", "roleId", "requestedById", "updatedAt")
                    VALUES ('asked-meanwhile', 'c2', 'e2', $1, 'e2', now())`, [role.id])
                deleting = RoleService.delete(role.id, sa).catch((error: Error) => error.message)
                for (let i = 0; i < 40; i++) {
                    if ((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`)).rows[0].n > 0) break
                    await new Promise(r => setTimeout(r, 50))
                }
            } finally {
                await db.query("COMMIT")
            }
            expect(await deleting).toBe("ROLE_REQUESTED")
            expect(await prisma.roleRequest.count({ where: { id: "asked-meanwhile" } })).toBe(1)
            expect(await prisma.role.count({ where: { id: role.id } })).toBe(1)
            await prisma.roleRequest.delete({ where: { id: "asked-meanwhile" } })
            await RoleService.delete(role.id, sa)
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

    describe("handing roles out (B3)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        const superAdmin = sa.user
        // c1's Admin, with the grants their session carries.
        const admin = { id: "a1", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") }
        // Somebody on a narrower role that may assign: the rule-4 case.
        const deputy = { id: "t1", role: "TEAM_LEADER", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", "employees.assign_role": "COMPANY", "records.view": "COMPANY" }) }
        let hr: string, deputyAdmin: string, payroll: string
        const auditOf = async (entityId: string) =>
            (await db.query(`SELECT action, details FROM "AuditLog" WHERE "entityId" = $1 ORDER BY "createdAt"`, [entityId])).rows
        const idOf = async (company: string, builtIn: string): Promise<string> =>
            (await db.query(`SELECT id FROM "Role" WHERE "companyId" = $1 AND "builtIn" = $2`, [company, builtIn])).rows[0].id

        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
            hr = (await RoleService.create({ companyId: "c1", name: "HR Officer", baseRole: "EMPLOYEE", grants: [{ permission: "dayoff.approve", scope: "COMPANY" }] }, sa)).id
            deputyAdmin = (await RoleService.create({ companyId: "c1", name: "Deputy Admin", baseRole: "ADMIN", grants: [{ permission: "employees.view", scope: "COMPANY" }] }, sa)).id
            payroll = (await RoleService.create({ companyId: "c1", name: "Clients desk", baseRole: "EMPLOYEE", grants: [{ permission: "records.view", scope: "COMPANY" }] }, sa)).id
        })

        it("gives a company's own role, with its base role, in a pair the database accepts", async () => {
            const assignment = await RoleAssignmentService.chosen(prisma, admin, hr, { companyId: "c1", userId: "e1" })
            expect(assignment).toEqual({ role: "EMPLOYEE", roleId: hr })
            await prisma.user.update({ where: { id: "e1" }, data: assignment })
            expect(decodeGrants((await RoleService.forToken("e1", prisma)).grants)).toEqual({ "dayoff.view": "COMPANY", "dayoff.approve": "COMPANY" })
            await prisma.user.update({ where: { id: "e1" }, data: await RoleAssignmentService.builtIn(prisma, "EMPLOYEE", "c1") })
        })

        it("refuses somebody their own role (rule 1)", () =>
            expect(RoleAssignmentService.chosen(prisma, admin, hr, { companyId: "c1", userId: "a1" })).rejects.toThrow("OWN_ROLE"))

        it("gives an ADMIN-based role only as the Super Admin (rule 2)", async () => {
            await expect(RoleAssignmentService.chosen(prisma, admin, deputyAdmin, { companyId: "c1", userId: "e1" })).rejects.toThrow("FORBIDDEN_ROLE_ASSIGNMENT")
            expect(await RoleAssignmentService.chosen(prisma, superAdmin, deputyAdmin, { companyId: "c1", userId: "e1" })).toEqual({ role: "ADMIN", roleId: deputyAdmin })
        })

        it("gives only that company's roles, and says the same of one that does not exist (rule 3)", async () => {
            const otherCompanys = await idOf("c2", "EMPLOYEE")
            expect(otherCompanys).toMatch(/^[0-9a-f-]{36}$/)
            await expect(RoleAssignmentService.chosen(prisma, superAdmin, otherCompanys, { companyId: "c1", userId: "e1" })).rejects.toThrow("ROLE_NOT_IN_COMPANY")
            await expect(RoleAssignmentService.chosen(prisma, admin, "no-such-role", { companyId: "c1", userId: "e1" })).rejects.toThrow("ROLE_NOT_IN_COMPANY")
        })

        it("gives only access the giver holds (rule 4)", async () => {
            await expect(RoleAssignmentService.chosen(prisma, deputy, hr, { companyId: "c1", userId: "e1" })).rejects.toThrow("ROLE_EXCEEDS_YOURS")
            expect((await RoleAssignmentService.chosen(prisma, deputy, payroll, { companyId: "c1", userId: "e1" })).roleId).toBe(payroll)
        })

        it("offers in a dropdown exactly what it would accept", async () => {
            const names = async (actor: any) => (await RoleAssignmentService.assignable(prisma, actor, "c1")).map(r => r.name).sort()
            expect(await names(superAdmin)).toEqual(["Admin", "Clients desk", "Deputy Admin", "Employee", "HR Officer", "Team Leader"])
            expect(await names(admin)).toEqual(["Clients desk", "Employee", "HR Officer", "Team Leader"])
            expect(await names(deputy)).toEqual(["Clients desk"])
        })

        it("answers who can do something, and what somebody can do (§6.5)", async () => {
            await prisma.user.update({ where: { id: "e1" }, data: await RoleAssignmentService.chosen(prisma, admin, hr, { companyId: "c1", userId: "e1" }) })
            const who = await AccessReportService.whoCan("c1", "dayoff.approve")
            expect(who.holders.map(h => [h.user.id, h.role.name, h.scope]).sort()).toEqual([
                ["a1", "Admin", "COMPANY"], ["a1b", "Admin", "COMPANY"], ["e1", "HR Officer", "COMPANY"],
            ])
            // At the scope their role holds it.
            expect((await AccessReportService.whoCan("c1", "tasks.review")).holders.find(h => h.user.id === "t1"))
                .toMatchObject({ role: { name: "Team Leader" }, scope: "TEAM" })
            // Only that company's people.
            expect((await AccessReportService.whoCan("c2", "dayoff.approve")).holders.map(h => h.user.id)).not.toContain("e1")
            await expect(AccessReportService.whoCan("c1", "no.such")).rejects.toThrow("UNKNOWN_PERMISSION")

            const what = await AccessReportService.whatCan("e1")
            // builtIn too, so screens name a built-in role in the reader's language.
            expect(what.role).toEqual({ id: hr, name: "HR Officer", builtIn: null, baseRole: "EMPLOYEE" })
            expect(what.grants).toEqual([
                { permission: "dayoff.view", module: expect.any(String), scope: "COMPANY" },
                { permission: "dayoff.approve", module: expect.any(String), scope: "COMPANY" },
            ])
            await prisma.user.update({ where: { id: "e1" }, data: await RoleAssignmentService.builtIn(prisma, "EMPLOYEE", "c1") })
        })

        it("starts a new account on the company's default role, or the built-in Employee", async () => {
            expect(await RoleAssignmentService.defaultFor(prisma, "c1")).toEqual({ role: "EMPLOYEE", roleId: await idOf("c1", "EMPLOYEE") })
            await RoleService.setDefault("c1", hr, sa)
            expect(await RoleAssignmentService.defaultFor(prisma, "c1")).toEqual({ role: "EMPLOYEE", roleId: hr })
            expect((await RoleAssignmentService.assignable(prisma, admin, "c1")).find(r => r.isDefault)?.name).toBe("HR Officer")
            await expect(RoleService.setDefault("c1", deputyAdmin, sa)).rejects.toThrow("DEFAULT_ROLE_ADMIN")
            await expect(RoleService.setDefault("c1", await idOf("c2", "EMPLOYEE"), sa)).rejects.toThrow("ROLE_NOT_FOUND")
            await RoleService.setDefault("c1", null, sa)
            expect((await auditOf("c1")).filter(a => a.action === "SET_DEFAULT_ROLE").map(a => a.details.after)).toEqual([hr, null])
        })
    })
    describe("asking for a role (B4, §6.12)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") } }
        // HR: may ask for a role, may not give one, and holds leave approval.
        const hrGrants = { "employees.view": "COMPANY", "employees.request_role": "COMPANY", "dayoff.view": "COMPANY", "dayoff.approve": "COMPANY" } as const
        const hr = { user: { id: "hr1", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(hrGrants) } }
        let hrRole: string, leave: string, payroll: string
        const roleOf1 = async (id: string) => (await db.query(`SELECT "roleId" FROM "User" WHERE id = $1`, [id])).rows[0].roleId
        const notes = async (userId: string) => (await db.query(`SELECT type FROM "Notification" WHERE "userId" = $1 ORDER BY "createdAt"`, [userId])).rows.map(r => r.type)

        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
            hrRole = (await RoleService.create({ companyId: "c1", name: "HR Desk", baseRole: "EMPLOYEE", grants: Object.entries(hrGrants).map(([permission, scope]) => ({ permission, scope })) }, sa)).id
            leave = (await RoleService.create({ companyId: "c1", name: "Leave desk", baseRole: "EMPLOYEE", grants: [{ permission: "dayoff.approve", scope: "COMPANY" }] }, sa)).id
            payroll = (await RoleService.create({ companyId: "c1", name: "Payroll desk", baseRole: "EMPLOYEE", grants: [{ permission: "payroll.approve", scope: "COMPANY" }] }, sa)).id
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "roleId", "lastDayOffResetYear", username, "companyId")
                VALUES ('hr1', 'hr1@x', 'p', 'H', 'R', 'EMPLOYEE', $1, 2026, 'hr1', 'c1'),
                       ('new1', 'new1@x', 'p', 'N', 'Ew', 'EMPLOYEE', (SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'), 2026, 'new1', 'c1'),
                       ('new2', 'new2@x', 'p', 'N', 'Two', 'EMPLOYEE', (SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'), 2026, 'new2', 'c1')`, [hrRole])
        })

        it("refuses asking for a role while it is being deleted, as it would a moment later (review on #3)", async () => {
            const going = (await RoleService.create({ companyId: "c1", name: "Going", baseRole: "EMPLOYEE", grants: [] }, sa)).id
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "roleId", "lastDayOffResetYear", username, "companyId")
                VALUES ('new3', 'new3@x', 'p', 'N', 'Three', 'EMPLOYEE', (SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'), 2026, 'new3', 'c1')`)
            // The delete holds the role's row until it commits; the request
            // waits for it, then finds the role gone.
            await db.query("BEGIN")
            let asking: Promise<unknown>
            try {
                await db.query(`DELETE FROM "Role" WHERE id = $1`, [going])
                asking = RoleRequestService.create({ userId: "new3", roleId: going }, hr).catch((error: Error) => error)
                for (let i = 0; i < 40; i++) {
                    if ((await db.query(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`)).rows[0].n > 0) break
                    await new Promise(r => setTimeout(r, 50))
                }
            } finally {
                await db.query("COMMIT")
            }
            expect(((await asking) as Error).message).toBe("ROLE_NOT_IN_COMPANY")
            await expect(RoleRequestService.create({ userId: "new3", roleId: going }, hr)).rejects.toThrow("ROLE_NOT_IN_COMPANY")
            expect(await prisma.roleRequest.count({ where: { userId: "new3" } })).toBe(0)
        })

        it("asks, and the person keeps their role until it is decided", async () => {
            const before = await roleOf1("new1")
            const request = await RoleRequestService.create({ userId: "new1", roleId: leave, note: "New hire" }, hr)
            expect(request).toMatchObject({ status: "PENDING", role: { name: "Leave desk" }, requestedBy: { id: "hr1" } })
            expect(await roleOf1("new1")).toBe(before)
            // Whoever may assign is told; the one who asked is not.
            expect(await notes("a1")).toContain("ROLE_CHANGE_ASKED")
            expect(await notes("hr1")).not.toContain("ROLE_CHANGE_ASKED")
            // One waiting per person — the database says so too.
            await expect(RoleRequestService.create({ userId: "new1", roleId: leave }, hr)).rejects.toThrow("ALREADY_PENDING")

            // Somebody who only asks cannot decide, not even another's request.
            await expect(RoleRequestService.decide(request.id, { approve: true }, hr)).rejects.toThrow("FORBIDDEN")
            await expect(RoleRequestService.decide(request.id, { approve: false }, admin)).rejects.toThrow("REASON_REQUIRED")
            const approved = await RoleRequestService.decide(request.id, { approve: true }, admin)
            expect(approved).toMatchObject({ status: "APPROVED", decidedBy: { id: "a1" } })
            expect(await roleOf1("new1")).toBe(leave)
            expect(await notes("hr1")).toContain("ROLE_CHANGE_APPROVED")
            await expect(RoleRequestService.decide(request.id, { approve: false, note: "no" }, admin)).rejects.toThrow("ALREADY_DECIDED")
        })

        it("asks only for what the asker could give (rules 1-4)", async () => {
            await expect(RoleRequestService.create({ userId: "hr1", roleId: leave }, hr)).rejects.toThrow("OWN_ROLE")
            await expect(RoleRequestService.create({ userId: "new1", roleId: payroll }, hr)).rejects.toThrow("ROLE_EXCEEDS_YOURS")
            const deputy = (await db.query(`SELECT id FROM "Role" WHERE "companyId" = 'c1' AND name = 'Deputy Admin'`)).rows[0]?.id
            if (deputy) await expect(RoleRequestService.create({ userId: "new1", roleId: deputy }, hr)).rejects.toThrow("FORBIDDEN_ROLE_ASSIGNMENT")
            await expect(RoleRequestService.create({ userId: "new1", roleId: leave }, hr)).rejects.toThrow("SAME_ROLE")
            // Changing an Admin is the Super Admin's (rule 7), asked or not.
            await expect(RoleRequestService.create({ userId: "a1", roleId: leave }, hr)).rejects.toThrow("ADMIN_IS_SUPER_ADMINS")
        })

        it("is checked again for the asker when decided, with what they hold now", async () => {
            const request = await RoleRequestService.create({ userId: "new2", roleId: leave }, hr)
            // Meanwhile the asker's role loses leave approval.
            await RoleService.update({ id: hrRole, grants: [{ permission: "employees.request_role", scope: "COMPANY" }] }, sa)
            await expect(RoleRequestService.decide(request.id, { approve: true }, admin)).rejects.toThrow("ROLE_EXCEEDS_YOURS")
            // Not applied, so still waiting, and they keep their role.
            expect((await RoleRequestService.get(request.id)).status).toBe("PENDING")
            expect(await roleOf1("new2")).not.toBe(leave)
            await RoleRequestService.cancel(request.id, hr)
            await RoleService.update({ id: hrRole, grants: Object.entries(hrGrants).map(([permission, scope]) => ({ permission, scope })) }, sa)
        })

        it("is settled by a direct change, so a later approval cannot undo it", async () => {
            const request = await RoleRequestService.create({ userId: "new2", roleId: leave }, hr)
            const { UserService } = await import("@/lib/services/user.service")
            await UserService.update({ id: "new2", roleId: payroll } as any, admin)
            expect((await RoleRequestService.get(request.id)).status).toBe("CANCELLED")
            await expect(RoleRequestService.decide(request.id, { approve: true }, admin)).rejects.toThrow("ALREADY_DECIDED")
            expect(await roleOf1("new2")).toBe(payroll)
        })

        it("nobody decides what they asked for, whatever else they hold", async () => {
            const lead = { user: { ...hr.user, grants: encodeGrants({ ...hrGrants, "employees.assign_role": "COMPANY" }) } }
            const request = await RoleRequestService.create({ userId: "new2", roleId: leave }, lead)
            await expect(RoleRequestService.decide(request.id, { approve: true }, lead)).rejects.toThrow("OWN_REQUEST")
            await RoleRequestService.decide(request.id, { approve: false, note: "Not now" }, admin)
            expect(await RoleRequestService.get(request.id)).toMatchObject({ status: "REJECTED", decisionNote: "Not now" })
            expect(await notes("hr1")).toContain("ROLE_CHANGE_REJECTED")
        })

        it("reminds the deciders after three working days, once per interval", async () => {
            const request = await RoleRequestService.create({ userId: "new2", roleId: leave }, hr)
            await db.query(`UPDATE "RoleRequest" SET "createdAt" = '2026-09-27T09:00:00Z' WHERE id = $1`, [request.id]) // a Sunday
            // Wednesday morning: three working days have not passed yet.
            expect((await RoleRequestService.remindStale(new Date("2026-09-30T08:00:00Z"))).reminded).toBe(0)
            expect((await RoleRequestService.remindStale(new Date("2026-09-30T10:00:00Z"))).reminded).toBe(1)
            // Not again until another three have.
            expect((await RoleRequestService.remindStale(new Date("2026-10-01T10:00:00Z"))).reminded).toBe(0)
            expect(await notes("a1")).toContain("ROLE_CHANGE_WAITING")
            await RoleRequestService.cancel(request.id, hr)
        })

        it("hires on the default role, with a request for the one HR picked", async () => {
            const hiring = { user: { ...hr.user, grants: encodeGrants({ ...hrGrants, "employees.create": "COMPANY" }) } }
            const { UserService } = await import("@/lib/services/user.service")
            // A role HR could not give is refused before any account exists.
            await expect(UserService.create({ firstName: "No", lastName: "Body", email: "nobody@x.co", password: "a-long-password-123", role: "EMPLOYEE", roleId: payroll } as any, hiring))
                .rejects.toThrow("ROLE_EXCEEDS_YOURS")
            expect((await db.query(`SELECT count(*)::int AS n FROM "User" WHERE email = 'nobody@x.co'`)).rows[0].n).toBe(0)

            const created: any = await UserService.create({ firstName: "Nour", lastName: "Hired", email: "nour@x.co", password: "a-long-password-123", role: "EMPLOYEE", roleId: leave } as any, hiring)
            const employee = (await db.query(`SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'EMPLOYEE'`)).rows[0].id
            expect(await roleOf1(created.id)).toBe(employee)
            expect(await RoleRequestService.get(created.roleRequestId)).toMatchObject({ status: "PENDING", role: { id: leave } })
            await RoleRequestService.cancel(created.roleRequestId, hiring)
        })

        it("refuses in the database a request across companies", () =>
            refused(`INSERT INTO "RoleRequest"(id, "companyId", "userId", "roleId", "requestedById", "updatedAt")
                VALUES ('rr-x', 'c2', 'new1', (SELECT id FROM "Role" WHERE "companyId" = 'c2' AND "builtIn" = 'EMPLOYEE'), 'hr1', now())`))
    })
    describe("acting roles (B4, §6.13)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") } }
        const inAWeek = () => new Date(Date.now() + 7 * 86400000)
        const row = async (id: string) => (await db.query(`SELECT role, "roleId", "actingUntil", "returnRoleId", "teamLeaderId" FROM "User" WHERE id = $1`, [id])).rows[0]
        const builtIn = async (kind: string) => (await db.query(`SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = $1`, [kind])).rows[0].id
        let cover: string, employee: string, leader: string

        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
            cover = (await RoleService.create({ companyId: "c1", name: "Branch cover", baseRole: "EMPLOYEE", grants: [{ permission: "dayoff.approve", scope: "COMPANY" }] }, sa)).id
            employee = await builtIn("EMPLOYEE")
            leader = await builtIn("TEAM_LEADER")
            await db.query(`INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "roleId", "lastDayOffResetYear", username, "companyId")
                VALUES ('act1', 'act1@x', 'p', 'Act', 'One', 'EMPLOYEE', $1, 2026, 'act1', 'c1'),
                       ('act2', 'act2@x', 'p', 'Act', 'Two', 'EMPLOYEE', $1, 2026, 'act2', 'c1'),
                       ('rep1', 'rep1@x', 'p', 'Rep', 'One', 'EMPLOYEE', $1, 2026, 'rep1', 'c1')`, [employee])
        })

        it("holds the role until the date, then returns them — and says so", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            const until = inAWeek()
            await UserService.update({ id: "act1", roleId: cover, actingUntil: until } as any, admin)
            expect(await row("act1")).toMatchObject({ roleId: cover, returnRoleId: employee })
            // Not yet.
            expect(await RoleAssignmentService.endActing(new Date())).toMatchObject({ returned: 0 })
            expect((await row("act1")).roleId).toBe(cover)
            // The session carries the acting role until the date, and the role
            // returned to from then on, before the nightly job has moved them.
            const acting = await RoleService.forToken("act1", prisma, new Date())
            expect(acting).toMatchObject({ roleId: cover, actingEnded: undefined })
            expect(decodeGrants(acting.grants)).toMatchObject({ "dayoff.approve": "COMPANY" })
            const over = await RoleService.forToken("act1", prisma, new Date(until.getTime() + 1000))
            expect(over).toMatchObject({ roleId: cover, role: "EMPLOYEE", actingEnded: true })
            expect(decodeGrants(over.grants)).toEqual(BUILT_IN_GRANTS.EMPLOYEE)
            // The day comes.
            expect(await RoleAssignmentService.endActing(new Date(until.getTime() + 1000))).toMatchObject({ returned: 1 })
            expect(await row("act1")).toMatchObject({ roleId: employee, actingUntil: null, returnRoleId: null })
            const audit = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'END_ACTING_ROLE' AND "entityId" = 'act1'`)).rows
            expect(audit[0].details).toMatchObject({ from: cover, to: employee })
        })

        it("returns them to their own role, however many covers in between", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            await UserService.update({ id: "act2", roleId: cover, actingUntil: inAWeek() } as any, admin)
            await UserService.update({ id: "act2", roleId: leader, actingUntil: inAWeek() } as any, admin)
            expect(await row("act2")).toMatchObject({ roleId: leader, returnRoleId: employee })
            // A permanent change ends the cover.
            await UserService.update({ id: "act2", roleId: cover } as any, admin)
            expect(await row("act2")).toMatchObject({ roleId: cover, actingUntil: null, returnRoleId: null })
            await UserService.update({ id: "act2", roleId: employee } as any, admin)
        })

        it("takes a return date as the start of that day in the company's calendar", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            const day = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
            await UserService.update({ id: "act1", roleId: cover, actingUntil: day } as any, admin)
            const until: Date = (await row("act1")).actingUntil
            // Midnight in Cairo, which is the evening before in UTC.
            const cairo = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(until)
            expect(cairo).toBe(`${day}, 00:00`)
            await UserService.update({ id: "act1", roleId: employee } as any, admin)
        })

        it("refuses an end in the past, or a date with no role to act in", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            await expect(UserService.update({ id: "act1", roleId: cover, actingUntil: new Date(Date.now() - 1000) } as any, admin)).rejects.toThrow("ACTING_END_IN_PAST")
            await expect(UserService.update({ id: "act1", actingUntil: inAWeek() } as any, admin)).rejects.toThrow("ACTING_NEEDS_ROLE")
        })

        it("holds a return the rules would refuse, and tells the company", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            const until = inAWeek()
            await UserService.update({ id: "act2", roleId: leader, actingUntil: until } as any, admin)
            await UserService.update({ id: "rep1", teamLeaderId: "act2" } as any, admin)
            // Held, the session keeps the acting access too.
            expect(await RoleService.forToken("act2", prisma, new Date(until.getTime() + 1000))).toMatchObject({ roleId: leader, actingEnded: undefined })
            const result = await RoleAssignmentService.endActing(new Date(until.getTime() + 1000))
            expect(result).toMatchObject({ held: 1 })
            expect((await row("act2")).roleId).toBe(leader)
            const told = (await db.query(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId" = 'a1' AND type = 'ROLE_ACTING_HELD'`)).rows[0].n
            expect(told).toBeGreaterThan(0)
            // Once their team is elsewhere, they return.
            await UserService.update({ id: "rep1", teamLeaderId: null } as any, admin)
            expect(await RoleAssignmentService.endActing(new Date(until.getTime() + 1000))).toMatchObject({ returned: 1 })
            expect((await row("act2")).roleId).toBe(employee)
        })

        it("keeps a role somebody will return to from being deleted", async () => {
            const { UserService } = await import("@/lib/services/user.service")
            const spare = (await RoleService.create({ companyId: "c1", name: "Spare", baseRole: "EMPLOYEE", grants: [] }, sa)).id
            await UserService.update({ id: "act1", roleId: spare } as any, admin)
            await UserService.update({ id: "act1", roleId: cover, actingUntil: inAWeek() } as any, admin)
            await expect(RoleService.delete(spare, sa)).rejects.toThrow("ROLE_HELD")
            await UserService.update({ id: "act1", roleId: employee } as any, admin)
        })

        it("carries the end date through a request", async () => {
            const hr = { user: { id: "hr1", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "employees.view": "COMPANY", "employees.request_role": "COMPANY", "dayoff.view": "COMPANY", "dayoff.approve": "COMPANY" }) } }
            const until = inAWeek()
            const request = await RoleRequestService.create({ userId: "act1", roleId: cover, actingUntil: until }, hr)
            await RoleRequestService.decide(request.id, { approve: true }, admin)
            expect(await row("act1")).toMatchObject({ roleId: cover, returnRoleId: employee })
            expect((await row("act1")).actingUntil.getTime()).toBe(until.getTime())
        })

        it("refuses in the database an end date with nowhere to return to", () =>
            refused(`UPDATE "User" SET "actingUntil" = now() WHERE id = 'rep1'`))
    })
    describe("copying roles, and offering a template change (B4, §6.7-6.8)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        const names = async (companyId: string) => (await RoleService.listForCompany(companyId)).map(r => r.name).sort()

        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c7', 'Seven', now()), ('c8', 'Eight', now())`)
            await RoleService.seedBuiltInRoles(prisma as any, "c7")
            await RoleService.seedBuiltInRoles(prisma as any, "c8")
        })

        it("copies a company's roles as independent copies, never over one it has", async () => {
            // (Built on audit.view until it was reserved — nothing checks it yet —
            // and saving a role or template with it is refused.)
            const template = await RoleTemplateService.create({ name: "Auditor", baseRole: "EMPLOYEE", grants: [{ permission: "debts.view", scope: "COMPANY" }] }, sa)
            const auditor = await RoleService.create({ companyId: "c7", name: "Auditor", fromTemplateId: template.id }, sa)
            const trainee = await RoleService.create({ companyId: "c7", name: "Trainee", baseRole: "EMPLOYEE", grants: [{ permission: "tasks.view", scope: "TEAM" }] }, sa)
            await RoleService.create({ companyId: "c8", name: "trainee", baseRole: "EMPLOYEE", grants: [] }, sa)
            await RoleService.setDefault("c7", trainee.id, sa)
            const employee7 = (await RoleService.listForCompany("c7")).find(r => r.builtIn === "EMPLOYEE")!
            await RoleService.update({ id: employee7.id, grants: [{ permission: "records.view", scope: "COMPANY" }] }, sa)

            const result = await RoleService.copyFrom("c8", "c7", { includeBuiltIn: true }, sa)
            expect(result).toEqual({ copied: ["Auditor"], skipped: ["Trainee"], builtInsUpdated: ["Employee"], defaultRole: null })
            expect(await names("c8")).toEqual(["Admin", "Auditor", "Employee", "Team Leader", "trainee"])
            const copy = (await RoleService.listForCompany("c8")).find(r => r.name === "Auditor")!
            expect(copy).toMatchObject({ copiedFromTemplateId: template.id, grants: auditor.grants })
            expect((await RoleService.listForCompany("c8")).find(r => r.builtIn === "EMPLOYEE")!.grants).toEqual([{ permission: "records.view", scope: "COMPANY" }])
            // A copy: changing the source changes nothing here.
            await RoleService.update({ id: auditor.id, grants: [] }, sa)
            expect((await RoleService.getById(copy.id)).grants).toEqual(auditor.grants)
            await expect(RoleService.copyFrom("c8", "c8", {}, sa)).rejects.toThrow("SAME_COMPANY")
        })

        it("offers a template change with each role's difference, and applies it only where picked", async () => {
            const template = await RoleTemplateService.create({ name: "Cashier", baseRole: "EMPLOYEE", grants: [{ permission: "costs.view", scope: "COMPANY" }] }, sa)
            const in7 = await RoleService.create({ companyId: "c7", name: "Cashier", fromTemplateId: template.id }, sa)
            const in8 = await RoleService.create({ companyId: "c8", name: "Cashier", fromTemplateId: template.id }, sa)
            await RoleTemplateService.update({ id: template.id, grants: [{ permission: "costs.view", scope: "COMPANY" }, { permission: "clients.view", scope: "COMPANY" }] }, sa)

            const offer = await RoleTemplateService.offers(template.id)
            expect(offer.roles.map(r => [r.companyName, r.difference.added])).toEqual([["Eight", ["clients.view"]], ["Seven", ["clients.view"]]])
            await RoleTemplateService.applyTo(template.id, [in7.id], {}, sa)
            expect((await RoleService.getById(in7.id)).grants.map(g => g.permission).sort()).toEqual(["clients.view", "costs.view"])
            expect((await RoleService.getById(in7.id)).version).toBe(in7.version + 1)
            expect((await RoleService.getById(in8.id)).grants.map(g => g.permission)).toEqual(["costs.view"])
            // Only its own copies.
            const other = await RoleService.create({ companyId: "c8", name: "Other", baseRole: "EMPLOYEE", grants: [] }, sa)
            await expect(RoleTemplateService.applyTo(template.id, [other.id], {}, sa)).rejects.toThrow("NOT_FROM_TEMPLATE")
        })
    })
    describe("asking the Super Admin for a role change (B4, §6.9)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") } }
        const employee = { user: { id: "e1", role: "EMPLOYEE", companyId: "c1", grants: builtInGrantsToken("EMPLOYEE") } }

        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
        })

        it("is asked by the company's Admins, about their own roles, and the Super Admin is told", async () => {
            const leader = (await RoleService.listForCompany("c1")).find(r => r.builtIn === "TEAM_LEADER")!
            const request = await RoleChangeRequestService.create({ roleId: leader.id, description: "Team Leaders should approve leave" }, admin)
            expect(request).toMatchObject({ status: "OPEN", role: { name: "Team Leader" }, company: { name: "One" } })
            const told = (await db.query(`SELECT type FROM "Notification" WHERE "superAdminId" = 'sa'`)).rows.map(r => r.type)
            expect(told).toContain("ROLE_CHANGE_FOR_SUPER_ADMIN")

            await expect(RoleChangeRequestService.create({ description: "Please" }, employee)).rejects.toThrow("FORBIDDEN")
            const other = (await RoleService.listForCompany("c2")).find(r => r.builtIn === "EMPLOYEE")!
            await expect(RoleChangeRequestService.create({ roleId: other.id, description: "Not ours" }, admin)).rejects.toThrow("ROLE_NOT_IN_COMPANY")
            // A company sees its own; the Super Admin sees everyone's.
            expect((await RoleChangeRequestService.list(admin, {})).every(r => r.companyId === "c1")).toBe(true)
            expect((await RoleChangeRequestService.list(sa, { status: "OPEN" })).map(r => r.id)).toContain(request.id)
        })

        it("is answered by the Super Admin alone, once, and the Admin is told", async () => {
            const request = await RoleChangeRequestService.create({ description: "A role for our auditors" }, admin)
            await expect(RoleChangeRequestService.respond(request.id, { status: "DONE" }, admin)).rejects.toThrow("FORBIDDEN")
            await expect(RoleChangeRequestService.respond(request.id, { status: "DECLINED" }, sa)).rejects.toThrow("REASON_REQUIRED")
            const answered = await RoleChangeRequestService.respond(request.id, { status: "DONE", response: "Added an Auditor role" }, sa)
            expect(answered).toMatchObject({ status: "DONE", response: "Added an Auditor role", respondedBy: { firstName: "Super" } })
            await expect(RoleChangeRequestService.respond(request.id, { status: "DECLINED", response: "no" }, sa)).rejects.toThrow("ALREADY_DECIDED")
            const told = (await db.query(`SELECT type FROM "Notification" WHERE "userId" = 'a1'`)).rows.map(r => r.type)
            expect(told).toContain("ROLE_CHANGE_DONE")
        })
    })
    describe("separation of duties (B4, §6.11)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        const both = [{ permission: "payroll.prepare", scope: "COMPANY" }, { permission: "payroll.approve", scope: "COMPANY" }]

        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
        })

        it("asks before a role holds both sides of a pair, and records the answer", async () => {
            await expect(RoleService.create({ companyId: "c2", name: "Payroll all", baseRole: "EMPLOYEE", grants: both }, sa)).rejects.toThrow("SEPARATION_UNACKNOWLEDGED")
            const role = await RoleService.create({ companyId: "c2", name: "Payroll all", baseRole: "EMPLOYEE", grants: both, acknowledgeConflicts: true }, sa)
            const [audit] = (await db.query(`SELECT details FROM "AuditLog" WHERE action = 'CREATE_ROLE' AND "entityId" = $1`, [role.id])).rows
            expect(audit.details.separationOfDuties).toEqual({ pairs: ["prepare_approve_payroll"], acknowledged: true })
            // Held already: editing something else does not ask again…
            await RoleService.update({ id: role.id, grants: [...both, { permission: "records.view", scope: "COMPANY" }] }, sa)
            // …a new pair does.
            await expect(RoleService.update({ id: role.id, grants: [...both, { permission: "salary.edit", scope: "COMPANY" }] }, sa)).rejects.toThrow("SEPARATION_UNACKNOWLEDGED")
        })

        it("asks of templates too", async () => {
            await expect(RoleTemplateService.create({ name: "Payroll all", baseRole: "EMPLOYEE", grants: both }, sa)).rejects.toThrow("SEPARATION_UNACKNOWLEDGED")
            await RoleTemplateService.create({ name: "Payroll all", baseRole: "EMPLOYEE", grants: both, acknowledgeConflicts: true }, sa)
        })
    })
    describe("periodic access review (B5, §6.14)", () => {
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        const admin = { user: { id: "a1", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") } }
        const otherAdmin = { user: { id: "a1b", role: "ADMIN", companyId: "c1", grants: builtInGrantsToken("ADMIN") } }

        beforeAll(async () => {
            await db.query(`INSERT INTO "SuperAdmin" (id, email, password, "firstName", "lastName", username, "updatedAt")
                VALUES ('sa', 'sa@test', 'x', 'Super', 'Admin', 'sa', now()) ON CONFLICT DO NOTHING`)
            // Two Admins at work, so each can review the other (the last-Admin
            // test left the second suspended).
            await db.query(`UPDATE "User" SET status = 'ACTIVE' WHERE id = 'a1b'`)
        })

        it("is off until the Super Admin switches it on, and then opens when due", async () => {
            expect((await AccessReviewService.runDue()).opened).toBe(0)
            await expect(AccessReviewService.configure("c1", { enabled: true, months: 3 }, admin)).rejects.toThrow("FORBIDDEN")
            await AccessReviewService.configure("c1", { enabled: true, months: 3 }, sa)
            expect((await AccessReviewService.runDue()).opened).toBe(1)
            // Scheduled three months on, not again today.
            expect((await AccessReviewService.runDue()).opened).toBe(0)
            const next = (await db.query(`SELECT "accessReviewNextAt" AS at FROM "Company" WHERE id = 'c1'`)).rows[0].at
            expect(next.getTime() - Date.now()).toBeGreaterThan(80 * 86400000)
        })

        it("lists who holds each reviewed permission, through which role, and tells the Admins", async () => {
            const [review] = await AccessReviewService.list(admin, { status: "OPEN" })
            const lines = review.lines.map(l => `${l.userId}:${l.permission}`)
            expect(lines).toContain("a1:payroll.approve")
            expect(lines).toContain("a1:employees.assign_role")
            // Which built-in role a line names, so screens can translate it;
            // the line keeps only the name.
            const kinds = (await db.query(`SELECT name, "builtIn" FROM "Role" WHERE "companyId" = 'c1'`)).rows
            for (const l of review.lines) expect(l.roleBuiltIn).toBe(kinds.find(k => k.name === l.roleName)?.builtIn ?? null)
            expect(review.lines.find(l => l.userId === "a1")!.roleBuiltIn).toBe("ADMIN")
            // Only people in this company.
            expect(review.lines.every(l => !["e2"].includes(l.userId ?? ""))).toBe(true)
            expect((await db.query(`SELECT count(*)::int AS n FROM "Notification" WHERE "userId" = 'a1b' AND type = 'ROLE_ACCESS_REVIEW'`)).rows[0].n).toBe(1)
            // Stored as a key and its details, for the reader's language, with its English.
            const [row] = (await db.query(`SELECT message, "messageKey", "messageParams" FROM "Notification" WHERE "userId" = 'a1b' AND type = 'ROLE_ACCESS_REVIEW'`)).rows
            expect(row).toEqual({
                message: `An access review is ready: ${review.lines.length} lines to confirm.`,
                messageKey: "notice_access_review_ready",
                messageParams: { count: review.lines.length },
            })
        })

        it("is answered line by line, never for one's own access, and a change goes to the Super Admin", async () => {
            const [review] = await AccessReviewService.list(admin, { status: "OPEN" })
            const own = review.lines.find(l => l.userId === "a1")!
            await expect(AccessReviewService.answer(own.id, { decision: "CONFIRMED" }, admin)).rejects.toThrow("OWN_LINE")
            await AccessReviewService.answer(own.id, { decision: "CONFIRMED" }, otherAdmin)
            await expect(AccessReviewService.answer(own.id, { decision: "CONFIRMED" }, otherAdmin)).rejects.toThrow("ALREADY_ANSWERED")

            const another = review.lines.find(l => l.userId !== "a1" && l.userId !== "a1b")!
            await expect(AccessReviewService.answer(another.id, { decision: "CHANGE_REQUESTED" }, admin)).rejects.toThrow("REASON_REQUIRED")
            // The person has moved to another role since the review opened: the
            // request is about the role that was reviewed, not their new one.
            const { userId: who, roleId: reviewed } = (await db.query(`SELECT "userId", "roleId" FROM "AccessReviewLine" WHERE id = $1`, [another.id])).rows[0]
            expect(reviewed).toBeTruthy()
            const { baseRole } = (await db.query(`SELECT "baseRole" FROM "Role" WHERE id = $1`, [reviewed])).rows[0]
            await db.query(`INSERT INTO "Role"(id, "companyId", name, "baseRole", "updatedAt") VALUES ('r-moved', 'c1', 'Moved since', $1, now())`, [baseRole])
            await db.query(`UPDATE "User" SET "roleId" = 'r-moved' WHERE id = $1`, [who])
            await AccessReviewService.answer(another.id, { decision: "CHANGE_REQUESTED", note: "No longer needs payroll" }, admin)
            const asked = (await db.query(`SELECT description, "roleId" FROM "RoleChangeRequest" WHERE description LIKE 'Access review:%' ORDER BY "createdAt"`)).rows
            expect(asked.at(-1).description).toContain("No longer needs payroll")
            expect(asked.at(-1).roleId).toBe(reviewed)
            await db.query(`UPDATE "User" SET "roleId" = $1 WHERE id = $2`, [reviewed, who])
            await db.query(`DELETE FROM "Role" WHERE id = 'r-moved'`)
        })

        it("keeps its lines as evidence when the person or the role is deleted", async () => {
            // Deleting clears the link and keeps the line, with the name it had.
            const rules = (await db.query(`SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('AccessReviewLine_userId_fkey', 'AccessReviewLine_roleId_fkey') ORDER BY conname`)).rows
            expect(rules).toEqual([
                { conname: "AccessReviewLine_roleId_fkey", confdeltype: "n" },
                { conname: "AccessReviewLine_userId_fkey", confdeltype: "n" },
            ])
            const [review] = await AccessReviewService.list(sa, { companyId: "c1" })
            expect(review.lines.every(l => l.userName.length > 0)).toBe(true)
        })

        it("is done when every line is answered, and the Super Admin sees which are not", async () => {
            const [review] = await AccessReviewService.list(sa, { status: "OPEN", companyId: "c1" })
            for (const line of review.lines.filter(l => !l.decision)) await AccessReviewService.answer(line.id, { decision: "CONFIRMED" }, sa)
            expect((await AccessReviewService.list(sa, { status: "OPEN", companyId: "c1" }))).toEqual([])
            const [done] = await AccessReviewService.list(sa, { companyId: "c1" })
            expect(done).toMatchObject({ status: "COMPLETED" })
            expect(done.completedAt).not.toBeNull()
        })

        it("stops when switched off, and keeps what was reviewed", async () => {
            await AccessReviewService.configure("c1", { enabled: false, months: 3 }, sa)
            await db.query(`UPDATE "Company" SET "accessReviewNextAt" = NULL WHERE id = 'c1'`)
            expect((await AccessReviewService.runDue(new Date(Date.now() + 400 * 86400000))).opened).toBe(0)
            expect((await AccessReviewService.list(sa, { companyId: "c1" })).length).toBe(1)
        })
    })

    describe("built-in role names in the reader's language", () => {
        it("the preview says which built-in role it is, and a made one is not", async () => {
            const admin = (await db.query(`SELECT id FROM "Role" WHERE "companyId" = 'c1' AND "builtIn" = 'ADMIN'`)).rows[0].id
            expect(await RoleService.previewOf(admin)).toMatchObject({ roleName: "Admin", roleBuiltIn: "ADMIN" })
            await db.query(`INSERT INTO "Role"(id, "companyId", name, "baseRole", "updatedAt") VALUES ('r-label', 'c1', 'Label check', 'EMPLOYEE', now())`)
            expect(await RoleService.previewOf("r-label")).toMatchObject({ roleName: "Label check", roleBuiltIn: null })
        })

        it("\"who can do this?\" says which built-in role, both ways", async () => {
            const who = await AccessReportService.whoCan("c1", "payroll.approve")
            expect(who.holders.find(h => h.user.id === "a1")!.role.builtIn).toBe("ADMIN")
            expect((await AccessReportService.whatCan("a1")).role!.builtIn).toBe("ADMIN")
        })
    })

    describe("a status filter the lists don't know", () => {
        // ?status=NOPE reached the database as an enum value it can't read,
        // and came back as a 500. It matches nothing, as on the other lists.
        const sa = { user: { id: "sa", role: "SUPER_ADMIN" } }
        it("matches nothing, on each of the three lists", async () => {
            expect(await AccessReviewService.list(sa as any, { status: "NOPE" })).toEqual([])
            expect(await RoleRequestService.list(sa as any, { status: "NOPE" })).toEqual([])
            expect(await RoleChangeRequestService.list(sa as any, { status: "NOPE" })).toEqual([])
        })

        it("and a real status still filters", async () => {
            expect((await AccessReviewService.list(sa as any, { status: "COMPLETED", companyId: "c1" })).length).toBe(1)
        })
    })
})
