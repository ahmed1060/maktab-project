import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Tabs on phones (DESIGN.md §5.5). The Costs page's three, at 390px wide in
 * English, ran past the edge: Cash advances showed as "Cash ad", even when
 * it was the one picked, and nothing said the row scrolled. The tabs share
 * the row now, a long label on two lines. Seen in the browser in both
 * languages; this keeps the rules that do it.
 *
 * And no label more than two lines (PR 274): Exceptions' six kinds had
 * squeezed "Late / left early" four lines high, as every tab shrank to its
 * longest word. A tab is at most 8rem wide and isn't squeezed narrower, so
 * a row of more than fit scrolls instead.
 */

const css = readFileSync("components/ui/ui.css", "utf8")
const at = css.indexOf("/* On phones, the tabs share the row")
const phone = at < 0 ? "" : css.slice(at).match(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/)?.[1] ?? ""
const rule = (selector: string) => phone.match(new RegExp(`${selector.replace(/[.()]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? ""

describe("tabs on a phone", () => {
    it("share the row, a long label wrapping rather than running past the edge", () => {
        expect(rule(".ui-tab")).toContain("white-space: normal")
        expect(rule(".ui-tab")).toContain("text-align: center")
    })

    it("give no label more than two lines: at most 8rem wide, never squeezed narrower (PR 274)", () => {
        // Growing to share the row, never shrinking: as wide as its label on one line, or 8rem.
        expect(rule(".ui-tab")).toContain("flex: 1 0 auto")
        expect(rule(".ui-tab")).toContain("max-inline-size: 8rem")
        expect(rule(".ui-tab")).not.toContain("flex: 1 1 auto")
        // The two lines split evenly, not a word left alone on the second.
        expect(rule(".ui-tab")).toContain("text-wrap: balance")
    })

    it("still scroll within their row when more than fit", () => {
        const row = css.match(/\.ui-tabs,\s*\.ui-tablinks\s*\{([^}]*)\}/)?.[1] ?? ""
        expect(row).toContain("overflow-x: auto")
    })

    it("is what DESIGN.md says", () => {
        const design = readFileSync("DESIGN.md", "utf8")
        expect(design).toContain("On phones, the tabs share the row, a\n  long label on two lines, so every tab shows")
        expect(design).toContain("A tab is at most 8rem wide there and is\n  never squeezed narrower than that or its label, so no label takes more\n  than two lines")
    })
})
