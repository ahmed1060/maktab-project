import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Missing punches on the one Requests page (UI_PLAN.md §2.3, part 3b),
 * against a real Postgres: when each report was last changed, which Done is
 * in order of, kept from now on and worked out for those already there; and
 * the page's feed reading them, mine and others'.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const UPDATED = "20261126000000_missing_punch_updated"

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('l1', 'l1@x', 'p', 'Laila', 'Lead', 'TEAM_LEADER', 2026, 'l1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 'l1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`

/**
 * Ehab's reports before the migration: one waiting, one approved, one
 * rejected, one withdrawn, and one withdrawn with nothing kept of when.
 * Only a decision kept when it was made; a withdrawal is in the audit log.
 */
const ASKED = `
INSERT INTO "MissingPunchRequest"(id, "companyId", "userId", date, "claimedAt", direction, reason, status, "createdAt", "reviewedById", "reviewedAt", "punchId") VALUES
 ('m-wait', 'c1', 'e1', '2026-10-05', '2026-10-05 17:00:00', 'OUT', 'Terminal down', 'PENDING', '2026-10-06T08:00:00Z', NULL, NULL, NULL),
 ('m-yes', 'c1', 'e1', '2026-10-06', '2026-10-06 09:00:00', 'IN', 'Forgot', 'APPROVED', '2026-10-06T09:30:00Z', 'a1', '2026-10-07T10:00:00Z', 'punch-1'),
 ('m-no', 'c1', 'e1', '2026-10-07', '2026-10-07 17:00:00', NULL, 'Forgot', 'REJECTED', '2026-10-07T18:00:00Z', 'a1', '2026-10-08T10:00:00Z', NULL),
 ('m-off', 'c1', 'e1', '2026-10-08', '2026-10-08 09:00:00', 'IN', 'Forgot', 'CANCELLED', '2026-10-08T09:30:00Z', NULL, NULL, NULL),
 ('m-lost', 'c1', 'e1', '2026-10-09', '2026-10-09 09:00:00', 'IN', 'Forgot', 'CANCELLED', '2026-10-09T09:30:00Z', NULL, NULL, NULL);
INSERT INTO "AuditLog"(id, action, "entityType", "entityId", "userId", "createdAt") VALUES
 ('l-off', 'CANCEL_MISSING_PUNCH', 'MISSING_PUNCH_REQUEST', 'm-off', 'e1', '2026-10-09T08:00:00Z'),
 ('l-other', 'REPORT_MISSING_PUNCH', 'MISSING_PUNCH_REQUEST', 'm-wait', 'e1', '2026-10-06T08:00:00Z');
`

describe.skipIf(!ADMIN_URL)("missing punches on the Requests page, in Postgres", () => {
    const dbName = `requests_missing_test_${Date.now()}`
    let db: Client
    const updated = async (id: string) => (await db.query(`SELECT "updatedAt" FROM "MissingPunchRequest" WHERE id = $1`, [id])).rows[0]?.updatedAt?.toISOString()

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
        it("is when it was reported, while it waits", async () => {
            expect(await updated("m-wait")).toBe("2026-10-06T08:00:00.000Z")
        })

        it("is when it was decided, once approved or rejected", async () => {
            expect(await updated("m-yes")).toBe("2026-10-07T10:00:00.000Z")
            expect(await updated("m-no")).toBe("2026-10-08T10:00:00.000Z")
        })

        it("is when it was withdrawn, as the audit log has it, or when it was reported with nothing kept of when", async () => {
            expect(await updated("m-off")).toBe("2026-10-09T08:00:00.000Z")
            expect(await updated("m-lost")).toBe("2026-10-09T09:30:00.000Z")
        })

        it("is now, for one reported by the release before, which doesn't name it", async () => {
            await db.query(`INSERT INTO "MissingPunchRequest"(id, "companyId", "userId", date, "claimedAt", direction, reason) VALUES ('m-old', 'c1', 'e2', '2026-10-10', '2026-10-10 17:00:00', 'OUT', 'Forgot')`)
            const { rows: [r] } = await db.query(`SELECT "updatedAt", "createdAt" FROM "MissingPunchRequest" WHERE id = 'm-old'`)
            expect(r.updatedAt.getTime()).toBe(r.createdAt.getTime())
        })
    })

    describe("from now on", () => {
        it("moves when it's withdrawn or decided, and Done is in that order", { timeout: 60_000 }, async () => {
            const { AttendanceRequestService: Requests } = await import("@/lib/services/attendance-request.service")
            const { requestFeed } = await import("@/lib/requests/feed")
            vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-11T08:00:00Z") })
            await Requests.cancelMissingPunch("m-wait", "e1")
            vi.setSystemTime(new Date("2026-10-11T09:00:00Z"))
            await Requests.decideMissingPunch("m-old", { approve: false, reason: "No sign of it" }, "a1")
            vi.useRealTimers()
            expect(await updated("m-wait")).toBe("2026-10-11T08:00:00.000Z")
            expect(await updated("m-old")).toBe("2026-10-11T09:00:00.000Z")

            const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
            const done = { tab: "mine" as const, show: "done" as const, kind: "missingPunch" as const, search: "", personId: "", companyId: null, page: 1, limit: 10 }
            const mine = await requestFeed(ehab, done)
            expect(mine.rows.map(r => r.id)).toEqual(["m-wait", "m-lost", "m-off", "m-no", "m-yes"])
            expect(mine.rows[0]).toMatchObject({ kind: "missingPunch", status: "CANCELLED", sortAt: "2026-10-11T08:00:00.000Z", who: { name: "Ehab One" } })
        })
    })

    describe("on To review", () => {
        const review = { tab: "review" as const, show: "done" as const, kind: "missingPunch" as const, search: "", personId: "", companyId: null, page: 1, limit: 10 }

        it("are everyone else's for an Admin, and only their team's for a role that corrects its team's", { timeout: 60_000 }, async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
            expect((await requestFeed(amal, review)).rows.map(r => r.id)).toEqual(["m-old", "m-wait", "m-lost", "m-off", "m-no", "m-yes"])
            // A company's own role on the Team Leader base, correcting its team's attendance.
            const laila = { id: "l1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,50.2" }
            // Eman isn't on Laila's team.
            expect((await requestFeed(laila, review)).rows.map(r => r.who.id)).not.toContain("e2")
            expect((await requestFeed(laila, review)).total).toBe(5)
        })

        it("narrow to words in the reason", async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
            expect((await requestFeed(amal, { ...review, search: "terminal" })).rows.map(r => r.id)).toEqual(["m-wait"])
        })
    })
})
