import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Something you click has the size its classes give it, so every class on a
 * clickable element must exist in a stylesheet. The project has no Tailwind,
 * but nine dialog backdrops were written as Tailwind's "absolute inset-0":
 * with no CSS behind them they had no size, and clicking outside the Clients,
 * Clients, client-note and backup dialogs, and every ConfirmModal, did
 * nothing (accessibility audit, 4 October 2026).
 */
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
const SCREENS = [...files("app"), ...files("components")]
// globals.css, and the building blocks' stylesheet that the root layout loads beside it.
const DEFINED = new Set(["app/globals.css", "components/ui/ui.css"]
    .flatMap(f => [...readFileSync(f, "utf8").matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1])))

describe("clickable elements", () => {
    it("use only classes that a stylesheet defines", () => {
        // None is exempt: the old buttons' colour variants, which had no CSS
        // of their own, went with the old buttons (PR 223).
        const missing: string[] = []
        for (const f of SCREENS) {
            const s = readFileSync(f, "utf8")
            for (const m of s.matchAll(/<\w+\b[^<>]*?className="([^"]+)"[^<>]*?onClick/g)) {
                for (const c of m[1].split(/\s+/)) {
                    if (c && !DEFINED.has(c)) missing.push(`${f}:${s.slice(0, m.index).split("\n").length} ${c}`)
                }
            }
        }
        expect(missing).toEqual([])
    })

    it("a dialog's backdrop fills the screen", () => {
        // The old dialogs' click-outside area went with them (PR 223); the
        // building blocks' dialog is drawn on its backdrop.
        const css = readFileSync("components/ui/ui.css", "utf8")
        const rule = css.match(/\.ui-dialog-backdrop\s*\{([^}]*)\}/)?.[1] ?? ""
        expect(rule).toMatch(/position:\s*fixed/)
        expect(rule).toMatch(/inset:\s*0/)
    })
})
