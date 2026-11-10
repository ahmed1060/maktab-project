import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { Client } from "pg"
import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { HEARTBEAT_MS, ONLINE_WINDOW_MS, presenceStatus } from "./presence"
import { buildUserWhereClause } from "./services/user-query"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * The Employees list's Online and Offline filters, asked of a real Postgres
 * through Prisma, list who the badges say (PR 246).
 *
 * lib/presence.test.ts checks the clause's shape; this checks Prisma takes it.
 * The first version of the Offline filter asked for someone never seen, with
 * `lastActivity: null`, and Prisma refused the whole query, as the column is
 * never empty: the filter answered with an error, and its unit tests passed.
 *
 * Needs a Postgres it may create databases on: set ROLES_TEST_DATABASE_URL to
 * its maintenance database. Skipped without it (CI has no database).
 */

const ADMIN_URL = process.env.ROLES_TEST_DATABASE_URL
const MIGRATIONS = readdirSync("prisma/migrations").filter(m => m !== "migration_lock.toml").sort((a, b) => (a === "0_init" ? -1 : b === "0_init" ? 1 : a.localeCompare(b)))
const sql = (name: string) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")

const NOW = new Date("2026-11-10T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "DELETED", "OFFLINE", "ARCHIVED"]
const ROLES = ["ADMIN", "TEAM_LEADER", "EMPLOYEE"]

/** Hana's company, c1, and who's in it as the list would show them. */
const PEOPLE: { id: string; status: string; seen: Date; company?: string }[] = [
    { id: "here", status: "ACTIVE", seen: ago(75_000) },                  // between two beats
    { id: "lost", status: "ACTIVE", seen: ago(2 * HEARTBEAT_MS - 1_000) }, // one beat lost
    { id: "gone", status: "ACTIVE", seen: ago(5 * 60_000) },              // tab closed, never signed out
    { id: "out", status: "OFFLINE", seen: ago(30_000) },                  // signed out a moment ago
    { id: "held", status: "SUSPENDED", seen: ago(10_000) },
    { id: "away", status: "ACTIVE", seen: ago(10_000), company: "c2" },   // another company
]

describe.skipIf(!ADMIN_URL)("who shows as online, in Postgres", () => {
    const dbName = `presence_test_${Date.now()}`
    let db: Client
    let prisma: PrismaClient

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
        // their company's built-in one is; their status and when they were
        // seen are set once every migration has run.
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
        for (const p of PEOPLE) {
            await db.query(`UPDATE "User" SET status = $2::"UserStatus", "lastActivity" = $3 WHERE id = $1`, [p.id, p.status, p.seen])
        }
        prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }) })
    }, 120_000)

    afterAll(async () => {
        await prisma?.$disconnect()
        await db?.end()
        const a = new Client({ connectionString: ADMIN_URL })
        await a.connect()
        await a.query(`DROP DATABASE IF EXISTS ${dbName}`)
        await a.end()
    })

    const admin = { user: withGrants({ id: "hana", role: "ADMIN", companyId: "c1" }) }
    /** Who the list shows for a query string, by id. */
    const listed = async (qs: string) => {
        const built = buildUserWhereClause(admin as any, new URLSearchParams(qs), undefined, ROLES, STATUSES, NOW)
        if (built.empty) throw new Error("no clause")
        const rows = await prisma.user.findMany({ where: built.whereClause, select: { id: true, status: true, lastActivity: true }, orderBy: { id: "asc" } })
        return rows
    }
    const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort()

    it("Online lists who's been seen within the window, a lost beat included", async () => {
        expect(ids(await listed("status=ACTIVE"))).toEqual(["here", "lost"])
    })

    it("Offline lists who signed out, and who's signed in and not seen within it", async () => {
        expect(ids(await listed("status=OFFLINE"))).toEqual(["gone", "out"])
    })

    it("and every row either lists shows the badge it was asked for", async () => {
        for (const filter of ["ACTIVE", "OFFLINE"]) {
            for (const r of await listed(`status=${filter}`)) expect(presenceStatus(r.status, r.lastActivity, NOW)).toBe(filter)
        }
    })

    it("so between them they're everyone signed in or out, once each", async () => {
        const all = await listed("")
        const shown = all.filter(r => ["ACTIVE", "OFFLINE"].includes(presenceStatus(r.status, r.lastActivity, NOW)))
        expect([...ids(await listed("status=ACTIVE")), ...ids(await listed("status=OFFLINE"))].sort()).toEqual(ids(shown))
    })

    it("keeps a search alongside", async () => {
        expect(ids(await listed("status=OFFLINE&search=gon"))).toEqual(["gone"])
        expect(ids(await listed("status=ACTIVE&search=gon"))).toEqual([])
    })

    it("and the window ends where presenceStatus says", async () => {
        await db.query(`UPDATE "User" SET "lastActivity" = $1 WHERE id = 'lost'`, [ago(ONLINE_WINDOW_MS + 1)])
        expect(ids(await listed("status=ACTIVE"))).toEqual(["here"])
        expect(ids(await listed("status=OFFLINE"))).toEqual(["gone", "lost", "out"])
        await db.query(`UPDATE "User" SET "lastActivity" = $1 WHERE id = 'lost'`, [ago(ONLINE_WINDOW_MS)])
        expect(ids(await listed("status=ACTIVE"))).toEqual(["here", "lost"])
    })
})
