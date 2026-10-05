import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Something you click has the size its classes give it, so every class on a
 * clickable element must exist in globals.css. The project has no Tailwind,
 * but nine dialog backdrops were written as Tailwind's "absolute inset-0":
 * with no CSS behind them they had no size, and clicking outside the Vendors,
 * Clients, client-note and backup dialogs, and every ConfirmModal, did
 * nothing (accessibility audit, 4 October 2026).
 */
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [])
const SCREENS = [...files("app"), ...files("components")]
const DEFINED = new Set([...readFileSync("app/globals.css", "utf8").matchAll(/\.([A-Za-z_][\w-]*)/g)].map(m => m[1]))

/**
 * Button colour variants with no CSS of their own: the button still has its
 * size and shape from .btn, so it works, only without the variant's colour.
 * Known, and left to the visual work rather than this check.
 */
const COSMETIC = new Set(["btn-secondary", "btn-danger", "btn-link"])

describe("clickable elements", () => {
    it("use only classes that globals.css defines", () => {
        const missing: string[] = []
        for (const f of SCREENS) {
            const s = readFileSync(f, "utf8")
            for (const m of s.matchAll(/<\w+\b[^<>]*?className="([^"]+)"[^<>]*?onClick/g)) {
                for (const c of m[1].split(/\s+/)) {
                    if (c && !DEFINED.has(c) && !COSMETIC.has(c)) missing.push(`${f}:${s.slice(0, m.index).split("\n").length} ${c}`)
                }
            }
        }
        expect(missing).toEqual([])
    })

    it("dialog backdrops fill the overlay", () => {
        const css = readFileSync("app/globals.css", "utf8")
        const rule = css.match(/\.modal-backdrop\s*\{([^}]*)\}/)?.[1] ?? ""
        expect(rule).toMatch(/position:\s*absolute/)
        expect(rule).toMatch(/inset:\s*0/)
    })
})
