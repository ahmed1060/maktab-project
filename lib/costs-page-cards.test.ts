import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The Costs page's cards: one per member's share of a task's cost. A cost
 * that isn't split by member, as a task's was before memberCosts, is one card
 * for the task. That card was given `task.assignee`, which a task doesn't
 * have (it has assignees), so reading its id took the whole page down.
 *
 * A share already paid isn't waiting any more, as one employee's are once
 * Mark all as paid pays them, so the page leaves it out.
 */

const address = { query: "" }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(address.query),
}))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/HeaderContext", () => ({ useHeader: () => ({ setTitle: () => {}, setSubtitle: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Costs" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: () => true, companyWide: () => true }) }))
// Its filters and pages aren't what's checked here.
vi.mock("@/components/EmployeeFilter", () => ({ default: () => null }))
vi.mock("@/components/Pagination", () => ({ default: () => null }))

const ali = { id: "u1", firstName: "Ali", lastName: "Hassan" }
const mona = { id: "u2", firstName: "Mona", lastName: "Adel" }
const task = (fields: object) => ({
    id: "t1", title: "Fix the gate", status: "APPROVED", updatedAt: "2026-10-20T09:00:00Z",
    totalCost: 300, memberCosts: null, memberPaymentStatus: null, assignees: [ali, mona], ...fields,
})

async function costsPage(tasks: object[], query = "") {
    address.query = query
    const { default: CostsClient } = await import("@/app/(dashboard)/dashboard/costs/CostsClient")
    return renderToStaticMarkup(h(CostsClient, { tasksWithCosts: tasks, total: tasks.length, page: 1, totalPages: 1, totalDue: 0 }))
}

describe("the Costs page's cards", () => {
    it("shows a cost not split by member as the task's, under its assignees' names", async () => {
        const html = await costsPage([task({})])
        expect(html).toContain("Fix the gate")
        expect(html).toContain("Ali Hassan, Mona Adel")
        expect(html).toContain("300.00")
    })

    it("names no one it doesn't know, for a task left with no assignees", async () => {
        expect(await costsPage([task({ assignees: [] })])).toContain("unknown_user")
    })

    it("leaves that card out with an employee picked: it's no one's share", async () => {
        expect(await costsPage([task({})], "employeeId=u2")).not.toContain("Fix the gate")
    })

    it("still shows a split cost as each member's, and only the picked one's in the filter", async () => {
        const split = task({ memberCosts: { u1: 100, u2: 200 }, memberPaymentStatus: { u1: "PENDING_PAYMENT", u2: "PENDING_PAYMENT" } })
        const all = await costsPage([split])
        expect(all).toContain("Ali Hassan")
        expect(all).toContain("Mona Adel")
        const picked = await costsPage([split], "employeeId=u2")
        expect(picked).toContain("Mona Adel")
        expect(picked).not.toContain("Ali Hassan")
    })

    it("shows only the shares still to pay: not one paid already, or one of nothing", async () => {
        // Mona's share paid with her picked in the filter; Ali's removed down to nothing.
        const html = await costsPage([task({ totalCost: 200, memberCosts: { u1: 0, u2: 200 }, memberPaymentStatus: { u2: "PAID" } }), task({ id: "t2", title: "Paint the lobby", totalCost: 150, memberCosts: { u1: 150 }, memberPaymentStatus: {} })])
        expect(html).not.toContain("Fix the gate")
        expect(html).toContain("Paint the lobby")
        expect(html).toContain("150.00")
    })

    it("shows what of a cost is no one's share as the task's own, beside the shares", async () => {
        // 100 EGP from before shares, then Ali's 50.
        const html = await costsPage([task({ totalCost: 150, memberCosts: { u1: 50 }, memberPaymentStatus: {} })])
        expect(html).toContain("50.00")
        expect(html).toContain("Ali Hassan, Mona Adel")
        expect(html).toContain("100.00")
        // Not with an employee picked: it's no one's share.
        expect(await costsPage([task({ totalCost: 150, memberCosts: { u1: 50 }, memberPaymentStatus: {} })], "employeeId=u1")).not.toContain("Ali Hassan, Mona Adel")
    })
})
