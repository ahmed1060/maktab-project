import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * A row's end side under its title where the two don't fit side by side
 * (DESIGN.md §5.5, Rows; UI_PLAN.md, 2026-11-26; PR 423). Found in #422's
 * interface audit: on a phone, a planned move and its Withdraw button, at the
 * end of a row in Who works which schedule, took 60% of it, and the title and
 * detail, which break anywhere, broke "Office" mid-word in what was left.
 *
 * The title and detail keep at least 128px, and the end side goes on its own
 * line under them, at the start, only where it doesn't fit beside that: a
 * long title beside a short status still wraps beside it, as before.
 *
 * Read from the styles here; the browser flow checks where each lands.
 */

const css = readFileSync("components/ui/ui.css", "utf8")
const design = readFileSync("DESIGN.md", "utf8")

/** Each match of a global pattern, by its first group, without matchAll (ES2017). */
function each(pattern: RegExp, text: string): string[] {
    const found: string[] = []
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) found.push(m[1])
    return found
}

/** The declarations of the one rule with this selector, outside any media query or inside the phone's. */
function rule(selector: string, phone = false): string {
    const scope = phone
        ? each(/@media \(max-width: 767px\) \{([\s\S]*?)\n\}/g, css).join("\n")
        : css.replace(/@media[^{]*\{[\s\S]*?\n\}/g, "")
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, "\\$&")
    const found = each(new RegExp(`(?:^|\\n)\\s*${escaped} \\{([^}]*)\\}`, "g"), scope)
    expect(found, `${selector}${phone ? " on a phone" : ""}`).toHaveLength(1)
    return found[0]
}

describe("a row", () => {
    it("puts its end side on a line of its own where it doesn't fit beside the title", () => {
        expect(rule(".ui-row")).toMatch(/flex-wrap: wrap;/)
    })

    it("lets its title and detail take the room left, keeping at least 128px", () => {
        // With no width of their own, the line breaks only where 128px and the
        // end side don't fit together, so a long title still wraps beside a
        // short status. On a row narrower than 128px, they take the row.
        const main = rule(".ui-row-main")
        expect(main).toMatch(/flex: 1 1 0;/)
        expect(main).toMatch(/min-width: min\(128px, 100%\);/)
    })

    it("lets its end side shrink to the row on a line of its own, and keeps it to 60% on computers", () => {
        const end = rule(".ui-row-end")
        expect(end).toMatch(/flex: 0 1 auto;/)
        expect(end).toMatch(/min-width: 0;/)
        expect(end).toMatch(/max-width: 60%;/)
        expect(end).not.toMatch(/flex: none;/)
    })

    it("lets its end side be as wide as the row on a phone, its parts from the start", () => {
        const end = rule(".ui-row-end", true)
        expect(end).toMatch(/max-width: none;/)
        expect(end).toMatch(/justify-content: flex-start;/)
    })

    it("uses logical properties only: no side or edge named by its direction", () => {
        for (const block of [rule(".ui-row"), rule(".ui-row-main"), rule(".ui-row-end"), rule(".ui-row-end", true)]) {
            expect(block).not.toMatch(/(^|[\s;])(left|right|top|bottom)\s*:|-(left|right|top|bottom)\s*:/)
        }
    })

    it("is written down in DESIGN.md", () => {
        const rows = design.slice(design.indexOf("- **Rows:**"), design.indexOf("- **Row menu:**")).replace(/\s+/g, " ")
        expect(rows).toContain("keep at least 128px beside the end side")
        expect(rows).toContain("it goes on its own line under them, at the start")
    })
})
