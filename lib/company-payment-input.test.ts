import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A company payment the Super Admin records has a positive cost and a
 * subscription type that exists. Found while checking which routes take a
 * body without validating it: an unknown type was stored and then refused
 * when the payment was confirmed, leaving one that could never be marked
 * paid; a cost that wasn't a positive number was stored as sent.
 */

const created: unknown[][] = []
const session = { value: { user: { id: "sa", role: "SUPER_ADMIN", companyId: null } } as any }

vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: { rateLimit: { upsert: async () => ({ count: 1 }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/company.service", () => ({
    CompanyService: { createPayment: async (...args: unknown[]) => { created.push(args); return { id: "p1" } } },
}))

const record = async (body: unknown) => (await import("@/app/api/companies/[id]/payments/route")).POST(
    new Request("https://nizmo.test/api/companies/c1/payments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: "c1" }) } as any,
)

describe("recording a company payment", () => {
    beforeEach(() => { created.length = 0 })

    it("refuses a cost that isn't a positive number", async () => {
        for (const cost of [-100, "abc", "0"]) expect((await record({ cost, subscriptionType: "MONTHLY" })).status, String(cost)).toBe(400)
        expect(created).toEqual([])
    })

    it("refuses a subscription type that doesn't exist", async () => {
        expect((await record({ cost: 500, subscriptionType: "WEEKLY" })).status).toBe(400)
        expect(created).toEqual([])
    })

    it("records a real one, a cost typed as text included", async () => {
        expect((await record({ cost: "499.50", subscriptionType: "ANNUALLY" })).status).toBe(201)
        expect(created[0].slice(0, 3)).toEqual(["c1", 499.5, "ANNUALLY"])
    })
})
