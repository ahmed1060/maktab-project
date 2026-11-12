import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { AWAY_AFTER_MS, HEARTBEAT_MS, ONLINE_WINDOW_MS, onlineRunsOutIn, presenceStatus, presenceWhere } from "./presence"
import { buildUserWhereClause } from "./services/user-query"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Who shows as online on the Employees list and the Super Admin's All users.
 *
 * Until part 6a (REALTIME_PLAN.md §3) it was whoever's heartbeat had come
 * within two beats and a little, so someone who'd closed the app showed as
 * online for minutes after, and the heartbeat ran every 90 seconds for it.
 * Now each open tab has a row of its own, there while the tab is shown and
 * taken away as it goes (lib/tab-presence.ts): a person is online while any
 * tab of theirs has a fresh one. The heartbeat, every 15 minutes, keeps a
 * shown tab's row fresh, and a row whose tab left unheard runs out after two
 * beats and the 2 minutes a tab may be out of sight.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")
const NOW = new Date("2026-11-12T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe("the window a tab's row stays fresh in", () => {
    it("is two beats and the 2 minutes out of sight, so one lost beat doesn't show anyone offline", () => {
        expect(HEARTBEAT_MS).toBe(15 * 60_000)
        expect(AWAY_AFTER_MS).toBe(2 * 60_000)
        expect(ONLINE_WINDOW_MS).toBe(2 * HEARTBEAT_MS + AWAY_AFTER_MS)
    })

    it("is the heartbeat's own interval, read from the same place", () => {
        const heartbeat = read("components/UserHeartbeat.tsx")
        expect(heartbeat).toContain("from \"@/lib/presence\"")
        expect(heartbeat).toContain("}, HEARTBEAT_MS)")
        expect(heartbeat).not.toContain("}, 90000)")
    })
})

describe("a person's status as the list shows it", () => {
    it("is online while their newest tab was seen within the window", () => {
        expect(presenceStatus("ACTIVE", ago(60_000), NOW)).toBe("ACTIVE")
        expect(presenceStatus("ACTIVE", ago(2 * HEARTBEAT_MS - 1_000), NOW)).toBe("ACTIVE")
        expect(presenceStatus("ACTIVE", ago(ONLINE_WINDOW_MS), NOW)).toBe("ACTIVE")
    })

    it("is offline once it's run out, and at once with no tab open", () => {
        expect(presenceStatus("ACTIVE", ago(ONLINE_WINDOW_MS + 1), NOW)).toBe("OFFLINE")
        expect(presenceStatus("ACTIVE", null, NOW)).toBe("OFFLINE")
    })

    it("is left as it is for anyone not signed in as active", () => {
        for (const status of ["OFFLINE", "SUSPENDED", "ARCHIVED", "INACTIVE"]) {
            expect(presenceStatus(status, ago(1_000), NOW)).toBe(status)
            expect(presenceStatus(status, null, NOW)).toBe(status)
        }
    })

    it("is what the people list sends, from each person's newest tab", () => {
        const route = read("app/api/users/route.ts")
        expect(route).toContain("presenceStatus(user.status, openTabs[0]?.seenAt ?? null, now)")
        expect(route).toMatch(/openTabs: \{ where: \{ here: true \}, orderBy: \{ seenAt: "desc" \}, take: 1, select: \{ seenAt: true \} \}/)
        expect(route).not.toContain("presenceStatus(user.status, user.lastActivity)")
    })
})

