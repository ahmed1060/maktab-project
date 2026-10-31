import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Overtime on the one Requests page (UI_PLAN.md §2.3, part 4a), against a
 * real Postgres: the feed reads the days whose overtime waits for a
 * decision, and the decisions made, under To review only.
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
 ('l1', 'l1@x', 'p', 'Laila', 'Lead', 'TEAM_LEADER', 2026, 'l1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 'l1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`

/**
 * Ehab's days: one whose overtime waits, one with none, and one decided; and
 * Eman's, whose overtime waits too. Laila leads Ehab's team, not Eman's.
 */
const DAYS = `
INSERT INTO "AttendanceDay"(id, "companyId", "userId", date, status, breakdown, "inputsHash", "overtimeMinutes", "overtimeStatus", "firstInAt", "lastOutAt") VALUES
 ('d-wait', 'c1', 'e1', '2026-10-28', 'PRESENT', '{}', 'h', 90, 'PENDING', '2026-10-28 09:00:00', '2026-10-28 18:30:00'),
 ('d-none', 'c1', 'e1', '2026-10-27', 'PRESENT', '{}', 'h', 0, 'NONE', '2026-10-27 09:00:00', '2026-10-27 17:00:00'),
 ('d-eman', 'c1', 'e2', '2026-10-29', 'PRESENT', '{}', 'h', 45, 'PENDING', '2026-10-29 09:00:00', '2026-10-29 17:45:00');
INSERT INTO "OvertimeApproval"(id, "companyId", "userId", date, status, "approvedMinutes", note, "decidedById", "decidedAt") VALUES
 ('o-yes', 'c1', 'e1', '2026-10-26', 'APPROVED', 60, NULL, 'a1', '2026-10-27T08:00:00Z'),
 ('o-no', 'c1', 'e2', '2026-10-25', 'REJECTED', 0, 'Not asked for', 'a1', '2026-10-28T08:00:00Z');
`

describe.skipIf(!ADMIN_URL)("overtime on the Requests page, in Postgres", () => {
    const dbName = `requests_overtime_test_${Date.now()}`
    let db: Client
    const query = (fields: object = {}) => ({ tab: "review" as const, show: "waiting" as const, kind: "overtime" as const, search: "", personId: "", companyId: null, page: 1, limit: 10, ...fields })
    const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
    // A company's own role on the Team Leader base, deciding its team's overtime.
    const laila = { id: "l1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,51.2" }

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
        await db.query(DAYS)
        process.env.POSTGRES_PRISMA_URL = url.toString()
    }, 180_000)

    afterAll(async () => {
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const admin = new Client({ connectionString: ADMIN_URL })
        await admin.connect()
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await admin.end()
    })

    it("waiting is everyone's days whose overtime waits, newest day first, with how much and when they came and left", { timeout: 60_000 }, async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        const feed = await requestFeed(amal, query())
        expect(feed.rows.map(r => r.id)).toEqual(["d-eman", "d-wait"])
        expect(feed.rows[1]).toMatchObject({ who: { name: "Ehab One" }, overtime: { date: "2026-10-28", minutes: 90, firstIn: "09:00", lastOut: "18:30" } })
        expect(feed.kinds).toContain("overtime")
    })

    it("done is the decisions made, the latest first", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        const feed = await requestFeed(amal, query({ show: "done" }))
        expect(feed.rows.map(r => r.id)).toEqual(["o-no", "o-yes"])
        expect(feed.rows[0]).toMatchObject({ status: "REJECTED", overtime: { note: "Not asked for", approvedMinutes: null } })
        expect(feed.rows[1]).toMatchObject({ status: "APPROVED", overtime: { approvedMinutes: 60 } })
        expect((await requestFeed(amal, query({ show: "done", search: "asked" }))).rows.map(r => r.id)).toEqual(["o-no"])
    })

    it("is their team's for a role that decides its team's, and nobody's on Mine", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        expect((await requestFeed(laila, query())).rows.map(r => r.id)).toEqual(["d-wait"])
        const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
        expect((await requestFeed(ehab, query({ tab: "mine" }))).kinds).not.toContain("overtime")
    })
})
