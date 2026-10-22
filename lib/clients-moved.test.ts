import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Vendors became Clients in 0b (CLIENTS_PLAN.md §0.1), pages included. The
 * old addresses are in links already sent, bookmarks and browser histories,
 * so they open the new pages rather than a 404 (§0.3).
 */

const sentTo: string[] = []
vi.mock("next/navigation", () => ({ redirect: (to: string) => { sentTo.push(to); throw new Error("NEXT_REDIRECT") } }))
beforeEach(() => { sentTo.length = 0 })

describe("the old Vendors addresses", () => {
    it("open the Clients page", async () => {
        const { default: Moved } = await import("@/app/(dashboard)/dashboard/vendors/page")
        expect(() => Moved()).toThrow("NEXT_REDIRECT")
        expect(sentTo).toEqual(["/dashboard/clients"])
    })

    it("open a client's own page", async () => {
        const { default: Moved } = await import("@/app/(dashboard)/dashboard/vendors/[id]/page")
        await expect(Moved({ params: Promise.resolve({ id: "v 1" }) })).rejects.toThrow("NEXT_REDIRECT")
        expect(sentTo).toEqual(["/dashboard/clients/v%201"])
    })
})
