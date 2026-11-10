import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { HEARTBEAT_MS, ONLINE_WINDOW_MS, presenceStatus, presenceWhere } from "./presence"
import { buildUserWhereClause } from "./services/user-query"
import { withGrants } from "@/lib/permissions/test-actors"

/**
 * Who shows as online on the Employees list and the Super Admin's All users.
 *
 * A person counted as online for 60 seconds after their last beat, but a tab
 * beats every 90: someone at work showed as Offline for a third of every
 * minute and a half, and in the list's Online filter while their badge said
 * Offline. Now the window is the beat's, twice and a little, so a lost beat
 * doesn't show them offline either, and the filter asks what the badge shows.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8")
const NOW = new Date("2026-11-10T12:00:00Z")
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe("the window a person shows as online in", () => {
    it("is two beats and a little, so one lost beat or a slow answer doesn't show them offline", () => {
        expect(HEARTBEAT_MS).toBe(90_000)
        expect(ONLINE_WINDOW_MS).toBeGreaterThan(2 * HEARTBEAT_MS)
        expect(ONLINE_WINDOW_MS).toBeLessThanOrEqual(2 * HEARTBEAT_MS + 30_000)
    })

    it("is the heartbeat's own interval, read from the same place", () => {
        const heartbeat = read("components/UserHeartbeat.tsx")
        expect(heartbeat).toContain("from \"@/lib/presence\"")
        expect(heartbeat).toContain("}, HEARTBEAT_MS)")
        expect(heartbeat).not.toContain("}, 90000)")
    })
})

describe("a person's status as the list shows it", () => {
    it("is online until just before their next beat, where it was offline after 60 seconds", () => {
        expect(presenceStatus("ACTIVE", ago(61_000), NOW)).toBe("ACTIVE")
        expect(presenceStatus("ACTIVE", ago(HEARTBEAT_MS - 1_000), NOW)).toBe("ACTIVE")
    })

    it("is online still when one beat was lost", () => {
        expect(presenceStatus("ACTIVE", ago(2 * HEARTBEAT_MS - 1_000), NOW)).toBe("ACTIVE")
    })

    it("is offline once the window has passed", () => {
        expect(presenceStatus("ACTIVE", ago(ONLINE_WINDOW_MS + 1), NOW)).toBe("OFFLINE")
    })

    it("is left as it is for anyone not signed in as active", () => {
        for (const status of ["OFFLINE", "SUSPENDED", "ARCHIVED", "INACTIVE"]) {
            expect(presenceStatus(status, ago(1_000), NOW)).toBe(status)
        }
    })

    it("is what the people list sends, in one place", () => {
        const route = read("app/api/users/route.ts")
        expect(route).toContain("presenceStatus(user.status, user.lastActivity)")
        expect(route).not.toMatch(/diffMs > \d+/)
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
    const cutoff = ago(ONLINE_WINDOW_MS)

    it("Online is someone signed in and seen within the window", () => {
        expect(presenceWhere("ACTIVE", NOW)).toEqual({ status: "ACTIVE", lastActivity: { gte: cutoff } })
        const where = build("status=ACTIVE")
        expect(where.AND).toContainEqual(presenceWhere("ACTIVE", NOW))
        expect(where.status).toBeUndefined()
    })

    it("Offline is someone signed out, or signed in and not seen within it", () => {
        expect(presenceWhere("OFFLINE", NOW)).toEqual({
            OR: [
                { status: "OFFLINE" },
                { status: "ACTIVE", lastActivity: { lt: cutoff } },
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
