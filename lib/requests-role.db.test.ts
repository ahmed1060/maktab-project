import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Role requests on the one Requests page (UI_PLAN.md §2.3, part 5b), against
 * a real Postgres: those one asked for on Mine, the company's that somebody
 * else asked for under To review for whoever gives roles, Done in order of
 * when each was decided or withdrawn, and a decision's notices opening it
 * there, or the person's own profile.
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
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('h1', 'h1@x', 'p', 'Hoda', 'Samir', 'EMPLOYEE', 2026, 'h1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`

/**
 * Hoda asks for roles. Hers: one waiting for Ehab, and for Eman one
 * rejected, one withdrawn and one approved; the rejected one touched since
 * it was decided. Amal's own, waiting for Eman.
 */
const REQUESTS = `
INSERT INTO "Role"(id, "companyId", name, "baseRole", "updatedAt") VALUES ('accountant', 'c1', 'Accountant', 'EMPLOYEE', now()), ('clerk', 'c1', 'Clerk', 'EMPLOYEE', now());
INSERT INTO "RoleRequest"(id, "companyId", "userId", "roleId", "requestedById", note, status, "decidedById", "decisionNote", "decidedAt", "createdAt", "updatedAt") VALUES
 ('r-wait', 'c1', 'e1', 'accountant', 'h1', 'Joins the accounts team', 'PENDING', NULL, NULL, NULL, '2026-10-28T08:00:00Z', '2026-10-28T08:00:00Z'),
 ('r-no', 'c1', 'e2', 'accountant', 'h1', NULL, 'REJECTED', 'a1', 'Wait for the audit', '2026-10-21T09:00:00Z', '2026-10-20T08:00:00Z', '2026-10-30T09:00:00Z'),
 ('r-back', 'c1', 'e2', 'accountant', 'h1', NULL, 'CANCELLED', NULL, NULL, '2026-10-23T09:00:00Z', '2026-10-22T08:00:00Z', '2026-10-23T09:00:00Z'),
 ('r-yes', 'c1', 'e2', 'accountant', 'h1', NULL, 'APPROVED', 'a1', NULL, '2026-10-25T09:00:00Z', '2026-10-24T08:00:00Z', '2026-10-25T09:00:00Z'),
 ('r-amal', 'c1', 'e2', 'accountant', 'a1', NULL, 'PENDING', NULL, NULL, NULL, '2026-10-29T08:00:00Z', '2026-10-29T08:00:00Z');
`

describe.skipIf(!ADMIN_URL)("role requests on the Requests page, in Postgres", () => {
    const dbName = `requests_role_test_${Date.now()}`
    let db: Client
    const query = (fields: object = {}) => ({ tab: "review" as const, show: "waiting" as const, kind: "role" as const, search: "", personId: "", companyId: null, page: 1, limit: 10, ...fields })
    const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
    // A company's own role on the Employee base, asking for roles: HR (ROLES_PLAN.md §6.12).
    const hoda = { id: "h1", role: "EMPLOYEE", companyId: "c1", grants: "10.3" }
    const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })

    beforeAll(async () => {
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`CREATE DATABASE ${dbName}`)
        await admin.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
        await db.query(REQUESTS)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        vi.useRealTimers()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    it("on Mine are those one asked for, waiting, then decided or withdrawn, the latest decided first", { timeout: 60_000 }, async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        expect((await requestFeed(hoda, query({ tab: "mine" }))).rows.map(r => r.id)).toEqual(["r-wait"])
        const done = await requestFeed(hoda, query({ tab: "mine", show: "done" }))
        // The rejected one was touched since, which doesn't move it.
        expect(done.rows.map(r => r.id)).toEqual(["r-yes", "r-back", "r-no"])
        expect(done.rows[2]).toMatchObject({ who: { name: "Hoda Samir" }, what: "Accountant", role: { person: { name: "Eman Two" }, decidedBy: "Amal One", note: "Wait for the audit" } })
        expect(done.kinds).toContain("role")
    })

    it("on To review are the company's somebody else asked for, with the role each holds now", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        const feed = await requestFeed(amal, query())
        expect(feed.rows.map(r => r.id)).toEqual(["r-wait"])
        expect(feed.rows[0]).toMatchObject({
            who: { name: "Hoda Samir" }, detail: "Joins the accounts team", mayDecide: true,
            role: { to: { name: "Accountant", builtIn: null }, now: { builtIn: "EMPLOYEE" }, person: { id: "e1", name: "Ehab One" } },
        })
        expect((await requestFeed(amal, query({ show: "done" }))).rows.map(r => r.id)).toEqual(["r-yes", "r-back", "r-no"])
        expect((await requestFeed(amal, query({ show: "done", search: "audit" }))).rows.map(r => r.id)).toEqual(["r-no"])
        // By who asked, as the person filter is for every kind.
        expect((await requestFeed(amal, query({ show: "done", personId: "h1" }))).rows.map(r => r.id)).toEqual(["r-yes", "r-back", "r-no"])
        expect((await requestFeed(amal, query({ show: "done", personId: "e2" }))).rows).toEqual([])
    })

    it("aren't anywhere for whoever neither asks for nor gives roles", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        expect((await requestFeed(ehab, query({ tab: "mine" }))).kinds).not.toContain("role")
        expect((await requestFeed(ehab, query())).kinds).not.toContain("role")
    })

    it("once decided is first on Done; whoever asked is told with it on the Requests page, and the person with their profile", { timeout: 60_000 }, async () => {
        const { RoleRequestService } = await import("@/lib/services/role-request.service")
        const { requestFeed } = await import("@/lib/requests/feed")
        vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T10:00:00Z") })
        await RoleRequestService.decide("r-wait", { approve: true, note: null }, { user: amal })
        vi.useRealTimers()
        expect((await requestFeed(hoda, query({ tab: "mine", show: "done" }))).rows.map(r => r.id)).toEqual(["r-wait", "r-yes", "r-back", "r-no"])
        const { rows } = await db.query(`SELECT "userId", type, "relatedId" FROM "Notification" ORDER BY "userId"`)
        expect(rows).toEqual([
            // On the one Requests page (§2.3, part 5b), which opens it on Mine for whoever asked.
            { userId: "e1", type: "ROLE_CHANGE_APPROVED", relatedId: "/dashboard/employees/e1" },
            { userId: "h1", type: "ROLE_CHANGE_APPROVED", relatedId: "/dashboard/requests?kind=role&highlight=r-wait" },
        ])
    })

    it("asked for, tells whoever gives roles with it on the Requests page", { timeout: 60_000 }, async () => {
        const { RoleRequestService } = await import("@/lib/services/role-request.service")
        await db.query(`DELETE FROM "Notification"`)
        const asked = await RoleRequestService.create({ userId: "e1", roleId: "clerk" }, { user: hoda })
        const { rows } = await db.query(`SELECT "userId", "relatedId" FROM "Notification"`)
        expect(rows).toEqual([{ userId: "a1", relatedId: `/dashboard/requests?kind=role&highlight=${asked.id}` }])
    })
})
