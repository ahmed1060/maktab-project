import { describe, it, expect, vi, beforeEach } from "vitest"

// A notification is addressed to either a company User or a platform SuperAdmin,
// and those ids come from separate tables with independent UUID spaces. Writing
// one to the other's column is not a type error and not a lint error — it is a
// foreign-key violation that only appears at runtime, against a real database,
// on the first row that takes the path.
//
// That is exactly how the expiry-reminder job shipped broken: it collected ids
// from the SuperAdmin table and wrote them all to Notification.userId, so every
// insert threw and no reminder was ever delivered. Nothing in typecheck, lint or
// build could see it, and CI has no database to catch it either.
//
// So these tests assert the column choice itself, against a mocked client. They
// need no database and guard the one thing that was actually wrong.

const prismaMock: any = {
    notification: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    companyPayment: { findMany: vi.fn(), update: vi.fn() },
    superAdmin: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    $transaction: vi.fn(),
}

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const { NotificationService } = await import("./notification.service")
const { CompanyService } = await import("./company.service")

beforeEach(() => {
    vi.clearAllMocks()
})

// Any message will do here; these are about which column the recipient lands in.
const M = { key: "notice_someone" } as const

describe("NotificationService recipient columns", () => {
    it("notifyMany writes userId and never superAdminId", async () => {
        await NotificationService.notifyMany(["u-1", "u-2"], "T", M, "r")

        const rows = prismaMock.notification.createMany.mock.calls[0][0].data
        expect(rows.map((r: any) => r.userId)).toEqual(["u-1", "u-2"])
        expect(rows.every((r: any) => r.superAdminId === undefined)).toBe(true)
    })

    it("notifySuperAdmins writes superAdminId and never userId", async () => {
        await NotificationService.notifySuperAdmins(["sa-1", "sa-2"], "T", M, "r")

        const rows = prismaMock.notification.createMany.mock.calls[0][0].data
        expect(rows.map((r: any) => r.superAdminId)).toEqual(["sa-1", "sa-2"])
        expect(rows.every((r: any) => r.userId === undefined)).toBe(true)
    })

    it("neither writes anything for an empty recipient list", async () => {
        await NotificationService.notifyMany([], "T", M)
        await NotificationService.notifySuperAdmins([], "T", M)
        expect(prismaMock.notification.createMany).not.toHaveBeenCalled()
    })

    it("recipientFilter matches either column, so it works whichever table the id came from", () => {
        expect(NotificationService.recipientFilter("x")).toEqual({
            OR: [{ userId: "x" }, { superAdminId: "x" }],
        })
    })

    it("reads and mark-as-read both use that filter rather than userId alone", async () => {
        await NotificationService.getByUser("sa-1")
        expect(prismaMock.notification.findMany.mock.calls[0][0].where).toEqual(
            NotificationService.recipientFilter("sa-1")
        )

        await NotificationService.markAllAsRead("sa-1")
        const where = prismaMock.notification.updateMany.mock.calls[0][0].where
        expect(where.OR).toEqual(NotificationService.recipientFilter("sa-1").OR)
        expect(where.read).toBe(false)
    })
})

