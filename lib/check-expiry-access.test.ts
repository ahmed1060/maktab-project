import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Who may run the note-expiry job.
 *
 * It runs over every company's notes. The cron runs it daily; a Super Admin
 * may run it by hand. A company Admin could too, until Part B — which is one
 * company starting a job that touches all of them.
 */

const state = { session: null as any, ran: 0 }

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/services/note.service", () => ({ NoteService: { checkExpiries: async () => { state.ran++; return { success: true } } } }))
vi.mock("@/lib/services/job-heartbeat.service", () => ({ JobHeartbeatService: { run: async (_: string, fn: any) => fn() } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

async function trigger(headers: Record<string, string> = {}) {
    const { GET } = await import("@/app/api/notes/check-expiry/route")
    return GET(new Request("https://nizmo.test/api/notes/check-expiry", { headers }))
}

beforeEach(() => { state.ran = 0; state.session = null; process.env.CRON_SECRET = "s3cret" })

describe("running the note-expiry job", () => {
    it("the cron may", async () => {
        expect((await trigger({ authorization: "Bearer s3cret" })).status).toBe(200)
        expect(state.ran).toBe(1)
    })

    it("a Super Admin may, by hand", async () => {
        state.session = { user: { id: "sa", role: "SUPER_ADMIN" } }
        expect((await trigger()).status).toBe(200)
        expect(state.ran).toBe(1)
    })

    it("a company Admin may not", async () => {
        state.session = { user: { id: "a", role: "ADMIN", companyId: "c1" } }
        expect((await trigger()).status).toBe(401)
        expect(state.ran).toBe(0)
    })

    it("nobody else may", async () => {
        state.session = { user: { id: "e", role: "EMPLOYEE", companyId: "c1" } }
        expect((await trigger()).status).toBe(401)
        expect((await trigger({ authorization: "Bearer wrong" })).status).toBe(401)
        expect(state.ran).toBe(0)
    })
})