// Part 6b: a tab whose leaving wasn't heard runs out with nothing written,
// so no signal says so. The list is drawn again as the first person it shows
// online would run out, by the server's clock.
describe("when the list is drawn again, with nothing heard", () => {
    it("is as the first person it shows online would run out", () => {
        expect(onlineRunsOutIn([
            { status: "ACTIVE", lastSeen: ago(60_000) },
            { status: "ACTIVE", lastSeen: ago(10 * 60_000) },
            { status: "ACTIVE", lastSeen: null },
        ], NOW)).toBe(ONLINE_WINDOW_MS - 10 * 60_000 + 1)
    })

    it("is never, with nobody shown online", () => {
        expect(onlineRunsOutIn([], NOW)).toBeNull()
        expect(onlineRunsOutIn([{ status: "ACTIVE", lastSeen: null }, { status: "SUSPENDED", lastSeen: ago(1_000) }], NOW)).toBeNull()
        expect(onlineRunsOutIn([{ status: "ACTIVE", lastSeen: ago(ONLINE_WINDOW_MS + 1) }], NOW)).toBeNull()
    })

    it("is a moment on for someone on the edge, once they'd show offline", () => {
        expect(onlineRunsOutIn([{ status: "ACTIVE", lastSeen: ago(ONLINE_WINDOW_MS) }], NOW)).toBe(1)
        expect(presenceStatus("ACTIVE", ago(ONLINE_WINDOW_MS), new Date(NOW.getTime() + 1))).toBe("OFFLINE")
    })

    it("is what the people list sends with its page, from the same moment as each badge", () => {
        const route = read("app/api/users/route.ts")
        expect(route).toContain("const now = new Date()")
        expect(route).toContain("presenceStatus(user.status, openTabs[0]?.seenAt ?? null, now)")
        expect(route).toContain("onlineRunsOutInMs: onlineRunsOutIn(users.map(u => ({ status: u.status, lastSeen: u.openTabs[0]?.seenAt ?? null })), now),")
    })

    // The database signals a tab here again after its row ran out: it reads
    // the window as this file does.
    it("and the database's own reading of a row that ran out is the same window", () => {
        const migration = read("prisma/migrations/20261214000000_live_online/migration.sql")
        expect(migration).toContain(`interval '${ONLINE_WINDOW_MS / 60_000} minutes'`)
    })
})

describe("the list's Online and Offline filters", () => {
    const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED", "DELETED", "OFFLINE", "ARCHIVED"]
    const admin = { user: withGrants({ id: "a-1", role: "ADMIN", companyId: "co-1" }) }
    const build = (qs: string) => {
        const r = buildUserWhereClause(admin as any, new URLSearchParams(qs), undefined, ["ADMIN", "TEAM_LEADER", "EMPLOYEE"], STATUSES, NOW)
        expect(r.empty).toBe(false)
        return (r as any).whereClause
    }
    // A tab's row stays as it goes, marked gone, so a report sent before
    // that, arriving after, can't bring it back (PR 262).
    const fresh = { here: true, seenAt: { gte: ago(ONLINE_WINDOW_MS) } }

    it("Online is someone signed in with a fresh tab", () => {
        expect(presenceWhere("ACTIVE", NOW)).toEqual({ status: "ACTIVE", openTabs: { some: fresh } })
        const where = build("status=ACTIVE")
        expect(where.AND).toContainEqual(presenceWhere("ACTIVE", NOW))
        expect(where.status).toBeUndefined()
    })

    it("Offline is someone signed out, or signed in with no fresh tab", () => {
        expect(presenceWhere("OFFLINE", NOW)).toEqual({
            OR: [
                { status: "OFFLINE" },
                { status: "ACTIVE", openTabs: { none: fresh } },
            ],
        })
        expect(build("status=OFFLINE").AND).toContainEqual(presenceWhere("OFFLINE", NOW))
    })

    it("leaves a search in place alongside it", () => {
        const where = build("status=OFFLINE&search=hana")
        expect(where.OR).toEqual(expect.arrayContaining([{ firstName: { contains: "hana", mode: "insensitive" } }]))
        expect(where.AND).toContainEqual(presenceWhere("OFFLINE", NOW))
    })

    it("filters every other status as it's stored", () => {
        expect(build("status=SUSPENDED").status).toBe("SUSPENDED")
        expect(build("status=ARCHIVED").status).toBe("ARCHIVED")
    })
})
