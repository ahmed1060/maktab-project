import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"

/**
 * What the building blocks draw is drawn by them, not copied by hand onto a
 * page (UI_PLAN.md §5, PR 234). Three were left:
 *
 * - two buttons whose classes were typed out: the Roles card's Export, a file
 *   the browser fetches itself, and the Brand colour card's preview of a
 *   button, which is no button at all;
 * - an audit entry's phone card, whose item was a fragment in a line laid out
 *   as a row: its type, the comma and its ID each took a place of their own,
 *   and the comma fell under the type in Arabic. Every other card's detail is
 *   one piece of text;
 * - the UI kit page's inline styles, where the page's own blocks and classes
 *   do the same.
 */

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : sources(join(dir, e.name)))
        : /\.tsx$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])
const PAGES = ["app", "components"].flatMap(sources).filter(f => !f.startsWith(join("components", "ui")))
const code = (file: string) => stripComments(readFileSync(file, "utf8"))

describe("the building blocks, not copies of them", () => {
    it("draw every button: none has its classes typed out on a page", () => {
        const typed = PAGES.filter(f => /["'`]ui-btn\b|\sui-btn\b/.test(code(f)))
        expect(typed).toEqual([])
    })

    it("give a card's detail as one piece of text, so its parts wrap together", () => {
        const fragments = PAGES.filter(f => /\btext:\s*<>/.test(code(f)))
        expect(fragments).toEqual([])
    })

    it("lay out the UI kit page, with no inline styles", () => {
        expect(code("app/(dashboard)/dashboard/ui-kit/page.tsx")).not.toContain("style={{")
    })
})
