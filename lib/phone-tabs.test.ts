import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Tabs on phones (DESIGN.md §5.5). The Costs page's three, at 390px wide in
 * English, ran past the edge: Cash advances showed as "Cash ad", even when
 * it was the one picked, and nothing said the row scrolled. The tabs share
 * the row now, a long label on two lines. Seen in the browser in both
 * languages; this keeps the rules that do it.
 */

const css = readFileSync("components/ui/ui.css", "utf8")
const at = css.indexOf("/* On phones, the tabs share the row")
const phone = at < 0 ? "" : css.slice(at).match(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/)?.[1] ?? ""
const rule = (selector: string) => phone.match(new RegExp(`${selector.replace(/[.()]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? ""

describe("tabs on a phone", () => {
    it("share the row, a long label wrapping rather than running past the edge", () => {
        expect(rule(".ui-tab")).toContain("flex: 1 1 auto")
        expect(rule(".ui-tab")).toContain("white-space: normal")
        expect(rule(".ui-tab")).toContain("text-align: center")
    })

    it("still scroll within their row when more than fit", () => {
        const row = css.match(/\.ui-tabs,\s*\.ui-tablinks\s*\{([^}]*)\}/)?.[1] ?? ""
        expect(row).toContain("overflow-x: auto")
    })

    it("is what DESIGN.md says", () => {
        expect(readFileSync("DESIGN.md", "utf8")).toContain("On phones, the tabs share the row, a\n  long label on two lines, so every tab shows")
    })
})
