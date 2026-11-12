import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Two database fixes from production's logs (PR 268; TROUBLESHOOTING.md).
 *
 * A transaction is one connection, and node-postgres sends one query at a
 * time on it: one handed to it while another was on its way was queued by
 * the driver, with a warning that pg 9 refuses it. Prisma 7 does that inside
 * a transaction, fetching a read's relations at once, and so did our own
 * Promise.all; submitting a task with a cost paid from a cash advance warned
 * in production. Each connection now sends its queries one after another.
 *
 * And the Super Admin's overview was cached for 30 seconds. Stale, it served
 * the old counts and refreshed them after the page was sent, which Next.js
 * didn't wait for behind the home page's loading boundary: Vercel froze the
 * function mid-handshake with the database, and the error came on the next
 * page that woke it.
 */

const source = (path: string) => readFileSync(path, "utf8")

// The overview's queries, as built, and each batch transaction they were sent in.
const sent = vi.hoisted(() => ({ batches: [] as unknown[][] }))
vi.mock("@/lib/prisma", () => {
    const op = (name: string) => (...args: unknown[]) => ({ op: name, args })
    const model = (name: string) => ({ count: op(`${name}.count`), groupBy: op(`${name}.groupBy`), findMany: op(`${name}.findMany`) })
    return {
        prisma: {
            company: model("company"), user: model("user"), task: model("task"), client: model("client"), auditLog: model("auditLog"),
            $transaction: async (ops: unknown[]) => {
                sent.batches.push(ops)
                return [3, 11, 4, 2, [{ status: "PENDING", _count: 4 }], 1, [], 0]
            },
        },
    }
})

describe("a connection given its queries one at a time", () => {
    /** pg's own query, stood in for: each takes a while, and says when it starts and ends. */
    async function withPgQuery(run: (log: string[]) => Promise<void>) {
        const pg = (await import("pg")).default
        const real = pg.Client.prototype.query
        const log: string[] = []
        pg.Client.prototype.query = function (this: unknown, sent: { text: string; ms?: number }) {
            log.push(`start ${sent.text}`)
            if (sent.text === "fails") return Promise.reject(new Error("NOPE")).finally(() => log.push("end fails"))
            return new Promise(resolve => setTimeout(() => { log.push(`end ${sent.text}`); resolve({ rows: [sent.text] }) }, sent.ms ?? 1))
        } as never
        try {
            await run(log)
        } finally {
            pg.Client.prototype.query = real
        }
    }

    it("sends each query once the one before it is done, in order, and hands each its own answer", async () => {
        const { OneAtATimeClient } = await import("@/lib/one-at-a-time-client")
        await withPgQuery(async log => {
            const client = new OneAtATimeClient()
            // The slow one first: at once, the quick one would have ended before it.
            const answers = await Promise.all([
                client.query({ text: "a", ms: 20 } as never),
                client.query({ text: "b", ms: 1 } as never),
                client.query({ text: "c", ms: 5 } as never),
            ])
            expect(answers.map(a => (a as { rows: string[] }).rows[0])).toEqual(["a", "b", "c"])
            expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"])
        })
    })

    it("goes on after a query that fails, which fails alone", async () => {
        const { OneAtATimeClient } = await import("@/lib/one-at-a-time-client")
        await withPgQuery(async log => {
            const client = new OneAtATimeClient()
            const [failed, next] = await Promise.allSettled([client.query({ text: "fails" } as never), client.query({ text: "after" } as never)])
            expect(failed.status).toBe("rejected")
            expect(next).toMatchObject({ status: "fulfilled", value: { rows: ["after"] } })
            expect(log).toEqual(["start fails", "end fails", "start after", "end after"])
        })
    })

    it("leaves a query with a callback to pg, as the pool's own are", async () => {
        const { OneAtATimeClient } = await import("@/lib/one-at-a-time-client")
        await withPgQuery(async log => {
            const client = new OneAtATimeClient()
            client.query({ text: "held", ms: 20 } as never)
            client.query({ text: "callback" } as never, (() => {}) as never)
            // Sent at once, not behind the turn; the other goes a moment later, in its turn.
            expect(log).toEqual(["start callback"])
            await new Promise(resolve => setTimeout(resolve, 30))
            expect(log).toEqual(["start callback", "start held", "end callback", "end held"])
        })
    })

    it("is every connection Prisma's pool opens", () => {
        const client = source("lib/prisma.ts")
        expect(client).toContain("import { OneAtATimeClient } from './one-at-a-time-client'")
        expect(client).toContain("poolConfigFrom(connectionString, { max: 5, Client: OneAtATimeClient })")
    })
})

describe("the Super Admin's overview", () => {
    beforeEach(() => { sent.batches.length = 0 })

    it("is read fresh, with no cache to refresh after the page is sent", () => {
        const stats = source("lib/services/dashboard-stats.service.ts")
        expect(stats).not.toContain('from "next/cache"')
        expect(stats).not.toMatch(/unstable_cache\(|revalidate:/)
    })

    it("reads its eight figures in one batch transaction: one connection, one snapshot", async () => {
        const { getSuperAdminOverviewStats } = await import("@/lib/services/dashboard-stats.service")
        const stats = await getSuperAdminOverviewStats()
        expect(sent.batches).toHaveLength(1)
        expect((sent.batches[0] as { op: string }[]).map(c => c.op)).toEqual([
            "company.count", "user.count", "task.count", "client.count", "task.groupBy", "auditLog.count", "company.findMany", "company.count",
        ])
        expect(stats).toEqual({
            totalCompanies: 3, totalUsers: 11, totalTasks: 4, totalClients: 2,
            taskStats: [{ status: "PENDING", _count: 4 }], systemErrors24h: 1, expiringSubscriptions: 0, bannedCompanies: 0,
        })
    })
})
