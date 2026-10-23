import { describe, it, expect, vi } from "vitest"
import { prismaMock, as, url, type ActorName } from "./permissions/obligation-access.harness"

/**
 * GET /api/obligations counts a date filter's days in the zone of the company
 * listed (lib/day-range.ts), as the Obligations page does. An employee who
 * sees only their own obligations is listed by who they are, with no company
 * in the search, so their days were counted in the platform's zone instead.
 */

const ZONES: Record<string, string> = { c1: "Asia/Dubai", c2: "Africa/Cairo" }
const PLATFORM_ZONE = "America/New_York"
const listed: any[] = []

const prisma = new Proxy({}, {
    get(_t, prop: string) {
        const base = prismaMock[prop]
        if (prop === "company") return { ...base, findUnique: async (args: any) => args.select?.timezone ? { timezone: ZONES[args.where.id] } : base.findUnique(args) }
        if (prop === "systemSettings") return { ...base, findUnique: async (args: any) => args.select?.defaultTimezone ? { defaultTimezone: PLATFORM_ZONE } : base.findUnique(args) }
        if (prop === "obligation") return { ...base, findMany: async (args: any) => { listed.push(args.where); return [] } }
        return base
    },
})

vi.mock("next-auth", async () => ({ getServerSession: async () => (await import("./permissions/obligation-access.harness")).state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ get prisma() { return prisma } }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

/** The days GET /api/obligations filtered by, for 15 January. */
async function daysListed(actor: ActorName, search = "") {
    as(actor)
    listed.length = 0
    const { GET } = await import("@/app/api/obligations/route")
    const res = await GET(new Request(url(`/api/obligations?dateFrom=2026-01-15&dateTo=2026-01-15${search}`)))
    expect(res.status).toBe(200)
    return listed[0].updatedAt
}

const DUBAI = { gte: new Date("2026-01-14T20:00:00.000Z"), lte: new Date("2026-01-15T19:59:59.999Z") }
const CAIRO = { gte: new Date("2026-01-14T22:00:00.000Z"), lte: new Date("2026-01-15T21:59:59.999Z") }
const NEW_YORK = { gte: new Date("2026-01-15T05:00:00.000Z"), lte: new Date("2026-01-16T04:59:59.999Z") }

describe("the obligations a date filter lists are counted in the days", () => {
    it("of an employee's own company, when they see only their own", async () => {
        expect(await daysListed("employee")).toEqual(DUBAI)
    })

    it("of the company, for its Admin and Team Leader", async () => {
        expect(await daysListed("admin")).toEqual(DUBAI)
        expect(await daysListed("leader")).toEqual(DUBAI)
    })

    it("of the company a Super Admin picks, or the platform's for every company", async () => {
        expect(await daysListed("superAdmin", "&companyId=c2")).toEqual(CAIRO)
        expect(await daysListed("superAdmin")).toEqual(NEW_YORK)
    })
})
