import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Check-in phones on the one Requests page (UI_PLAN.md §2.3, part 4b),
 * against a real Postgres: the feed reads the new phones waiting for
 * approval, with the check-ins each holds, and those decided since, under To
 * review only.
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
 * Ehab's phones: the one he used, replaced by the one in use now, and a new
 * one waiting with two check-ins held. Eman's: one waiting, one rejected,
 * one she withdrew, and one revoked when it was lost. Laila leads Ehab's
 * team, not Eman's; Amal's own is in use.
 */
const PHONES = `
INSERT INTO "CheckInPhone"(id, "companyId", "userId", "publicKey", "keyFingerprint", platform, model, "appVersion", attested, status, "requestedAt", "decidedAt", "decidedById", reason) VALUES
 ('p-old', 'c1', 'e1', 'k', 'f1', 'ANDROID', 'Galaxy A52', '1.2.0', true, 'REVOKED', '2026-10-01T08:00:00Z', '2026-10-20T09:00:00Z', 'a1', 'REPLACED'),
 ('p-use', 'c1', 'e1', 'k', 'f2', 'ANDROID', 'Pixel 8', '1.3.0', true, 'ACTIVE', '2026-10-19T08:00:00Z', '2026-10-20T09:00:00Z', 'a1', NULL),
 ('p-new', 'c1', 'e1', 'k', 'f3', 'IOS', 'iPhone 15', '1.4.0', false, 'PENDING', '2026-10-29T08:00:00Z', NULL, NULL, NULL),
 ('p-eman', 'c1', 'e2', 'k', 'f4', 'IOS', NULL, '1.4.0', true, 'PENDING', '2026-10-30T08:00:00Z', NULL, NULL, NULL),
 ('p-no', 'c1', 'e2', 'k', 'f5', 'ANDROID', 'Moto G', '1.4.0', true, 'REJECTED', '2026-10-21T08:00:00Z', '2026-10-22T09:00:00Z', 'a1', 'Not a work phone'),
 ('p-back', 'c1', 'e2', 'k', 'f6', 'ANDROID', 'Moto G', '1.4.0', true, 'WITHDRAWN', '2026-10-23T08:00:00Z', '2026-10-24T09:00:00Z', NULL, NULL),
 ('p-lost', 'c1', 'e2', 'k', 'f7', 'ANDROID', 'Nokia G21', '1.4.0', true, 'REVOKED', '2026-09-01T08:00:00Z', '2026-10-25T09:00:00Z', 'a1', 'Lost on the bus'),
 ('p-amal', 'c1', 'a1', 'k', 'f8', 'ANDROID', 'Pixel 7', '1.4.0', true, 'ACTIVE', '2026-10-01T08:00:00Z', '2026-10-02T09:00:00Z', 'l1', NULL);
INSERT INTO "AttendancePunch"(id, "companyId", "userId", source, "sourceKey", "punchAtLocal", "punchAt", "resolvedWithTimeZone", status, "phoneId") VALUES
 ('h1', 'c1', 'e1', 'MOBILE', 'h1', '2026-10-29 09:00:00', '2026-10-29T07:00:00Z', 'Africa/Cairo', 'PENDING_DEVICE', 'p-new'),
 ('h2', 'c1', 'e1', 'MOBILE', 'h2', '2026-10-29 17:00:00', '2026-10-29T15:00:00Z', 'Africa/Cairo', 'PENDING_DEVICE', 'p-new'),
 ('h3', 'c1', 'e1', 'MOBILE', 'h3', '2026-10-28 09:00:00', '2026-10-28T07:00:00Z', 'Africa/Cairo', 'ACCEPTED', 'p-use');
`

describe.skipIf(!ADMIN_URL)("check-in phones on the Requests page, in Postgres", () => {
    const dbName = `requests_phone_test_${Date.now()}`
    let db: Client
    const query = (fields: object = {}) => ({ tab: "review" as const, show: "waiting" as const, kind: "phone" as const, search: "", personId: "", companyId: null, page: 1, limit: 10, ...fields })
    const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
    // A company's own role on the Team Leader base, deciding its team's phones.
    const laila = { id: "l1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,53.2" }

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
        await db.query(PHONES)
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

    it("waiting is everyone else's new phones, the latest asked for first, with the check-ins each holds", { timeout: 60_000 }, async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        const feed = await requestFeed(amal, query())
        expect(feed.rows.map(r => r.id)).toEqual(["p-eman", "p-new"])
        expect(feed.rows[1]).toMatchObject({
            who: { name: "Ehab One" }, what: "iPhone 15", mayDecide: true,
            phone: { platform: "IOS", model: "iPhone 15", appVersion: "1.4.0", attested: false, held: 2 },
        })
        expect(feed.rows[0]).toMatchObject({ what: "", phone: { model: null, held: 0 } })
        expect(feed.kinds).toContain("phone")
    })

    it("done is those decided since, the latest first, and not one's own", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        const feed = await requestFeed(amal, query({ show: "done" }))
        // Ehab's old phone and the one that replaced it were decided together: then by id.
        expect(feed.rows.map(r => r.id)).toEqual(["p-lost", "p-back", "p-no", "p-old", "p-use"])
        expect(feed.rows.find(r => r.id === "p-use")).toMatchObject({ status: "ACTIVE", mayRevoke: true })
        expect(feed.rows.find(r => r.id === "p-old")).toMatchObject({ status: "REVOKED", mayRevoke: false, phone: { replaced: true, reason: null } })
        expect(feed.rows.find(r => r.id === "p-lost")).toMatchObject({ phone: { replaced: false, reason: "Lost on the bus" } })
    })

    it("are searched by why one was rejected or revoked", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        expect((await requestFeed(amal, query({ show: "done", search: "bus" }))).rows.map(r => r.id)).toEqual(["p-lost"])
        // The word a replaced one keeps isn't one anybody wrote.
        expect((await requestFeed(amal, query({ show: "done", search: "replaced" }))).rows).toEqual([])
    })

    it("are their team's for a role that decides its team's, and nobody's on Mine", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        expect((await requestFeed(laila, query())).rows.map(r => r.id)).toEqual(["p-new"])
        expect((await requestFeed(laila, query({ show: "done" }))).rows.map(r => r.id)).toEqual(["p-old", "p-use"])
        const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
        expect((await requestFeed(ehab, query({ tab: "mine" }))).kinds).not.toContain("phone")
    })
})
