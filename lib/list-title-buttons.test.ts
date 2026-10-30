import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * A task's or obligation's title in a list opens its quick view, and is a
 * button, so the keyboard reaches it (accessibility audit, 4 October 2026,
 * L1). Before, the heading itself took the click, which only a mouse could do.
 */
describe.each(["components/ObligationListItem.tsx"])("%s", f => {
    const src = readFileSync(f, "utf8")

    it("opens the quick view from a button in the heading", () => {
        expect(src).toMatch(/<h3[^>]*>\s*<button type="button" className="title-button"[^>]*onClick=\{\(\) => setIsModalOpen\(true\)\}/)
    })

    it("no longer puts the click on the heading", () => {
        expect(src).not.toMatch(/<h3[^>]*\n?[^>]*onClick=/)
    })
})

describe("the title button", () => {
    it("looks like the heading it sits in", () => {
        const css = readFileSync("app/globals.css", "utf8")
        const rule = css.slice(css.indexOf(".title-button {"), css.indexOf("}", css.indexOf(".title-button {")))
        for (const decl of ["background: none", "border: none", "font: inherit", "color: inherit", "text-align: start"]) expect(rule).toContain(decl)
    })
})
