import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { scrollToShow } from "@/components/ui/Tabs"

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
 * a row of more than fit scrolls instead. Such a row opens on the picked
 * tab: attendance opened on Employee numbers had shown its first tabs and
 * not that one. The suite has no browser, so the sum is a pure function and
 * the hook's source is checked to use it so.
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

    it("open on the picked tab when it's past the row's edge, scrolling just enough (PR 274)", () => {
        const row = { left: 16, right: 344 }
        // Whole already, at an edge or inside: nothing.
        expect(scrollToShow(row, { left: 100, right: 200 })).toBe(0)
        expect(scrollToShow(row, { left: 16, right: 120 })).toBe(0)
        expect(scrollToShow(row, { left: 240, right: 344 })).toBe(0)
        // Past the right edge, as a last tab in English: rightwards by what's hidden.
        expect(scrollToShow(row, { left: 400, right: 500 })).toBe(156)
        // Past the left edge, as a last tab in Arabic: leftwards.
        expect(scrollToShow(row, { left: -150, right: -50 })).toBe(-166)
        // Cut by an edge: just enough to show it whole.
        expect(scrollToShow(row, { left: 300, right: 380 })).toBe(36)
        expect(scrollToShow(row, { left: 0, right: 90 })).toBe(-16)
    })

    it("scroll the row alone, never the page, for both kinds of tab row, again as the pick changes", () => {
        const src = readFileSync("components/ui/Tabs.tsx", "utf8")
        const hook = src.match(/function usePickedInView[\s\S]*?\n\}\n/)?.[0] ?? ""
        expect(hook).toContain(`'[aria-selected="true"], [aria-current="page"]'`)
        // Only a row that scrolls, and only by what scrollToShow says.
        expect(hook).toContain("el.scrollWidth <= el.clientWidth) return")
        expect(hook).toContain("scrollToShow(el.getBoundingClientRect(), tab.getBoundingClientRect())")
        expect(hook).toContain("el.scrollBy({ left: by, behavior: 'instant' })")
        expect(hook).toContain("}, [row, picked])")
        // scrollIntoView can move the page as well as the row.
        expect(src).not.toContain("scrollIntoView")
        expect(src).toContain("usePickedInView(list, value)")
        expect(src).toContain("usePickedInView(row, items.find(item => item.current)?.href)")
        expect(src).toContain('<nav ref={row} aria-label={label} className="ui-tablinks">')
    })

    it("is what DESIGN.md says", () => {
        const design = readFileSync("DESIGN.md", "utf8")
        expect(design).toContain("On phones, the tabs share the row, a\n  long label on two lines, so every tab shows")
        expect(design).toContain("A tab is at most 8rem wide there and is\n  never squeezed narrower than that or its label, so no label takes more\n  than two lines")
        expect(design).toContain("Opened on a tab past the\n  row's edge, by a link or a reload, the row scrolls to show it, and the\n  page doesn't move.")
    })
})
