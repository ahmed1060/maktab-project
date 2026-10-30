import { describe, it, expect } from "vitest"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The Costs page's subtitle shows on all three of its tabs (CostsHeader),
 * and none of them has salaries: employee costs, what's charged to clients,
 * and cash advances. It said "expenses, salaries, and financial logs".
 */
describe("the Costs page's subtitle", () => {
    it("says what the page has, without salaries", () => {
        expect(en.costs_subtitle).toBe("Monitor company expenses and financial logs")
        expect(en.costs_subtitle.toLowerCase()).not.toContain("salar")
        expect(ar.costs_subtitle).toBe("مراقبة مصاريف الشركة والسجلات المالية")
        expect(ar.costs_subtitle).not.toContain("رواتب")
    })
})
