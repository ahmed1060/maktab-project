import { describe, it, expect, vi } from "vitest"
import { state, prismaMock, obligationState, as, withBody } from "./obligation-access.harness"

vi.setConfig({ testTimeout: 60_000 })

/**
 * An obligation's status is one of its own, and an assignee only moves their
 * obligation along. Found while checking which routes take a body without
 * validating it: the status column is free text, so any string was stored,
 * and an assignee could set their obligation back to Pending, to Archived, or
 * away from a manager's approval, taking the points it earned.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/supabase", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const set = async (status: string, from = "IN_PROGRESS") => {
    obligationState.status = from
    return (await import("@/app/api/obligations/[id]/route")).PUT(withBody("PUT", "/api/obligations/o-emp", { status }), { params: { id: "o-emp" } } as any)
}

describe("an obligation's status", () => {
    it("is one an obligation can have", async () => {
        as("admin")
        expect((await set("DONE-ISH")).status).toBe(400)
        as("employee")
        expect((await set("DONE-ISH")).status).toBe(400)
    })

    it("is moved along by its assignee, and nothing more", async () => {
        as("employee")
        expect((await set("COMPLETED")).status).toBe(200)
        expect((await set("PENDING_CONFIRMATION")).status).toBe(200)
        expect((await set("ARCHIVED")).status).toBe(403)
        expect((await set("PENDING")).status).toBe(403)
        // Not away from a manager's approval.
        expect((await set("COMPLETED", "APPROVED")).status).toBe(403)
    })

    it("is the manager's to decide and change", async () => {
        as("admin")
        expect((await set("APPROVED", "COMPLETED")).status).toBe(200)
        expect((await set("ARCHIVED")).status).toBe(200)
    })
})
