import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Total tiles on phones (DESIGN.md §5.5): two to a row, each half of it, put
 * an amount's currency on a line of its own, "6,355.50" above "EGP". A value
 * is kept whole now, and a tile whose value needs more than half takes the
 * row. Seen in the browser at 390px wide, in both languages; this keeps the
 * rules that do it.
 */

const css = readFileSync("components/ui/ui.css", "utf8")
/** The phone rules that follow the tiles' own. */
const phone = css.slice(css.indexOf("/* ── Total tiles (§5.5) ── */")).match(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/)?.[1] ?? ""
const rule = (selector: string) => phone.match(new RegExp(`${selector.replace(/[.()]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? ""

describe("total tiles on a phone", () => {
    it("wrap a tile onto a row of its own rather than break its value", () => {
        expect(rule(".ui-tiles")).toContain("flex-wrap: wrap")
        // Half the row each, but never narrower than the value.
        expect(rule(".ui-tile")).toContain("flex: 1 1 calc(50% - var(--space-3) / 2)")
        expect(rule(".ui-tile")).toContain("min-width: min-content")
        expect(rule(".ui-tiles dd:not(.ui-tile-note)")).toContain("white-space: nowrap")
    })

    it("leaves labels and notes free to wrap", () => {
        expect(phone).not.toMatch(/\.ui-tiles dt[^{]*\{[^}]*nowrap/)
        expect(phone).not.toMatch(/\.ui-tile-note\s*\{[^}]*nowrap/)
    })

    it("is what DESIGN.md says", () => {
        expect(readFileSync("DESIGN.md", "utf8")).toContain("up to 4 in a row on computers, 2 on phones while their values fit\n    half the row. A value is never broken")
    })
})
