import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, as, url, withBody, fieldsWritten } from "./employee-access.harness"

/**
 * Step-up at the routes (ROLES_PLAN.md §6.15), through the real handler and
 * UserService: a high-risk action from a session that has not confirmed
 * recently is answered with a 403 carrying a code the screen acts on, and
 * nothing is done. lib/step-up.test.ts checks that every high-risk route asks.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))
vi.mock("@/lib/services/salary-history.service", () => ({ SalaryHistoryService: { record: async () => {} } }))
vi.mock("@/lib/services/salary.service", () => ({ SalaryService: { ensureRecordExists: async () => {} } }))

const users = () => import("@/app/api/users/route")
const unconfirmed = (patch: Record<string, unknown>) => { as("admin"); state.session.user = { ...state.session.user, stepUpAt: null, ...patch } }

describe("a high-risk action without a recent code", () => {
    it("asks for the code, and does nothing", async () => {
        unconfirmed({})
        const res = await (await users()).PUT(withBody("PUT", "/api/users", { id: "emp", salary: 1500 }))
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED", minutes: 60 })
        expect(fieldsWritten()).toEqual([])
    })

    it("asks somebody without two-factor authentication to set it up", async () => {
        unconfirmed({ mfaEnabled: false })
        const res = await (await users()).DELETE(new Request(url("/api/users?id=emp"), { method: "DELETE" }))
        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ code: "MFA_ENROL_REQUIRED" })
    })

    it("does not ask when nothing high-risk changes: saving the same salary", async () => {
        unconfirmed({})
        const res = await (await users()).PUT(withBody("PUT", "/api/users", { id: "emp", salary: 1000, gender: "FEMALE" }))
        expect(res.status).toBe(200)
        expect(fieldsWritten()).toContain("gender")
    })
})
