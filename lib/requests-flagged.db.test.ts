import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Flagged check-ins on the one Requests page (UI_PLAN.md §2.3, part 4c),
 * against a real Postgres: when each was decided and why it was rejected,
 * which Done is in order of and says, kept from now on and found in the
 * audit log for those decided already; and the feed reading them, under To
 * review only.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const REVIEWED = "20261127000000_punch_reviewed"

const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('l1', 'l1@x', 'p', 'Laila', 'Lead', 'TEAM_LEADER', 2026, 'l1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', 'l1'),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL);
`

const punch = (id: string, user: string, local: string, status: string, reasons: string, voided = "NULL, NULL, NULL") =>
    `('${id}', 'c1', '${user}', 'MOBILE', '${id}', '${local}', '${local}Z', 'UTC', '${status}', ARRAY[${reasons}]::text[], '{"latitude":30.0444,"longitude":31.2357,"accuracyMeters":40,"distanceMeters":240,"ip":"41.33.1.2"}', '${local}Z', ${voided})`

/**
 * Before the migration: Ehab's check-ins, one still flagged, one accepted and
 * one rejected with a reason, as the audit log has them; one the Super Admin
 * looks at; one withdrawn; and one in a month whose payroll is approved.
 * Eman's, still flagged. Laila leads Ehab's team, not Eman's.
 */
const BEFORE = `
INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status, "flagReasons", "checkIn", "receivedAt", "voidedAt", "voidedById", "voidReason") VALUES
 ${punch("k-wait", "e1", "2026-10-28T09:02:00", "FLAGGED", "'OUTSIDE_AREA'")},
 ${punch("k-yes", "e1", "2026-10-26T09:05:00", "ACCEPTED", "'IMPRECISE_LOCATION'")},
 ${punch("k-no", "e1", "2026-10-25T09:10:00", "REJECTED", "'OUTSIDE_AREA'")},
 ${punch("k-app", "e1", "2026-10-27T09:00:00", "FLAGGED", "'ATTESTATION_UNVERIFIED', 'OUTSIDE_AREA'")},
 ${punch("k-eman", "e2", "2026-10-29T08:55:00", "FLAGGED", "'OFFICE_IP_MISMATCH'")},
 ${punch("k-sept", "e1", "2026-09-15T09:00:00", "FLAGGED", "'OUTSIDE_AREA'")},
 ${punch("k-gone", "e1", "2026-10-24T09:00:00", "FLAGGED", "'OUTSIDE_AREA'", "'2026-10-24T12:00:00Z', 'a1', 'Duplicate'")};
INSERT INTO "AuditLog"(id, action, "entityType", "entityId", "userId", details, "createdAt") VALUES
 ('l-yes', 'ACCEPT_FLAGGED_CHECK_IN', 'ATTENDANCE_PUNCH', 'k-yes', 'a1', '{"reason": null}', '2026-10-27T08:00:00Z'),
 ('l-no', 'REJECT_FLAGGED_CHECK_IN', 'ATTENDANCE_PUNCH', 'k-no', 'a1', '{"reason": "Worked from home"}', '2026-10-28T08:00:00Z'),
 ('l-other', 'VOID_PUNCH', 'ATTENDANCE_PUNCH', 'k-wait', 'a1', '{"reason": "Not this one"}', '2026-10-28T10:00:00Z');
INSERT INTO "PayrollRun"(id, "companyId", month, year, status, "payrollDay", "updatedAt") VALUES ('r-sept', 'c1', 9, 2026, 'APPROVED', 25, now());
`

describe.skipIf(!ADMIN_URL)("flagged check-ins on the Requests page, in Postgres", () => {
    const dbName = `requests_flagged_test_${Date.now()}`
    let db: Client
    const reviewed = async (id: string) => (await db.query(`SELECT "reviewedAt", "reviewReason" FROM "AttendancePunch" WHERE id = $1`, [id])).rows[0]
    const query = (fields: object = {}) => ({ tab: "review" as const, show: "waiting" as const, kind: "flagged" as const, search: "", personId: "", companyId: null, page: 1, limit: 10, ...fields })
    const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
    // A company's own role on the Team Leader base, correcting its team's attendance.
    const laila = { id: "l1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,50.2" }

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
            if (m === REVIEWED) await db.query(BEFORE)
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

    describe("when each was decided and why, for those already there", () => {
        it("is when the audit log has it decided, with the reason it was rejected for", async () => {
            expect(await reviewed("k-yes")).toEqual({ reviewedAt: new Date("2026-10-27T08:00:00Z"), reviewReason: null })
            expect(await reviewed("k-no")).toEqual({ reviewedAt: new Date("2026-10-28T08:00:00Z"), reviewReason: "Worked from home" })
        })

        it("is nothing for one still flagged, whatever else the audit log has of it", async () => {
            expect(await reviewed("k-wait")).toEqual({ reviewedAt: null, reviewReason: null })
        })
    })

    describe("from now on", () => {
        it("is kept when it's decided", { timeout: 60_000 }, async () => {
            const { AttendanceFlagService } = await import("@/lib/services/attendance-flag.service")
            vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T09:00:00Z") })
            await AttendanceFlagService.decide("k-eman", { accept: false, reason: "  Not on the office network  " }, "a1")
            vi.useRealTimers()
            expect(await reviewed("k-eman")).toEqual({ reviewedAt: new Date("2026-10-30T09:00:00Z"), reviewReason: "Not on the office network" })
        })
    })

    describe("on To review", () => {
        it("waiting is everyone else's still flagged, but the Super Admin's, those withdrawn and those in a month whose payroll is approved", async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const feed = await requestFeed(amal, query())
            expect(feed.rows.map(r => r.id)).toEqual(["k-wait"])
            expect(feed.total).toBe(1)
            expect(feed.rows[0]).toMatchObject({
                who: { name: "Ehab One" }, mayDecide: true,
                flagged: { at: "2026-10-28T09:02", reasons: ["OUTSIDE_AREA"], distance: 240, accuracy: 40, latitude: 30.0444, longitude: 31.2357 },
            })
            expect(feed.kinds).toContain("flagged")
        })

        it("done is those decided, the latest first, with why one was rejected", async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            const feed = await requestFeed(amal, query({ show: "done" }))
            expect(feed.rows.map(r => r.id)).toEqual(["k-eman", "k-no", "k-yes"])
            expect(feed.rows[1]).toMatchObject({ status: "REJECTED", flagged: { reason: "Worked from home" } })
            expect((await requestFeed(amal, query({ show: "done", search: "home" }))).rows.map(r => r.id)).toEqual(["k-no"])
        })

        it("are their team's for a role that corrects its team's, and nobody's on Mine", async () => {
            const { requestFeed } = await import("@/lib/requests/feed")
            expect((await requestFeed(laila, query({ show: "done" }))).rows.map(r => r.id)).toEqual(["k-no", "k-yes"])
            const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
            expect((await requestFeed(ehab, query({ tab: "mine" }))).kinds).not.toContain("flagged")
        })
    })
})