describe("checkSubscriptions recipient routing", () => {
    // The regression itself: two id sources, two columns, no crossing over.
    const setup = () => {
        const txWrites: any[] = []
        const tx = {
            notification: { createMany: vi.fn((args: any) => { txWrites.push(args.data); return {} }) },
            companyPayment: { update: vi.fn() },
        }

        prismaMock.companyPayment.findMany.mockResolvedValue([
            {
                id: "pay-1",
                // 14 days out exactly: the rung fires on first sighting, which is
                // the ordinary case rather than the mid-period backfill one.
                endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                remindersSent: [],
                company: { id: "co-1", name: "Acme" },
            },
        ])
        prismaMock.superAdmin.findMany.mockResolvedValue([{ id: "sa-1" }])
        // checkSubscriptions calls user.findMany twice: platform Super Admins
        // first, then the customer's own Admins.
        prismaMock.user.findMany
            .mockResolvedValueOnce([{ id: "u-1" }])
            .mockResolvedValueOnce([{ id: "admin-1", companyId: "co-1" }])
        prismaMock.$transaction.mockImplementation(async (fn: any) => fn(tx))

        return { tx, txWrites }
    }

    it("routes SuperAdmin-table ids to superAdminId and User ids to userId", async () => {
        const { txWrites } = setup()
        await CompanyService.checkSubscriptions()

        const all = txWrites.flat()
        // One platform Super Admin, one platform User, one company Admin.
        expect(all).toHaveLength(3)

        const bySuperAdmin = all.filter((r: any) => r.superAdminId)
        const byUser = all.filter((r: any) => r.userId)

        expect(bySuperAdmin.map((r: any) => r.superAdminId)).toEqual(["sa-1"])
        expect(byUser.map((r: any) => r.userId).sort()).toEqual(["admin-1", "u-1"])

        // The actual bug: a SuperAdmin id appearing in userId.
        expect(all.some((r: any) => r.userId === "sa-1")).toBe(false)
        expect(all.some((r: any) => r.superAdminId === "u-1")).toBe(false)
    })

    it("sets the notified flag inside the same transaction as the inserts", async () => {
        const { tx } = setup()
        await CompanyService.checkSubscriptions()

        // Not merely called — called on the transaction client. Setting it on the
        // base client (as this job used to) means a partial failure leaves the
        // flag false and re-notifies everyone on the next run.
        expect(tx.companyPayment.update).toHaveBeenCalledWith({
            where: { id: "pay-1" },
            data: { remindersSent: { push: [14] } },
        })
        expect(prismaMock.companyPayment.update).not.toHaveBeenCalled()
    })

    it("gives the notification a routable target instead of a bare payment id", async () => {
        const { txWrites } = setup()
        await CompanyService.checkSubscriptions()

        const all = txWrites.flat()

        // Operators get a link to the company's billing page...
        for (const row of all.filter((r: any) => r.superAdminId || r.userId === "u-1")) {
            expect(row.relatedId).toBe("/dashboard/companies/co-1/payments")
        }

        // ...the customer's Admin does not, because that page is Super Admin
        // only and a notification that navigates to a 403 is worse than one
        // that does not navigate.
        const customerRow = all.find((r: any) => r.userId === "admin-1")
        expect(customerRow.relatedId).toBeUndefined()
        expect(customerRow.message).toMatch(/Your subscription expires/)
    })

    it("writes nothing, and spends no rung, when there is nobody to notify", async () => {
        const { tx } = setup()
        prismaMock.superAdmin.findMany.mockResolvedValue([])
        prismaMock.user.findMany.mockReset()
        prismaMock.user.findMany.mockResolvedValue([])

        const result = await CompanyService.checkSubscriptions()

        expect(tx.notification.createMany).not.toHaveBeenCalled()
        // And critically: the rung is NOT recorded. Burning it here would leave
        // the next run — by which time a recipient may exist — silent.
        expect(tx.companyPayment.update).not.toHaveBeenCalled()
        expect(prismaMock.companyPayment.update).not.toHaveBeenCalled()
        expect(result.notificationsSent).toBe(0)
    })

    it("records the skipped rungs without notifying, when first seen mid-period", async () => {
        const { tx } = setup()
        // Five days out and never reminded: rung 14's moment has passed, rung 3's
        // has not arrived. Nothing is sent, but 14 is spent so it cannot fire late.
        prismaMock.companyPayment.findMany.mockResolvedValue([
            {
                id: "pay-1",
                endDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
                remindersSent: [],
                company: { id: "co-1", name: "Acme" },
            },
        ])

        const result = await CompanyService.checkSubscriptions()

        expect(tx.notification.createMany).not.toHaveBeenCalled()
        expect(prismaMock.companyPayment.update).toHaveBeenCalledWith({
            where: { id: "pay-1" },
            data: { remindersSent: { push: [14] } },
        })
        expect(result.remindersSent).toBe(0)
    })

    it("does not re-send a rung already spent", async () => {
        const { tx } = setup()
        prismaMock.companyPayment.findMany.mockResolvedValue([
            {
                id: "pay-1",
                endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
                remindersSent: [14],
                company: { id: "co-1", name: "Acme" },
            },
        ])

        await CompanyService.checkSubscriptions()

        expect(tx.notification.createMany).not.toHaveBeenCalled()
        expect(prismaMock.companyPayment.update).not.toHaveBeenCalled()
    })
})
