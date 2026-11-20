import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The app's frame and cards as the owner's mockup of a client's tax position
 * draws them, everywhere (the owner's answer of 2026-11-20, PR 342;
 * DESIGN.md §3.2, §4.1, §5.5): page titles at weight 600, card titles in
 * --text-card (15px) at weight 600, 20px above and below and 24px at the
 * sides inside a card on computers, and 16px between a page's sections and
 * cards. The top bar's half is in lib/top-bar.test.ts.
 */

const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
const globals = stripComments(readFileSync("app/globals.css", "utf8"))
const rule = (selector: string, from = css) => {
    const at = from.indexOf(`\n${selector} {`)
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1)
    return from.slice(at, from.indexOf("}", at))
}
// The phones' block of the building blocks (below 768px), where the page's
// own spacing steps down.
const phones = (() => {
    const blocks = css.split("@media (max-width: 767px) {").slice(1)
    return blocks.map(b => b.slice(0, b.search(/\n}\n/))).join("\n")
})()

describe("the scale has what the mockup draws", () => {
    it("has --text-card, 15px on a 22px line, and a 20px step", () => {
        expect(globals).toMatch(/--text-card: 15px;/)
        expect(globals).toMatch(/--leading-card: 22px;/)
        expect(globals).toMatch(/--space-5: 20px;/)
    })

    it("keeps a card's inside in two tokens, 20px and 24px, and 16px on phones", () => {
        expect(globals).toMatch(/--card-pad-block: var\(--space-5\);/)
        expect(globals).toMatch(/--card-pad-inline: var\(--space-6\);/)
        // Every phone block of globals.css: the card's is its own, after the
        // large figure's.
        const block = globals.split("@media (max-width: 767px) {").slice(1).map(b => b.slice(0, b.indexOf("\n}\n"))).join("\n")
        expect(block).toMatch(/--card-pad-block: var\(--space-4\);/)
        expect(block).toMatch(/--card-pad-inline: var\(--space-4\);/)
    })
})

describe("a page", () => {
    it("titles itself at weight 600", () => {
        expect(rule(".ui-page-title")).toContain("font-weight: 600;")
    })

    it("keeps its sections and cards 16px apart on computers too, side by side and in a tab", () => {
        expect(rule(".ui-page")).toContain("gap: var(--space-4);")
        expect(rule(".ui-columns")).toContain("gap: var(--space-4);")
        expect(rule(".ui-tab-panel")).toContain("gap: var(--space-4);")
    })

    it("has no phone rule left to step the gap down to what it is already", () => {
        expect(phones).not.toMatch(/\.ui-page,\s*\.ui-columns \{/)
    })
})

describe("a card", () => {
    it("is 20px inside above and below and 24px at the sides, by its tokens", () => {
        expect(rule(".ui-card")).toContain("padding: var(--card-pad-block) var(--card-pad-inline);")
    })

    it("titles itself in --text-card at weight 600", () => {
        const title = rule(".ui-card-title")
        expect(title).toContain("font-size: var(--text-card);")
        expect(title).toContain("line-height: var(--leading-card);")
        expect(title).toContain("font-weight: 600;")
    })

    it("still runs its edge-to-edge rows to its edges, and their words in line with its title", () => {
        expect(rule(".ui-card > .ui-rows-flush")).toContain("margin: 0 calc(-1 * var(--card-pad-inline)) calc(-1 * var(--card-pad-block));")
        expect(rule(".ui-card > .ui-subsection > .ui-rows-flush")).toContain("margin-inline: calc(-1 * var(--card-pad-inline));")
        expect(rule(".ui-card > .ui-subsection:last-child > .ui-rows-flush")).toContain("margin-block-end: calc(-1 * var(--card-pad-block));")
        const rows = css.slice(css.indexOf(".ui-card > .ui-rows-flush > li > .ui-row,"))
        expect(rows.slice(0, rows.indexOf("}"))).toContain("padding-inline: var(--card-pad-inline);")
    })

    // Found in the interface audit: a titled part's 16px heading outsized
    // the card's 15px title. Inside a card it's 14px at 600; in a dialog
    // it stays as it was.
    it("heads a titled part inside it under its own title", () => {
        const part = rule(".ui-card .ui-subsection-title")
        expect(part).toContain("font-size: var(--text-md);")
        expect(part).toContain("line-height: var(--leading-md);")
        expect(part).toContain("font-weight: 600;")
        expect(rule(".ui-subsection-title")).toContain("font-size: var(--text-lg);")
    })

    it("has no rule left that reaches past a card's old 16px", () => {
        const cards = css.split("\n").filter(line => /^\.ui-card[ >.:,]/.test(line))
        for (const selector of cards) {
            const body = css.slice(css.indexOf(selector), css.indexOf("}", css.indexOf(selector)))
            expect(body, selector).not.toContain("calc(-1 * var(--space-4))")
        }
    })
})
