import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Motion (DESIGN.md §8), with Emil Design Engineering (UI_PLAN.md §7.1;
 * PR 224).
 *
 * Menus, panels, dialogs and the calendar appeared at once, in full. The side
 * bar and the toasts moved on the browser's own ease-out, and the side bar
 * went as slowly as it came. The page beside the side bar went dim at once.
 *
 * Now a menu or a panel fades in as it grows from 96%, from the corner
 * nearest its button, in 150ms. A dialog fades in with the dimmed page and
 * grows from its middle, in 200ms, and so does the calendar on a phone. What
 * comes in starts fast and settles; going is at once, but for the side bar.
 * With "reduce motion", all of it is at once.
 */

const UI = stripComments(readFileSync("components/ui/ui.css", "utf8"))
const GLOBALS = stripComments(readFileSync("app/globals.css", "utf8"))
const DOC = readFileSync("DESIGN.md", "utf8").replace(/\s+/g, " ")
const MENU = stripComments(readFileSync("components/ui/Menu.tsx", "utf8"))
const CALENDAR = stripComments(readFileSync("components/ui/Calendar.tsx", "utf8"))

type Rule = { at: number; media: string | null; selectors: string[]; body: string }

/** Every style rule of a stylesheet, in order, with the @media it's in, if any. Keyframes aren't rules here. */
function rules(css: string, media: string | null = null, offset = 0, out: Rule[] = []): Rule[] {
    let at = 0
    for (;;) {
        const open = css.indexOf("{", at)
        if (open < 0) return out
        const head = css.slice(at, open).trim()
        let depth = 1
        let end = open + 1
        for (; depth > 0 && end < css.length; end++) {
            if (css[end] === "{") depth++
            else if (css[end] === "}") depth--
        }
        const inner = css.slice(open + 1, end - 1)
        if (head.startsWith("@media")) rules(inner, head.slice("@media".length).trim(), offset + open + 1, out)
        else if (!head.startsWith("@")) out.push({ at: offset + at, media, selectors: head.split(",").map(s => s.trim()), body: inner })
        at = end
    }
}
const RULES = rules(UI)

const PHONE = "(max-width: 767px)"
const NARROW = "(max-width: 1023px)"
const REDUCE = "(prefers-reduced-motion: reduce)"

/**
 * What a property comes to for one selector, as the cascade has it between
 * rules of the same selector: the last one that sets it, among the rules
 * outside any @media and in the @media given.
 */
