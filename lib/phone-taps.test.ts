import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Two things too small for a phone, found while #320 was built (UI_PLAN.md,
 * the small fixes after the client portal's step 6a; DESIGN.md §5.2, §5.6,
 * §9):
 *
 * - a section's heading kept its action beside its title whatever the width,
 *   so on a 360px phone in English, Upload from the tax portal reached past
 *   the page's edge;
 * - a link in a line of text was as tall as its words under a finger. Only
 *   How to get the portal's file was 44px, by a rule of its own.
 *
 * Read from the styles here; the browser flow checks where each lands.
 */

const css = readFileSync("components/ui/ui.css", "utf8")
const design = readFileSync("DESIGN.md", "utf8")

/** The declarations of the one rule with this selector, outside any media query or inside the phone's. */
function rule(selector: string, phone = false): string {
    const phoneBlocks = [...css.matchAll(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/g)].map(m => m[1])
    const scope = phone ? phoneBlocks.join("\n") : css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "")
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&")
    const found = [...scope.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, "g"))].map(m => m[1])
    expect(found, `${selector}${phone ? " on a phone" : ""}`).toHaveLength(1)
    return found[0]
}

describe("a section's heading", () => {
    it("puts its action under the title where the two don't fit side by side", () => {
        expect(rule(".ui-section-head")).toMatch(/flex-wrap: wrap;/)
    })

    it("lets its title take the room left, so the action goes under it only where the title's longest word and the action don't fit", () => {
        // A title's own size is its longest word: with no width of its own, the
        // line breaks only where that and the action don't fit together, and a
        // long title still wraps beside a short action, as it did.
        expect(rule(".ui-section-title")).toMatch(/flex: 1 1 0;/)
    })

    it("is written down in DESIGN.md", () => {
        const section = design.slice(design.indexOf("- **Section:**"), design.indexOf("- **Rows:**")).replace(/\s+/g, " ")
        expect(section).toContain("on its own line under the heading")
    })
})

describe("a link in a line of text, on a phone", () => {
    it("is 44px under a finger, laid over its line so no line around it moves", () => {
        expect(rule(".ui-text-link", true)).toMatch(/position: relative;/)
        const tap = rule(".ui-text-link::after", true)
        expect(tap).toMatch(/content: "";/)
        expect(tap).toMatch(/position: absolute;/)
        expect(tap).toMatch(/inset-inline: 0;/)
        expect(tap).toMatch(/inset-block: calc\(50% - 22px\);/)
    })

    it("keeps How to get the portal's file a little low, clear of the upload's button over it", () => {
        // What #320 gave it, now on top of what every text link has.
        // Named with .ui-text-link, so it holds over that rule, which comes later in the file.
        expect(rule(".ui-text-link.ui-tax-how::after", true)).toMatch(/inset-block: calc\(50% - 20px\) calc\(50% - 24px\);/)
        expect(rule(".ui-text-link.ui-tax-how", true)).toMatch(/z-index: 1;/)
        expect(rule(".ui-text-link.ui-tax-how", true)).not.toMatch(/position:/)
        expect(rule(".ui-text-link.ui-tax-how::after", true)).not.toMatch(/content:|position:/)
        expect(css.indexOf(".ui-text-link.ui-tax-how::after")).toBeLessThan(css.indexOf(".ui-text-link::after"))
    })

    it("uses logical properties only: no side or edge named by its direction", () => {
        for (const block of [rule(".ui-text-link", true), rule(".ui-text-link::after", true), rule(".ui-section-head"), rule(".ui-section-title")]) {
            expect(block).not.toMatch(/(^|[\s;])(left|right|top|bottom)\s*:|-(left|right|top|bottom)\s*:/)
        }
    })

    it("is written down in DESIGN.md", () => {
        const link = design.slice(design.indexOf("- **A link in a line of text,**"), design.indexOf("- **Busy and disabled states**")).replace(/\s+/g, " ")
        expect(link).toContain("44px under a finger")
    })
})

describe("a button inside a field, on a phone", () => {
    // Found while PR 324's invitation page was built: a password's Show was
    // 40px square inside a 44px field. With no ground of its own, it takes
    // the field's whole height at its end, and looks as it did.
    it("is 44px square, the field's height, at the field's end", () => {
        expect(rule(".ui-input,\n  .ui-select", true)).toMatch(/height: 44px;/)
        const button = rule(".ui-control-button", true)
        expect(button).toMatch(/width: 44px;/)
        expect(button).toMatch(/height: 44px;/)
        expect(button).toMatch(/inset-inline-end: 0;/)
        expect(rule(".ui-control-button")).toMatch(/background: none;/)
    })

    it("leaves the field's words clear of it", () => {
        expect(rule(".ui-control.has-end-button > .ui-input", true)).toMatch(/padding-inline-end: 48px;/)
    })
})
