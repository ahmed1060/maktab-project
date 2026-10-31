import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Name changes on the one Requests page (UI_PLAN.md §2.3, part 5a), against a
 * real Postgres: one's own on Mine, everyone else's in the company under To
 * review for whoever decides them, Done in order of when each was decided,
 * and a decision's notice opening the request there.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
const PEOPLE = `
INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now());
INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId", "teamLeaderId") VALUES
 ('a1', 'a1@x', 'p', 'Amal', 'One', 'ADMIN', 2026, 'a1', 'c1', NULL),
 ('e1', 'e1@x', 'p', 'Ehab', 'One', 'EMPLOYEE', 2026, 'e1', 'c1', NULL),
 ('e2', 'e2@x', 'p', 'Eman', 'Two', 'EMPLOYEE', 2026, 'e2', 'c1', NULL),
 ('o1', 'o1@x', 'p', 'Omar', 'Other', 'EMPLOYEE', 2026, 'o1', 'c2', NULL);
`

/** Ehab's: one waiting and one rejected; Eman's, approved; Amal's own, waiting; and one in another company. */
const CHANGES = `
INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", status, "adminNote", "createdAt", "updatedAt") VALUES
 ('n-wait', 'e1', 'Ehab', 'One', 'Ehab', 'Wahid', 'PENDING', NULL, '2026-10-28T08:00:00Z', '2026-10-28T08:00:00Z'),
 ('n-no', 'e1', 'Ehab', 'One', 'Ihab', 'One', 'REJECTED', 'Use the name on your ID', '2026-10-20T08:00:00Z', '2026-10-21T09:00:00Z'),
 ('n-yes', 'e2', 'Eman', 'Tw', 'Eman', 'Two', 'APPROVED', NULL, '2026-10-22T08:00:00Z', '2026-10-23T09:00:00Z'),
 ('n-amal', 'a1', 'Amal', 'One', 'Amal', 'Wahda', 'PENDING', NULL, '2026-10-29T08:00:00Z', '2026-10-29T08:00:00Z'),
 ('n-other', 'o1', 'Omar', 'Other', 'Omar', 'Akhar', 'PENDING', NULL, '2026-10-29T09:00:00Z', '2026-10-29T09:00:00Z');
`

describe.skipIf(!ADMIN_URL)("name changes on the Requests page, in Postgres", () => {
    const dbName = `requests_name_change_test_${Date.now()}`
    let db: Client
    const query = (fields: object = {}) => ({ tab: "review" as const, show: "waiting" as const, kind: "nameChange" as const, search: "", personId: "", companyId: null, page: 1, limit: 10, ...fields })
    const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
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
        await db.query(CHANGES)
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

    it("on Mine are one's own, waiting, then decided, the latest first", { timeout: 60_000 }, async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        expect((await requestFeed(ehab, query({ tab: "mine" }))).rows.map(r => r.id)).toEqual(["n-wait"])
        const done = await requestFeed(ehab, query({ tab: "mine", show: "done" }))
        expect(done.rows.map(r => r.id)).toEqual(["n-no"])
        expect(done.rows[0]).toMatchObject({ status: "REJECTED", what: "Ihab One", nameChange: { from: "Ehab One", to: "Ihab One", note: "Use the name on your ID" } })
        expect(done.kinds).toContain("nameChange")
    })

    it("on To review are everyone else's in the company, not one's own nor another company's", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        const feed = await requestFeed(amal, query())
        expect(feed.rows.map(r => r.id)).toEqual(["n-wait"])
        expect(feed.rows[0]).toMatchObject({ who: { name: "Ehab One" }, mayDecide: true })
        expect((await requestFeed(amal, query({ show: "done" }))).rows.map(r => r.id)).toEqual(["n-yes", "n-no"])
        expect((await requestFeed(ehab, query())).kinds).not.toContain("nameChange")
    })

    it("are searched by the new name, and once decided by the note", async () => {
        const { requestFeed } = await import("@/lib/requests/feed")
        expect((await requestFeed(amal, query({ search: "wahid" }))).rows.map(r => r.id)).toEqual(["n-wait"])
        expect((await requestFeed(amal, query({ show: "done", search: "your id" }))).rows.map(r => r.id)).toEqual(["n-no"])
    })

    it("once decided is first on Done, and its notice opens it on the Requests page", { timeout: 60_000 }, async () => {
        const { ProfileService } = await import("@/lib/services/profile.service")
        const { requestFeed } = await import("@/lib/requests/feed")
        vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-30T10:00:00Z") })
        await ProfileService.rejectRequest("n-wait", "Spell it as on your ID", { user: amal })
        vi.useRealTimers()
        expect((await requestFeed(amal, query({ show: "done" }))).rows.map(r => r.id)).toEqual(["n-wait", "n-yes", "n-no"])
        const { rows: [notice] } = await db.query(`SELECT type, "relatedId" FROM "Notification" WHERE "userId" = 'e1'`)
        // The request itself, which the bell opens on the Requests page (§2.3, part 5a).
        expect(notice).toEqual({ type: "PROFILE_UPDATE_REJECTED", relatedId: "n-wait" })
    })
})