function final(selector: string, property: string, ...media: string[]): string | undefined {
    const sets = RULES.filter(r => r.selectors.includes(selector) && (r.media === null || media.includes(r.media)))
        .map(r => r.body.match(new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+);`))?.[1].trim())
        .filter((v): v is string => v !== undefined)
    return sets.at(-1)
}

/** A keyframes block's body, its spacing as one space. */
function keyframes(name: string): string {
    const at = UI.indexOf(`@keyframes ${name} {`)
    expect(at, name).toBeGreaterThan(-1)
    const close = UI.indexOf("\n}", at)
    return UI.slice(UI.indexOf("{", at) + 1, close).replace(/\s+/g, " ").trim()
}

/** What opens from a button, as DESIGN.md §8 lists them. */
const POP_UPS = [".ui-menu", ".ui-account-menu", ".ui-notices", ".ui-company-picker-panel", ".ui-calendar"]

describe("the curves", () => {
    it("are tokens, once, the same in both themes, with the values DESIGN.md gives them", () => {
        const tokens = GLOBALS.slice(GLOBALS.indexOf("--page: #f6f9fc;"))
        const light = tokens.slice(0, tokens.indexOf("\n}"))
        expect(light).toContain("--ease-out: cubic-bezier(0.23, 1, 0.32, 1);")
        expect(light).toContain("--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);")
        for (const token of ["--ease-out", "--ease-drawer"]) expect(GLOBALS.match(new RegExp(`${token}\\s*:`, "g")), token).toHaveLength(1)
        expect(DOC).toContain("on `--ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`)")
        expect(DOC).toContain("on `--ease-drawer` (`cubic-bezier(0.32, 0.72, 0, 1)`)")
    })

    it("never ease in, never move everything, and never grow from nothing", () => {
        for (const [name, css] of [["ui.css", UI], ["globals.css", GLOBALS]]) {
            expect(css, name).not.toMatch(/\bease-in\b(?!-out)/)
            expect(css, name).not.toMatch(/transition(-property)?\s*:\s*all\b/)
            expect(css, name).not.toMatch(/scale\(0\)/)
        }
    })
})

describe("a menu or a panel opened from its button", () => {
    it("fades in as it grows from 96%, in 150ms", () => {
        expect(keyframes("ui-pop-in")).toBe("from { opacity: 0; transform: scale(0.96); }")
        for (const selector of POP_UPS) expect([selector, final(selector, "animation")]).toEqual([selector, "ui-pop-in 150ms var(--ease-out)"])
        expect(DOC).toContain("150ms for a menu or a panel opening")
    })

    it("grows from the corner nearest its button: under the top bar, its button's side", () => {
        // The account menu and the bell's panel line up with their buttons'
        // end edge; the company picker with its start edge. In Arabic the
        // end edge is the left one.
        expect(final(".ui-account-menu", "transform-origin")).toBe("top right")
        expect(final('[dir="rtl"] .ui-account-menu', "transform-origin")).toBe("top left")
        expect(final(".ui-notices", "transform-origin")).toBe("top right")
        expect(final('[dir="rtl"] .ui-notices', "transform-origin")).toBe("top left")
        expect(final(".ui-company-picker-panel", "transform-origin")).toBe("top left")
        expect(final('[dir="rtl"] .ui-company-picker-panel', "transform-origin")).toBe("top right")
        // As the side bar's narrow screen spreads them across the bar, and
        // nothing there moves them.
        for (const selector of [".ui-account-menu", ".ui-notices", ".ui-company-picker-panel"]) {
            expect(final(selector, "transform-origin", NARROW, PHONE), selector).toBe(final(selector, "transform-origin"))
        }
    })

    it("grows from the corner nearest its button: a row's menu and a date field's calendar, which their code places", () => {
        // The row menu lines up with its button's end edge, under it or above it.
        expect(MENU).toContain("import { growsFrom } from '@/lib/grows-from'")
        expect(MENU).toContain("transformOrigin: growsFrom('end', below, rtl),")
        expect(final(".ui-menu", "transform-origin")).toBeUndefined()
        // The calendar lines up with its field's start edge, under it or
        // above it, and says so as --calendar-origin, which only a computer's
        // CSS reads.
        expect(CALENDAR).toContain("import { growsFrom } from '@/lib/grows-from'")
        expect(CALENDAR).toContain("panel.style.setProperty('--calendar-origin', growsFrom('start', spot.top !== undefined, rtl))")
        expect(final(".ui-calendar", "transform-origin")).toBe("var(--calendar-origin, center)")
    })

    it("knows the corner from the edge it lines up with, whether it's under its button, and the page's direction", async () => {
        const { growsFrom } = await import("./grows-from")
        expect(growsFrom("start", true, false)).toBe("top left")
        expect(growsFrom("start", false, false)).toBe("bottom left")
        expect(growsFrom("end", true, false)).toBe("top right")
        expect(growsFrom("end", false, false)).toBe("bottom right")
        expect(growsFrom("start", true, true)).toBe("top right")
        expect(growsFrom("start", false, true)).toBe("bottom right")
        expect(growsFrom("end", true, true)).toBe("top left")
        expect(growsFrom("end", false, true)).toBe("bottom left")
    })
})

describe("a dialog", () => {
    it("fades in with the dimmed page, and grows from 96% from its middle, in 200ms", () => {
        expect(keyframes("ui-fade-in")).toBe("from { opacity: 0; }")
        expect(keyframes("ui-grow-in")).toBe("from { transform: scale(0.96); }")
        expect(final(".ui-dialog-backdrop", "animation")).toBe("ui-fade-in 200ms var(--ease-out)")
        // The dimmed page fades it in: faded twice, it would come in late.
        expect(final(".ui-dialog", "animation")).toBe("ui-grow-in 200ms var(--ease-out)")
        expect(final(".ui-dialog", "transform-origin")).toBeUndefined()
        expect(DOC).toContain("200ms for a dialog, a toast, and the side bar coming in")
    })

    it("is how a date field's calendar opens on a phone, in the middle of the screen", () => {
        expect(final(".ui-calendar-layer", "animation", PHONE)).toBe("ui-fade-in 200ms var(--ease-out)")
        expect(final(".ui-calendar", "animation", PHONE)).toBe("ui-grow-in 200ms var(--ease-out)")
        expect(final(".ui-calendar", "transform-origin", PHONE)).toBe("center")
        // On a computer, its layer is nothing to fade.
        expect(final(".ui-calendar-layer", "animation")).toBeUndefined()
    })
})

describe("a toast", () => {
    it("slides 16px in from the end side as it fades in, in 200ms, starting fast", () => {
        expect(final(".ui-toast", "animation")).toBe("ui-toast-in 200ms var(--ease-out)")
        expect(keyframes("ui-toast-in")).toBe("from { opacity: 0; transform: translateX(16px); }")
        expect(keyframes("ui-toast-in-rtl")).toBe("from { opacity: 0; transform: translateX(-16px); }")
    })
})

describe("the side bar on a phone", () => {
    it("slides in over 200ms as the page beside it dims, and out over 150ms, as a phone's own sheets move", () => {
        expect(final(".ui-side-bar", "transition", NARROW)).toBe("transform 150ms var(--ease-drawer), visibility 0s linear 150ms")
        expect(final('.ui-side-bar[data-open="true"]', "transition", NARROW)).toBe("transform 200ms var(--ease-drawer)")
        expect(final(".ui-side-scrim", "animation", NARROW)).toBe("ui-fade-in 200ms var(--ease-out)")
        expect(DOC).toContain("150ms for the side bar going")
    })
})

describe("coming in", () => {
    it("moves only opacity and transforms", () => {
        const names = [...UI.matchAll(/@keyframes\s+(ui-[\w-]+-in(?:-rtl)?)\s*\{/g)].map(m => m[1])
        expect(names.sort()).toEqual(["ui-fade-in", "ui-grow-in", "ui-pop-in", "ui-toast-in", "ui-toast-in-rtl"])
        for (const name of names) {
            const properties = [...keyframes(name).matchAll(/([\w-]+)\s*:/g)].map(m => m[1])
            expect([name, properties.filter(p => p !== "opacity" && p !== "transform")]).toEqual([name, []])
        }
    })

    it("leaves alone what comes as someone types, and tabs", () => {
        for (const selector of [".ui-suggestions", ".ui-suggestion", ".ui-tab-panel"]) {
            for (const property of ["animation", "transition"]) expect([selector, property, final(selector, property, PHONE, NARROW)]).toEqual([selector, property, undefined])
        }
    })
})

describe('with "reduce motion"', () => {
    it("is at once, fades too, as DESIGN.md says where Emil Design Engineering would keep them", () => {
        for (const selector of [...POP_UPS, ".ui-dialog-backdrop", ".ui-dialog", ".ui-calendar-layer", ".ui-side-scrim", ".ui-toast"]) {
            expect([selector, final(selector, "animation", PHONE, NARROW, REDUCE)]).toEqual([selector, "none"])
        }
        expect(final(".ui-side-bar", "transition", NARROW, REDUCE)).toBe("none")
        expect(final('.ui-side-bar[data-open="true"]', "transition", NARROW, REDUCE)).toBe("none")
        expect(DOC).toContain("movement becomes an instant change, and so do fades")
        // And app/globals.css ends every animation at once, whatever its rule (lib/reduced-motion.test.ts):
        // none of these is a spinner, which keeps turning.
        for (const selector of [...POP_UPS, ".ui-dialog-backdrop", ".ui-dialog", ".ui-calendar-layer", ".ui-side-scrim"]) expect(selector).not.toContain("spin")
    })

    it("is at once in Arabic too, where a right-to-left rule that moves something outranks the plain one", () => {
        // The toast's slide in Arabic is [dir="rtl"] .ui-toast, which outranked
        // .ui-toast's "animation: none", so it still ran, cut to 0.01ms by
        // app/globals.css alone (PR 224's browser flows).
        const moves = /(?:^|[;\s])(animation(?:-name)?|transition(?:-property)?)\s*:/
        const moving = RULES.filter(r => r.media !== REDUCE && moves.test(r.body)).flatMap(r => r.selectors.filter(s => s.startsWith('[dir="rtl"]')))
        expect(moving).toEqual(['[dir="rtl"] .ui-toast'])
        for (const selector of moving) {
            for (const kind of ["animation", "transition"]) {
                const sets = RULES.filter(r => r.selectors.includes(selector) && (r.media === null || r.media === REDUCE) && new RegExp(`(?:^|[;\\s])${kind}(?:-[a-z]+)?\\s*:`).test(r.body))
                if (sets.length === 0) continue
                const last = sets.at(-1)!
                expect([selector, kind, last.media, last.body.match(new RegExp(`${kind}\\s*:\\s*([^;]+);`))?.[1].trim()]).toEqual([selector, kind, REDUCE, "none"])
            }
        }
    })
})
