import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The account status route (POST /api/users/<id>/status, which calls
 * UserService.updateStatus) and its audit entry, against a real Postgres.
 *
 * A company's Admin may use it (employees.change_status, the same rule as the
 * status field of an edit), but its entry named every caller as a Super
 * Admin. A company Admin isn't one, so the entry broke its foreign key: the
 * status was saved, and then the route answered 500. The entry now names a
 * company's own people as themselves, as an edit and a delete do.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'Nile Works', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1'),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1'),
 ('e2', 'e2@x', 'p', 'Eman', 'One', 'EMPLOYEE', 2026, 'e2', 'c1');
INSERT INTO "SuperAdmin"(id, email, password, "firstName", "lastName", username, "updatedAt") VALUES
 ('sa1', 'sa@x', 'p', 'Sam', 'Admin', 'sa1', now());
`

const admin = { user: withGrants({ id: "a1", role: "ADMIN", companyId: "c1" } as any) } as any
const superAdmin = { user: { id: "sa1", role: "SUPER_ADMIN", companyId: null } } as any

describe.skipIf(!ADMIN_URL)("the account status route's audit entry, in Postgres", () => {
    const dbName = `status_route_audit_test_${Date.now()}`
    let db: Client
    let prisma: typeof import("@/lib/prisma").prisma
    let Users: typeof import("@/lib/services/user.service").UserService

    const entries = async (id: string) => (await db.query(
        `SELECT "userId", "superAdminId", details FROM "AuditLog" WHERE action = 'UPDATE_USER_STATUS' AND "entityId" = $1 ORDER BY "createdAt"`, [id],
    )).rows

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
    }, 180_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    it("a company's Admin suspends someone: saved, answered, and the entry names the Admin", async () => {
        await expect(Users.updateStatus("e1", "SUSPENDED", admin)).resolves.toEqual({ id: "e1", status: "SUSPENDED" })
        expect((await db.query(`SELECT status FROM "User" WHERE id = 'e1'`)).rows[0].status).toBe("SUSPENDED")
        expect(await entries("e1")).toEqual([
            { userId: "a1", superAdminId: null, details: { status: { old: "OFFLINE", new: "SUSPENDED" } } },
        ])
    })

    it("and lets them back in, the same way", async () => {
        await expect(Users.updateStatus("e1", "ACTIVE", admin)).resolves.toEqual({ id: "e1", status: "ACTIVE" })
        expect((await entries("e1")).map(e => [e.userId, e.superAdminId, e.details.status.new])).toEqual([
            ["a1", null, "SUSPENDED"],
            ["a1", null, "ACTIVE"],
        ])
    })

    it("the Super Admin is named as the Super Admin", async () => {
        await expect(Users.updateStatus("e2", "SUSPENDED", superAdmin)).resolves.toEqual({ id: "e2", status: "SUSPENDED" })
        expect(await entries("e2")).toEqual([
            { userId: null, superAdminId: "sa1", details: { status: { old: "OFFLINE", new: "SUSPENDED" } } },
        ])
    })

    it("the same status again writes no entry", async () => {
        await Users.updateStatus("e2", "SUSPENDED", admin)
        expect(await entries("e2")).toHaveLength(1)
    })
})
