import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * What today is (`GET /api/time`), in a company's calendar (review on PR 425):
 * Add employee's contract start date is today unless changed, and today in
 * Cairo is a day out for a company far from it, around midnight. The
 * signed-in person's company's, or for the Super Admin the one they're
 * adding someone to; Cairo's with neither.
 */

const state = { session: null as unknown }
const zones: Record<string, string> = { far: "Pacific/Kiritimati", near: "Africa/Cairo" }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: { company: { findUnique: async ({ where }: { where: { id: string } }) => (zones[where.id] ? { timezone: zones[where.id] } : null) } },
}))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

// 21:30 in Cairo on 26 November, already 11:30 on the 27th at Kiritimati.
const NOW = new Date("2026-11-26T19:30:00Z")
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers() })

const ask = async (session: unknown, query = "") => {
    state.session = session
    const res = await (await import("@/app/api/time/route")).GET(new Request(`https://nizmo.test/api/time${query}`))
    return { status: res.status, body: (await res.json()).data }
}
const person = (companyId: string | null, role = "ADMIN") => ({ user: { id: "u1", role, companyId } })

describe("what today is", () => {
    it("is today in the signed-in person's company's calendar", async () => {
        expect(await ask(person("far"))).toEqual({ status: 200, body: { today: "2026-11-27", now: NOW.toISOString(), timezone: "Pacific/Kiritimati" } })
        expect((await ask(person("near"))).body.today).toBe("2026-11-26")
    })

    it("is their own company's, whatever company is asked about", async () => {
        expect((await ask(person("near"), "?companyId=far")).body).toMatchObject({ today: "2026-11-26", timezone: "Africa/Cairo" })
    })

    it("is the company asked about for the Super Admin, and Cairo's with none", async () => {
        expect((await ask(person(null, "SUPER_ADMIN"), "?companyId=far")).body).toMatchObject({ today: "2026-11-27", timezone: "Pacific/Kiritimati" })
        expect((await ask(person(null, "SUPER_ADMIN"))).body).toMatchObject({ today: "2026-11-26", timezone: "Africa/Cairo" })
        expect((await ask(person(null, "SUPER_ADMIN"), "?companyId=gone")).body).toMatchObject({ today: "2026-11-26", timezone: "Africa/Cairo" })
    })
})
