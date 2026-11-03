import { afterEach, describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The period a payment will pay for, said before it's marked paid (the Super
 * Admin's pages part 3b), is worked out by the server, as marking it paid is.
 * Worked out in the browser, the calendar arithmetic ran in the browser's
 * timezone and the saving in the server's, so near a month's end the two
 * could disagree (Codex on PR 172).
 */
const rows = [
    { id: "paid1", companyId: "c1", cost: 50, subscriptionType: "MONTHLY", status: "PAID", startDate: new Date("2026-10-30T23:00:00Z"), endDate: new Date("2026-11-30T23:00:00Z"), createdAt: new Date("2026-10-30T22:00:00Z") },
    { id: "un1", companyId: "c1", cost: 50, subscriptionType: "MONTHLY", status: "UNPAID", startDate: null, endDate: null, createdAt: new Date("2026-11-02T08:00:00Z") },
]
const written: Record<string, unknown>[] = []
vi.mock("@/lib/prisma", () => ({
    prisma: {
        companyPayment: {
            findMany: async ({ where }: { where: { status?: string; id?: { not: string } } }) =>
                rows.filter(r => (!where?.status || r.status === where.status) && (!where?.id || r.id !== where.id.not)),
            findUnique: async ({ where }: { where: { id: string } }) => rows.find(r => r.id === where.id) ?? null,
            findFirst: async () => { throw new Error("the period is worked out from every paid payment, by periodIfPaid") },
            update: (args: { data: Record<string, unknown> }) => { written.push(args.data); return { ...rows[1], ...args.data } },
        },
        company: { update: () => ({}) },
        $transaction: async (ops: unknown[]) => ops,
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {} } }))

afterEach(() => { vi.useRealTimers() })

describe("the period a payment will pay for", () => {
    it("comes from the server with each unpaid payment, after the furthest one paid", async () => {
        const { CompanyService } = await import("@/lib/services/company.service")
        const now = new Date("2026-11-02T10:00:00Z")
        const listed = await CompanyService.getPayments("c1", now)
        const unpaid = listed.find(p => p.id === "un1")!
        expect(unpaid.ifPaid).toEqual({ start: new Date("2026-11-30T23:00:00Z"), end: new Date("2026-12-30T23:00:00Z") })
        expect(listed.find(p => p.id === "paid1")!.ifPaid).toBeUndefined()
    })

    it("is the period marking it paid saves", async () => {
        const { CompanyService } = await import("@/lib/services/company.service")
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-11-02T10:00:00Z"))
        const promised = (await CompanyService.getPayments("c1")).find(p => p.id === "un1")!.ifPaid
        written.length = 0
        await CompanyService.updatePaymentStatus("un1", "PAID", { user: { id: "sa1" } })
        expect({ start: written[0].startDate, end: written[0].endDate }).toEqual(promised)
    })

    it("is said as the server worked it out, not worked out again in the browser", () => {
        const dialogs = readFileSync("components/PaymentDialogs.tsx", "utf8")
        expect(dialogs).not.toContain("periodIfPaid")
        expect(dialogs).toContain("payment.ifPaid")
        // Asked again as the dialog opens, so a list left open overnight doesn't promise yesterday.
        const page = readFileSync("app/(dashboard)/dashboard/companies/[id]/payments/page.tsx", "utf8")
        expect(page).toMatch(/setPaying\(p\.id\)\s*\n?\s*void mutate\(\)|setPaying\(p\.id\); void mutate\(\)/)
    })
})
