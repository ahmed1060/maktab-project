import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The count on Requests in the side bar (DESIGN.md §5.1), against a real
 * Postgres: how many wait on this person under the Requests page's To review
 * tab, the same number the page's own list totals there, by every kind's own
 * rule of who sees what.
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

/**
 * In c1: two of Ehab's and Eman's waiting (one started), one done, and
 * Amal's own; one in c2. And name changes: Ehab's waiting, Eman's decided.
 */
const WAITING = `
INSERT INTO "Request"(id, title, details, status, "userId", "companyId", "createdAt", "updatedAt") VALUES
 ('r-wait', 'Laptop', 'x', 'PENDING', 'e1', 'c1', '2026-10-28T08:00:00Z', '2026-10-28T08:00:00Z'),
 ('r-started', 'Chair', 'x', 'IN_PROGRESS', 'e2', 'c1', '2026-10-27T08:00:00Z', '2026-10-27T09:00:00Z'),
 ('r-done', 'Desk', 'x', 'COMPLETED', 'e1', 'c1', '2026-10-20T08:00:00Z', '2026-10-21T09:00:00Z'),
 ('r-amal', 'Phone', 'x', 'PENDING', 'a1', 'c1', '2026-10-29T08:00:00Z', '2026-10-29T08:00:00Z'),
 ('r-other', 'Car', 'x', 'PENDING', 'o1', 'c2', '2026-10-29T09:00:00Z', '2026-10-29T09:00:00Z');
INSERT INTO "ProfileUpdateRequest"(id, "userId", "oldFirstName", "oldLastName", "newFirstName", "newLastName", status, "adminNote", "createdAt", "updatedAt") VALUES
 ('n-wait', 'e1', 'Ehab', 'One', 'Ehab', 'Wahid', 'PENDING', NULL, '2026-10-28T08:00:00Z', '2026-10-28T08:00:00Z'),
 ('n-yes', 'e2', 'Eman', 'Tw', 'Eman', 'Two', 'APPROVED', NULL, '2026-10-22T08:00:00Z', '2026-10-23T09:00:00Z');
`

describe.skipIf(!ADMIN_URL)("the count on Requests, in Postgres", () => {
    const dbName = `requests_waiting_test_${Date.now()}`
    let db: Client
    const toReview = { tab: "review" as const, show: "waiting" as const, kind: "" as const, search: "", personId: "", companyId: null, page: 1, limit: 10 }
    const amal = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
    const ehab = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
    const sa = { id: "s1", role: "SUPER_ADMIN", companyId: null }

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
        await db.query(WAITING)
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

    it("is what waits on an Admin from the others in their company: requests waiting or started, and name changes", { timeout: 60_000 }, async () => {
        const { waitingForReview, requestFeed } = await import("@/lib/requests/feed")
        expect(await waitingForReview(amal)).toBe(3)
        // The page's own total, there.
        expect((await requestFeed(amal, toReview)).total).toBe(3)
    })

    it("is nothing for someone with no To review tab", { timeout: 60_000 }, async () => {
        const { waitingForReview, requestFeed } = await import("@/lib/requests/feed")
        expect(await waitingForReview(ehab)).toBe(0)
        expect((await requestFeed(ehab, toReview)).total).toBe(0)
    })

    it("is every company's for the Super Admin, as the page with no company picked", { timeout: 60_000 }, async () => {
        const { waitingForReview, requestFeed } = await import("@/lib/requests/feed")
        const total = (await requestFeed(sa as never, toReview)).total
        expect(await waitingForReview(sa as never)).toBe(total)
        expect(total).toBeGreaterThan(3)
    })

    it("is the company the Super Admin is looking at, as the page opens on it", { timeout: 60_000 }, async () => {
        const { waitingForReview, requestFeed } = await import("@/lib/requests/feed")
        const one = await waitingForReview(sa as never, "c1")
        const two = await waitingForReview(sa as never, "c2")
        expect(one).toBe((await requestFeed(sa as never, { ...toReview, companyId: "c1" })).total)
        expect(two).toBe((await requestFeed(sa as never, { ...toReview, companyId: "c2" })).total)
        // Ehab's, Eman's and Amal's, and Ehab's name change; Omar's alone.
        expect([one, two]).toEqual([4, 1])
        expect(one + two).toBe(await waitingForReview(sa as never))
    })

    it("is no other company's for an Admin, whichever one is asked for", { timeout: 60_000 }, async () => {
        const { waitingForReview } = await import("@/lib/requests/feed")
        expect(await waitingForReview(amal, "c2")).toBe(3)
    })

    it("drops as soon as one is decided", { timeout: 60_000 }, async () => {
        const { waitingForReview } = await import("@/lib/requests/feed")
        await db.query(`UPDATE "Request" SET status = 'COMPLETED' WHERE id = 'r-wait'`)
        expect(await waitingForReview(amal)).toBe(2)
    })
})
