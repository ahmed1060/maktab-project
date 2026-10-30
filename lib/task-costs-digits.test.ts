import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * A task's costs show their amounts in the page's language, as every other
 * amount does: Arabic digits in Arabic, and grouped thousands in both. They
 * were written with toFixed, so Latin digits in either language.
 */

const language = { locale: "en" }
// The note under a total that's partly from an advance says what the costs came to.
const t = (key: string) => (key === "advances_cost_split" ? "Of {total}, {advance} came from cash advances." : key)
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: language.locale, t }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Costs" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: () => true }) }))

const ali = { id: "u1", firstName: "Ali", lastName: "Hassan" }
const mona = { id: "u2", firstName: "Mona", lastName: "Adel" }
const cost = (id: string, amount: number, authorId: string, fromAdvance = 0) => ({
    id, amount, description: `Cost ${id}`, authorId, authorName: authorId, receiptUrl: null, fromAdvance, createdAt: `2026-10-20T09:0${id.length}:00Z`,
})
// Ali's 1,500.50, of which 300 from his advance, and Mona's 250.
const task = {
    id: "t1", status: "APPROVED", paymentStatus: "PENDING_PAYMENT", assignees: [ali, mona], comments: [],
    costs: [cost("c1", 1500.5, "u1", 300), cost("c22", 250, "u2")],
    totalCost: 1450.5, memberCosts: { u1: 1200.5, u2: 250 }, memberPaymentStatus: {},
}

async function costsSection(locale: string) {
    language.locale = locale
    const { default: TaskCostsSection } = await import("@/components/TaskCostsSection")
    return renderToStaticMarkup(h(TaskCostsSection, {
        task, userId: "u1", onDeleteItem: () => {}, onPaymentStatusChange: () => {},
        getMemberCosts: (x: any) => x.memberCosts, getMemberPaymentStatus: (x: any) => x.memberPaymentStatus,
    }))
}

describe("a task's costs", () => {
    it("shows every amount in Arabic digits in Arabic", async () => {
        const html = await costsSection("ar")
        // Each cost, its advance part and what's to pay back, the shares, the total.
        for (const amount of ["١٬٥٠٠٫٥٠", "٢٥٠٫٠٠", "٣٠٠٫٠٠", "١٬٢٠٠٫٥٠", "١٬٤٥٠٫٥٠", "١٬٧٥٠٫٥٠"]) expect(html).toContain(amount)
        // No amount in Latin digits, its styles' sizes aside.
        expect(html.replace(/style="[^"]*"/g, "")).not.toMatch(/\d\.\d\d/)
    })

    it("groups thousands in English", async () => {
        const html = await costsSection("en")
        for (const amount of ["1,500.50", "250.00", "300.00", "1,200.50", "1,450.50", "1,750.50"]) expect(html).toContain(amount)
        expect(html).not.toContain("1500.50")
    })
})
