import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Permission hours on the one Requests page (UI_PLAN.md §2.3, part 3a),
 * against a real Postgres: when each was last changed, which Done is in
 * order of, kept from now on and worked out for those already there; and
 * the page's feed reading them, mine and others'.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const UPDATED = "20261125000000_permission_request_updated"

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('l1', 'l1@x', 'p', 'Laila', 'Lead', 'TEAM_LEADER', 2026, 'l1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 'l1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`

/**
 * Ehab's permission hours before the migration: one waiting, one approved,
 * one rejected, one withdrawn while it waited, and one approved then
 * withdrawn before it began. Only a decision kept when it was made; a
 * withdrawal is in the audit log.
 */
const ASKED = `
INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason, status, "createdAt", "reviewedById", "reviewedAt") VALUES
 ('p-wait', 'c1', 'e1', '2026-10-05', 'MIDDAY', 720, 780, 60, 'Bank', 'PENDING', '2026-10-01T08:00:00Z', NULL, NULL),
 ('p-yes', 'c1', 'e1', '2026-10-06', 'LATE_ARRIVAL', 540, 600, 60, 'Doctor', 'APPROVED', '2026-10-01T09:00:00Z', 'a1', '2026-10-02T10:00:00Z'),
 ('p-no', 'c1', 'e1', '2026-10-07', 'EARLY_LEAVE', 960, 1020, 60, 'School', 'REJECTED', '2026-10-01T10:00:00Z', 'a1', '2026-10-03T10:00:00Z'),
 ('p-off', 'c1', 'e1', '2026-10-08', 'MIDDAY', 720, 750, 30, 'Post', 'CANCELLED', '2026-10-01T11:00:00Z', NULL, NULL),
 ('p-back', 'c1', 'e1', '2026-10-09', 'MIDDAY', 720, 750, 30, 'Post', 'CANCELLED', '2026-10-01T12:00:00Z', 'a1', '2026-10-02T12:00:00Z'),
 ('p-lost', 'c1', 'e1', '2026-10-10', 'MIDDAY', 720, 750, 30, 'Post', 'CANCELLED', '2026-10-01T13:00:00Z', NULL, NULL);
INSERT INTO "AuditLog"(id, action, "entityType", "entityId", "userId", "createdAt") VALUES
 ('l-off', 'CANCEL_ATTENDANCE_PERMISSION', 'PERMISSION_REQUEST', 'p-off', 'e1', '2026-10-04T08:00:00Z'),
 ('l-back', 'CANCEL_ATTENDANCE_PERMISSION', 'PERMISSION_REQUEST', 'p-back', 'e1', '2026-10-04T09:00:00Z'),
 ('l-other', 'REQUEST_ATTENDANCE_PERMISSION', 'PERMISSION_REQUEST', 'p-wait', 'e1', '2026-10-01T08:00:00Z');
`

describe.skipIf(!ADMIN_URL)("permission hours on the Requests page, in Postgres", () => {
    const dbName = `requests_permission_test_${Date.now()}`
    let db: Client
    const updated = async (id: string) => (await db.query(`SELECT "updatedAt" FROM "PermissionRequest" WHERE id = $1`, [id])).rows[0]?.updatedAt?.toISOString()

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
            if (m === UPDATED) await db.query(ASKED)
            await db.query(sql(m))
            if (m === "20260920000000_team_leader") await db.query(PEOPLE)
        }
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

    describe("when each was last changed, for those already there", () => {
        it("is when it was asked, while it waits", async () => {
            expect(await updated("p-wait")).toBe("2026-10-01T08:00:00.000Z")
        })

        it("is when it was decided, once approved or rejected", async () => {
            expect(await updated("p-yes")).toBe("2026-10-02T10:00:00.000Z")
            expect(await updated("p-no")).toBe("2026-10-03T10:00:00.000Z")
        })

        it("is when it was withdrawn, as the audit log has it, even after it was approved", async () => {
            expect(await updated("p-off")).toBe("2026-10-04T08:00:00.000Z")
            expect(await updated("p-back")).toBe("2026-10-04T09:00:00.000Z")
        })

        it("is when it was asked, for one withdrawn with nothing kept of when", async () => {
            expect(await updated("p-lost")).toBe("2026-10-01T13:00:00.000Z")
        })

        it("is now, for one asked by the release before, which doesn't name it", async () => {
            await db.query(`INSERT INTO "PermissionRequest"(id, "companyId", "userId", date, type, "startMinutes", "endMinutes", minutes, reason) VALUES ('p-old', 'c1', 'e2', '2026-10-12', 'MIDDAY', 720, 780, 60, 'Bank')`)
            const { rows: [r] } = await db.query(`SELECT "updatedAt", "createdAt" FROM "PermissionRequest" WHERE id = 'p-old'`)
            expect(r.updatedAt.getTime()).toBe(r.createdAt.getTime())
        })
    })

    describe("from now on", () => {
        it("moves when it's withdrawn or decided, and Done is in that order", { timeout: 60_000 }, async () => {
            const { AttendanceRequestService: Requests } = await import("@/lib/services/attendance-request.service")
            const { requestFeed } = await import("@/lib/requests/feed")
            vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-11T08:00:00Z") })
            await Requests.cancelPermission("p-wait", "e1")
            vi.setSystemTime(new Date("2026-10-11T09:00:00Z"))
            await Requests.decidePermission("p-old", { approve: false, reason: "Busy day" }, "a1")
            vi.useRealTimers()
            expect(await updated("p-wait")).toBe("2026-10-11T08:00:00.000Z")
            expect(await updated("p-old")).toBe("2026-10-11T09:00:00.000Z")

            const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
            const done = { tab: "mine" as const, show: "done" as const, kind: "permission" as const, search: "", personId: "", companyId: null, page: 1, limit: 10 }
            const mine = await requestFeed(ehab, done)
            expect(mine.rows.map(r => r.id)).toEqual(["p-wait", "p-back", "p-off", "p-no", "p-yes", "p-lost"])
            expect(mine.rows[0]).toMatchObject({ kind: "permission", status: "CANCELLED", sortAt: "2026-10-11T08:00:00.000Z", who: { name: "Ehab One" } })
        })
    })

    describe("on To review", () => {
        const review = { tab: "review" as const, show: "done" as const, kind: "permission" as const, search: "", personId: "", companyId: null, page: 1, limit: 10 }

        it("are everyone else's for an Admin, and only their team's for a role that decides its team's", { timeout: 60_000 }, async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
            expect((await requestFeed(amal, review)).rows.map(r => r.id)).toEqual(["p-old", "p-wait", "p-back", "p-off", "p-no", "p-yes", "p-lost"])
            // A company's own role on the Team Leader base, deciding its team's permission hours.
            const laila = { id: "l1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,52.2" }
            // Eman isn't on Laila's team.
            expect((await requestFeed(laila, review)).rows.map(r => r.who.id)).not.toContain("e2")
            expect((await requestFeed(laila, review)).total).toBe(6)
        })

        it("narrow to words in the reason", async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
            expect((await requestFeed(amal, { ...review, search: "doc" })).rows.map(r => r.id)).toEqual(["p-yes"])
        })
    })
})
