import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * The signature stays out of the way of the navigation.
 *
 * "POWERED BY SHSD" used to be `position: fixed` at z-index 100 in every
 * viewport. The mobile sidebar is 50 and its scrim is 49, so opening the drawer
 * on a phone painted the signature straight across the menu behind it — the
 * one element on the screen that is pure decoration was the one element
 * painting over navigation.
 *
 * Two rules keep that from coming back. On a phone the attribution sits in the
 * page rather than floating, because a phone has no spare corner to float
 * anything in. Everywhere else it still floats, but below every other layer in
 * the shell, so a sidebar, a scrim, a sticky header or a dialog always wins.
 *
 * Which of the two applies is CSS (.floating-attribution in globals.css), so
 * the first paint on a phone is already right rather than the desktop one.
 */

const SHELL = "components/DashboardShell.tsx"
const lines = readFileSync(SHELL, "utf8").split("\n")
const CSS = readFileSync("app/globals.css", "utf8")
const floating = CSS.match(/\n\.floating-attribution \{([^}]*)\}/)?.[1] ?? ""
const phone = CSS.match(/@media \(max-width: 1023px\) \{[\s\S]*?\.floating-attribution \{([^}]*)\}/)?.[1] ?? ""

const start = lines.findIndex(l => l.includes("{showPoweredBy && ("))
const end = lines.findIndex(l => l.includes('className="floating-attribution"'))

function zIndexesIn(source: string[]): number[] {
    return source.flatMap(l => [...l.matchAll(/zIndex:\s*(\d+)/g)].map(m => Number(m[1])))
}

describe("the attribution never covers the navigation", () => {
    it("finds the attribution block at all", () => {
        // Renaming either marker would otherwise make every assertion below
        // pass against an empty slice.
        expect(start, `no "{showPoweredBy && (" in ${SHELL}`).toBeGreaterThan(-1)
        expect(end, `no floating-attribution class in ${SHELL}`).toBeGreaterThan(start)
    })

    const block = lines.slice(start + 1, end + 1)
    const blockText = block.join("\n")

    it("puts the attribution in the page on a phone", () => {
        expect(blockText).toMatch(/className="floating-attribution"/)
        expect(phone, "the phone rule must not float").toMatch(/position:\s*static/)
        expect(floating).toMatch(/position:\s*fixed/)
    })

    it("floats it below every other layer in the shell", () => {
        const mine = [...floating.matchAll(/z-index:\s*(\d+)/g)].map(m => Number(m[1]))
        expect(zIndexesIn(block), "the layer is set in CSS, not inline").toEqual([])
        const others = zIndexesIn([...lines.slice(0, start), ...lines.slice(end + 1)])

        expect(mine, "the floating branch declares exactly one z-index").toHaveLength(1)
        // Vacuous otherwise: if the shell stopped declaring layers, any value
        // here would clear the bar below.
        expect(others.length, "the shell's other layers").toBeGreaterThanOrEqual(3)

        expect(
            mine[0],
            `attribution at z-index ${mine[0]}, shell layers at ${others.join(", ")}`,
        ).toBeLessThan(Math.min(...others))
    })
})
