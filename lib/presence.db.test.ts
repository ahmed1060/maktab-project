import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { HEARTBEAT_MS, ONLINE_WINDOW_MS, presenceStatus } from "./presence"
import { buildUserWhereClause } from "./services/user-query"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Who shows as online, asked of a real Postgres through Prisma: the Employees
 * list's Online and Offline filters list who the badges say (PR 246), and
 * since part 6a (REALTIME_PLAN.md §3, PR 262) a person is online while any
 * tab of theirs has a fresh row, added as it's shown and taken away as it
 * goes (UserService.updateActivity).
 *
 * lib/presence.test.ts checks the clauses' shape; this checks Prisma takes
 * them. The first version of the Offline filter asked for someone never seen,
 * with `lastActivity: null`, and Prisma refused the whole query, as the column
 * is never empty: the filter answered with an error, and its unit tests passed.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const NOW = new Date()
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "DELETED", "OFFLINE", "ARCHIVED"]
const ROLES = ["ADMIN", "TEAM_LEADER", "EMPLOYEE"]
const TAB = (n: number) => `tab-${String(n).padStart(4, "0")}-aaaabbbbcccc`

/** Hana's company, c1, who's in it, and when each of their open tabs was last seen. */
const PEOPLE: { id: string; status: string; tabs: Date[]; company?: string }[] = [
    { id: "here", status: "ACTIVE", tabs: [ago(5 * 60_000)] },                       // between two beats
    { id: "two", status: "ACTIVE", tabs: [ago(40 * 60_000), ago(60_000)] },          // a phone gone stale, a laptop shown
    { id: "lost", status: "ACTIVE", tabs: [ago(2 * HEARTBEAT_MS - 1_000)] },        // one beat lost
    { id: "gone", status: "ACTIVE", tabs: [] },                                      // closed the app a moment ago
    { id: "stale", status: "ACTIVE", tabs: [ago(ONLINE_WINDOW_MS + 60_000)] },       // a phone that closed it unheard
    { id: "out", status: "OFFLINE", tabs: [] },                                      // signed out
    { id: "held", status: "SUSPENDED", tabs: [ago(10_000)] },
    { id: "away", status: "ACTIVE", tabs: [ago(10_000)], company: "c2" },            // another company
]

