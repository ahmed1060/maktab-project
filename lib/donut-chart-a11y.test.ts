import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The dashboard's donut chart is hidden from screen readers, which read its
 * legend instead: every value is listed there (accessibility audit,
 * 4 October 2026, L3). Before, the chart was an unnamed image.
 */
describe("donut chart", () => {
    const src = readFileSync("components/DashboardCharts.tsx", "utf8")

    it("hides the picture", () => {
        expect(src).toMatch(/<svg aria-hidden="true" focusable="false" viewBox="0 0 100 100"/)
    })

    it("keeps every value in the legend", () => {
        expect(src).toContain("{item.label}: <strong>{item.value}</strong>")
    })
})
