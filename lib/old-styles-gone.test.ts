import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { stripComments } from "./strip-comments"
import { OLD_PAGE_SHADES, brandStyleSheet } from "./brand-colour"

/**
 * The old pages' shared styles that no page used any more are gone (PR 223),
 * now that every page is on the building blocks (UI_PLAN.md §5): the old
 * buttons, cards, fields, badges and window, the glass panels, and the
 * classes that hid or showed a part by screen width. The animations only they
 * ran and the colours only they used went with them (DESIGN.md §10).
 *
 * What's left in app/globals.css is the page itself (its ground, its type,
 * the scroll bar, the focus ring, printing) and the few classes code still
 * puts on the page. This holds every class and every animation in it to a
 * use, as lib/tokens.test.ts holds every colour.
 */

const CSS = stripComments(readFileSync("app/globals.css", "utf8"))

const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : sources(join(dir, e.name)))
        : /\.(tsx?|mjs|js)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])
const CODE = ["app", "components", "lib", "context"].flatMap(sources).map(f => stripComments(readFileSync(f, "utf8")))

/** Every word in a string or template literal in the code, which is where a class is put on the page. */
const WORDS = new Set(CODE.flatMap(src =>
    [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].flatMap(m => m[0].split(/[^A-Za-z0-9_-]+/))))

/** The classes globals.css styles: the ones in its selectors (the text before each "{"), attribute values aside. */
const CLASSES = [...new Set([...CSS.matchAll(/([^{};]*)\{/g)].flatMap(m => m[1].trim().startsWith("@") ? []
    : [...m[1].replace(/\[[^\]]*\]/g, "").matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map(c => c[1])))]

const GONE = [
    // The old buttons, cards, fields and badges, and the glass panels.
    "btn", "btn-primary", "card", "glass", "glass-card", "glass-success", "glass-warning", "glass-info", "input", "badge",
    // The older pages' window, and its small turning ring.
    "modal-overlay", "modal-backdrop", "modal-content", "modal-header", "modal-title", "modal-body", "modal-footer", "modal-close",
    "spinner-small",
    // What hid or showed a part, or laid it out, by the screen's width.
    "lg-hidden", "lg-block", "md-hidden", "mobile-hidden", "mobile-block", "hide-on-mobile", "show-on-mobile", "mobile-padding",
    "mobile-gap-dense", "sm-select", "dashboard-chart-grid", "dashboard-stats-grid", "dashboard-stats-block", "responsive-sidebar-grid",
]

describe("the old pages' shared styles that nothing used any more", () => {
    it("are gone: every class app/globals.css styles is one some code puts on the page", () => {
        // So this can't pass by finding no class at all.
        expect(CLASSES.length).toBeGreaterThan(3)
        expect(CLASSES.filter(c => !WORDS.has(c))).toEqual([])
        // Named too, as a word like "card" or "input" is in the code for other reasons.
        for (const c of GONE) expect(CLASSES, c).not.toContain(c)
    })

    it("take the animations only they ran with them, and no animation is defined twice", () => {
        const defined = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1])
        expect(defined.length).toBeGreaterThan(0)
        expect(defined.length - new Set(defined).size, defined.join(" ")).toBe(0)
        // Each is named by an animation in either stylesheet, or in a style the code writes.
        const ui = stripComments(readFileSync("components/ui/ui.css", "utf8"))
        const named = [
            ...[CSS, ui].join("\n").matchAll(/animation(?:-name)?\s*:[^;}]*/g),
            ...CODE.join("\n").matchAll(/animation(?:Name)?\s*:\s*[^,}\n]*/g),
        ].map(m => m[0]).join(" ")
        expect(defined.filter(k => !new RegExp(`(^|[^\\w-])${k}([^\\w-]|$)`).test(named))).toEqual([])
        for (const gone of ["pulse", "fadeIn", "modalScaleUp"]) expect(defined, gone).not.toContain(gone)
    })

    it("take the colours only they used with them, in both themes, and a company's brand colour no longer gives them a shade", () => {
        const only = [
            "--primary-hover", "--secondary", "--accent", "--radius",
            "--glass-border", "--glass-bg", "--glass-shadow", "--glass-solid", "--glass-card-bg", "--glass-card-border",
            "--glass-card-hover", "--glass-card-border-hover", "--glass-shadow-hover",
            "--ok-bg", "--ok-fg-deep", "--ok-border", "--warn-bg", "--warn-border", "--warn-fg", "--info-bg", "--info-fg",
            "--info-border-indigo", "--brand-primary-text", "--field-border",
            "--veil-20", "--veil-50", "--panel-85", "--panel-90", "--shadow-mid", "--hairline",
        ]
        const css = readFileSync("app/globals.css", "utf8")
        const shades = OLD_PAGE_SHADES.map(s => s.token as string)
        const sheet = brandStyleSheet("#16a34a")
        for (const token of only) {
            expect(css, token).not.toMatch(new RegExp(`^\\s*${token}\\s*:`, "m"))
            expect(shades, token).not.toContain(token)
            expect(sheet, token).not.toMatch(new RegExp(`[{;]${token}:`))
        }
    })
})