describe.skipIf(!ADMIN_URL)("who shows as online, in Postgres", () => {
    const dbName = `presence_test_${Date.now()}`
    let db: Client
    let prisma: PrismaClient
    let Users: typeof import("@/lib/services/user.service").UserService

    beforeAll(async () => {
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`CREATE DATABASE ${dbName}`)
        await a.end()
        const url = new URL(ADMIN_URL!)
        url.pathname = `/${dbName}`
        db = new Client({ connectionString: url.toString() })
        await db.connect()
        // People join before the roles migration, which gives each the role
        // their company's built-in one is; their status and tabs are set once
        // every migration has run.
        for (const m of MIGRATIONS) {
            await db.query(sql(m))
            if (m !== "20260920000000_team_leader") continue
            await db.query(`INSERT INTO "Company"(id, name, "updatedAt") VALUES ('c1', 'One', now()), ('c2', 'Two', now())`)
            for (const p of PEOPLE) {
                await db.query(
                    `INSERT INTO "User"(id, email, password, "firstName", "lastName", role, "lastDayOffResetYear", username, "companyId")
                     VALUES ($1, $1 || '@x', 'p', $1, 'Person', 'EMPLOYEE', 2026, $1, $2)`,
                    [p.id, p.company ?? "c1"],
                )
            }
        }
        let n = 0
        for (const p of PEOPLE) {
            // Each was seen a moment ago by the old heartbeat, which no longer decides.
            await db.query(`UPDATE "User" SET status = $2::"UserStatus", "lastActivity" = now() WHERE id = $1`, [p.id, p.status])
            for (const seen of p.tabs) await db.query(`INSERT INTO "OpenTab"("userId", "tabId", "seenAt") VALUES ($1, $2, $3)`, [p.id, TAB(++n), seen])
        }
        prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) })
        process.env.POSTGRES_PRISMA_URL = url.toString()
        Users = (await import("@/lib/services/user.service")).UserService
    }, 120_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await (await import("@/lib/prisma")).prisma.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`)
        await a.end()
    })

    const admin = { user: withGrants({ id: "hana", role: "ADMIN", companyId: "c1" }) }
    /** Who the list shows for a query string, with each one's newest tab, as the route asks. */
    const listed = async (qs: string) => {
        const built = buildUserWhereClause(admin as any, new URLSearchParams(qs), undefined, ROLES, STATUSES, NOW)
        if (built.empty) throw new Error("no clause")
        return prisma.user.findMany({
            where: built.whereClause,
            select: { id: true, status: true, openTabs: { where: { here: true }, orderBy: { seenAt: "desc" }, take: 1, select: { seenAt: true } } },
            orderBy: { id: "asc" },
        })
    }
    const badge = (r: { status: string; openTabs: { seenAt: Date }[] }) => presenceStatus(r.status, r.openTabs[0]?.seenAt ?? null, NOW)
    const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort()

    describe("the list", () => {
        it("Online lists who has a fresh tab: one beat lost, or one device of two, still counts", async () => {
            expect(ids(await listed("status=ACTIVE"))).toEqual(["here", "lost", "two"])
        })

        it("Offline lists who signed out, who closed the app, and whose last tab ran out", async () => {
            expect(ids(await listed("status=OFFLINE"))).toEqual(["gone", "out", "stale"])
        })

        it("and every row either lists shows the badge it was asked for", async () => {
            for (const filter of ["ACTIVE", "OFFLINE"]) {
                for (const r of await listed(`status=${filter}`)) expect(badge(r), r.id).toBe(filter)
            }
        })

        it("so between them they're everyone signed in or out, once each", async () => {
            const shown = (await listed("")).filter(r => ["ACTIVE", "OFFLINE"].includes(badge(r)))
            expect([...ids(await listed("status=ACTIVE")), ...ids(await listed("status=OFFLINE"))].sort()).toEqual(ids(shown))
        })

        it("keeps a search alongside", async () => {
            expect(ids(await listed("status=OFFLINE&search=gon"))).toEqual(["gone"])
            expect(ids(await listed("status=ACTIVE&search=gon"))).toEqual([])
        })
    })

    describe("a tab coming and going (UserService.updateActivity)", () => {
        /** A person's tabs that are here, and every row of theirs, gone ones too. */
        const tabs = async (userId: string) => (await db.query(`SELECT "tabId", "seenAt" FROM "OpenTab" WHERE "userId" = $1 AND here ORDER BY "tabId"`, [userId])).rows
        const rows = async (userId: string) => (await db.query(`SELECT "tabId", here, seq, sid FROM "OpenTab" WHERE "userId" = $1 ORDER BY "tabId"`, [userId])).rows

        it("shown, adds its row, and the person is online at once", async () => {
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(100), state: "here", seq: 1 }, "laptop")
            expect((await tabs("gone")).map(t => t.tabId)).toEqual([TAB(100)])
            expect(ids(await listed("status=ACTIVE"))).toContain("gone")
        })

        it("shown again, brings the same row up to date rather than adding one", async () => {
            await db.query(`UPDATE "OpenTab" SET "seenAt" = $1 WHERE "tabId" = $2`, [ago(20 * 60_000), TAB(100)])
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(100), state: "here", seq: 2 }, "laptop")
            const here = await tabs("gone")
            expect(here).toHaveLength(1)
            expect(Date.now() - new Date(here[0].seenAt).getTime()).toBeLessThan(60_000)
        })

        it("gone, its row says so, and with no other tab the person is offline at once", async () => {
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(100), state: "away", seq: 3 }, "laptop")
            expect(await tabs("gone")).toEqual([])
            expect(ids(await listed("status=OFFLINE"))).toContain("gone")
        })

        it("a here sent before it went, arriving after, doesn't bring it back", async () => {
            // A tab closed while its last beat was still on its way: the
            // beacon overtook it.
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(100), state: "here", seq: 2 }, "laptop")
            expect(await tabs("gone")).toEqual([])
            expect(ids(await listed("status=OFFLINE"))).toContain("gone")
        })

        it("nor does an away sent before it came back take it away again", async () => {
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(100), state: "here", seq: 5 }, "laptop")
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(100), state: "away", seq: 4 }, "laptop")
            expect((await tabs("gone")).map(t => t.tabId)).toEqual([TAB(100)])
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(100), state: "away", seq: 6 }, "laptop")
        })

        it("an away for a tab never seen leaves it gone, should its here arrive after", async () => {
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(104), state: "away", seq: 2 }, "laptop")
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(104), state: "here", seq: 1 }, "laptop")
            expect(await tabs("gone")).toEqual([])
        })

        it("gone from one device, leaves the other's: a laptop still shown keeps them online", async () => {
            const [stalePhone] = (await tabs("two")).map(t => t.tabId)
            await Users.updateActivity("two", "EMPLOYEE", { tab: stalePhone, state: "away", seq: 1 }, "phone")
            expect(await tabs("two")).toHaveLength(1)
            expect(ids(await listed("status=ACTIVE"))).toContain("two")
        })

        it("can't touch another person's tab, whatever id it names", async () => {
            const [theirs] = (await tabs("here")).map(t => t.tabId)
            await Users.updateActivity("gone", "EMPLOYEE", { tab: theirs, state: "away", seq: 9 }, "laptop")
            await Users.updateActivity("gone", "EMPLOYEE", { tab: theirs, state: "here", seq: 10 }, "laptop")
            expect((await tabs("here")).map(t => t.tabId)).toEqual([theirs])
            await Users.updateActivity("gone", "EMPLOYEE", { tab: theirs, state: "away", seq: 11 }, "laptop")
        })

        it("asked only for the account's state, as live updates ask, writes nothing", async () => {
            const before = await rows("gone")
            const result = await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(101) }, "laptop")
            expect(result.status).toBe("ACTIVE")
            expect(await rows("gone")).toEqual(before)
        })

        it("from a page still on the old script, beats for the person's one tab until it's reloaded", async () => {
            await Users.updateActivity("out", "EMPLOYEE", undefined, "old")
            expect((await tabs("out")).map(t => t.tabId)).toEqual(["legacy"])
            await db.query(`UPDATE "OpenTab" SET "seenAt" = $1 WHERE "userId" = 'out'`, [ago(20 * 60_000)])
            await Users.updateActivity("out", "EMPLOYEE", undefined, "old")
            const here = await tabs("out")
            expect(here).toHaveLength(1)
            expect(Date.now() - new Date(here[0].seenAt).getTime()).toBeLessThan(60_000)
            await db.query(`DELETE FROM "OpenTab" WHERE "userId" = 'out'`)
        })

        it("still tells a suspended person's page so, as the heartbeat always has", async () => {
            const result = await Users.updateActivity("held", "EMPLOYEE", { tab: TAB(102), state: "here", seq: 1 }, "x")
            expect(result.status).toBe("SUSPENDED")
        })

        it("asks nothing of a Super Admin, who has no row", async () => {
            const result = await Users.updateActivity("sa-1", "SUPER_ADMIN", { tab: TAB(103), state: "here", seq: 1 }, "x")
            expect(result.status).toBe("ACTIVE")
            expect((await db.query(`SELECT count(*)::int AS n FROM "OpenTab" WHERE "userId" = 'sa-1'`)).rows[0].n).toBe(0)
        })

        it("signing out closes every tab of that browser's session, and leaves the person's other devices", async () => {
            // Two tabs in the laptop's browser and one on the phone. Signing
            // out ends the session the laptop's tabs share, and their own
            // reports would be refused after it.
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(110), state: "here", seq: 1 }, "laptop")
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(111), state: "here", seq: 1 }, "laptop")
            await Users.updateActivity("gone", "EMPLOYEE", { tab: TAB(112), state: "here", seq: 1 }, "phone")
            // Its two tabs here, and the rows it marked gone earlier on.
            expect(await Users.closeSessionTabs("gone", "laptop")).toBeGreaterThanOrEqual(2)
            expect((await tabs("gone")).map(t => t.tabId)).toEqual([TAB(112)])
            expect(ids(await listed("status=ACTIVE"))).toContain("gone")

            await Users.closeSessionTabs("gone", "phone")
            expect(ids(await listed("status=OFFLINE"))).toContain("gone")
        })

        it("and a tab of it already gone stays gone, its here still on the way as another signs out", async () => {
            // Out of sight, it said away; shown again, its here is sent; and
            // before it arrives another tab signs the browser out (Codex on #262).
            await Users.updateActivity("lost", "EMPLOYEE", { tab: TAB(120), state: "away", seq: 3 }, "desk")
            await Users.closeSessionTabs("lost", "desk")
            await Users.updateActivity("lost", "EMPLOYEE", { tab: TAB(120), state: "here", seq: 4 }, "desk")
            expect((await tabs("lost")).map(t => t.tabId)).not.toContain(TAB(120))
        })

        it("and asks nothing of a session without a name, or someone else's, or one already closed", async () => {
            expect(await Users.closeSessionTabs("lost", "desk")).toBe(0)
            await Users.updateActivity("lost", "EMPLOYEE", { tab: TAB(113), state: "here", seq: 1 }, "laptop")
            expect(await Users.closeSessionTabs("gone", "laptop")).toBe(0)
            expect(await Users.closeSessionTabs("lost", "")).toBe(0)
            expect((await tabs("lost")).map(t => t.tabId)).toContain(TAB(113))
        })
    })

    it("rows past the window are swept, the fresh ones kept", async () => {
        // "stale"'s tab, and one "here" left an hour ago on another device.
        await db.query(`INSERT INTO "OpenTab"("userId", "tabId", "seenAt") VALUES ('here', $1, $2)`, [TAB(200), ago(60 * 60_000)])
        const all = async () => (await db.query(`SELECT "userId", "seenAt" FROM "OpenTab"`)).rows
        const before = await all()
        expect(await Users.pruneOpenTabs(new Date())).toBe(2)
        const left = await all()
        expect(left).toHaveLength(before.length - 2)
        for (const r of left) expect(Date.now() - new Date(r.seenAt).getTime()).toBeLessThanOrEqual(ONLINE_WINDOW_MS)
        expect(left.map(r => r.userId)).toContain("here")
        expect(left.map(r => r.userId)).not.toContain("stale")
    })
})
