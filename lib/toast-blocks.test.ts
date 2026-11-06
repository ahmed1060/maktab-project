import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The toast on the building blocks (DESIGN.md §5.5, "Toast"). It was white
 * whatever the theme, so a dark page had a white box on it; its bar of
 * colour was on the left in Arabic too, the end side there; it slid in from
 * the right; its colours weren't the meanings' (§2.3); and its ✕ was a
 * letter. How long each stays, and what screen readers hear, are
 * lib/toast-a11y.test.ts's.
 */

vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ t: (key: string) => key, locale: "en" }) }))
vi.mock("next/navigation", () => ({ usePathname: () => "/", useSearchParams: () => new URLSearchParams() }))

const SRC = readFileSync("context/ToastContext.tsx", "utf8")
const UI = readFileSync("components/ui/ui.css", "utf8")
const GLOBALS = readFileSync("app/globals.css", "utf8")
/** A rule's body in ui.css, by its exact selector. */
const rule = (selector: string) => {
    const start = UI.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return UI.slice(start, UI.indexOf("}", start))
}

const toast = async (type: "success" | "error" | "warning" | "info", message = "Saved") => {
    const { ToastItem } = await import("@/context/ToastContext")
    return renderToStaticMarkup(createElement(ToastItem, { toast: { id: "t1", message, type }, onDismiss: () => {} }))
}

describe("a toast", () => {
    it("has its meaning's tone, from Done or good to Problem, and an icon before its words", async () => {
        const tones = { success: "good", error: "problem", warning: "waiting", info: "neutral" } as const
        for (const [type, tone] of Object.entries(tones)) {
            const html = await toast(type as keyof typeof tones)
            expect(html, type).toMatch(new RegExp(`^<div class="ui-toast" data-tone="${tone}"`))
            // The icon, then the words, then Close.
            expect(html.indexOf('class="ui-icon ui-toast-icon"'), type).toBeGreaterThan(0)
            expect(html.indexOf('class="ui-icon ui-toast-icon"')).toBeLessThan(html.indexOf('<p class="ui-toast-text">Saved</p>'))
            expect(html.indexOf('<p class="ui-toast-text">')).toBeLessThan(html.indexOf('<button type="button" class="ui-toast-close"'))
        }
        // Each meaning its own icon: a tick, a warning circle, a warning sign, an "i".
        const icons = await Promise.all((["success", "error", "warning", "info"] as const).map(async type => (await toast(type)).match(/<svg[^>]*>.*?<\/svg>/)?.[0]))
        expect(new Set(icons).size).toBe(4)
    })

    it("is Close, an X named for what it does, not a letter", async () => {
        const html = await toast("error", "Couldn't save")
        expect(html).toContain('<button type="button" class="ui-toast-close" aria-label="close">')
        expect(html).toMatch(/<button type="button" class="ui-toast-close" aria-label="close"><svg[^>]*aria-hidden="true"/)
        expect(html).not.toContain("×")
    })

    it("is drawn by the building blocks' rules, its colours the theme's, not typed in", async () => {
        const html = await toast("success")
        expect(html).not.toContain("style=")
        for (const gone of ["background: 'white'", "#1e293b", "#64748b", "#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "borderLeft", "slideInRight", "right: '20px'", "style jsx"]) {
            expect(SRC, gone).not.toContain(gone)
        }
        expect(GLOBALS).not.toContain("@keyframes slideInRight")
    })
})

describe("its rules (components/ui/ui.css)", () => {
    it("put the toasts at the screen's top end corner, over every dialog, the newest under the others, a tall stack scrolling", () => {
        const region = rule(".ui-toasts")
        expect(region).toMatch(/position: fixed;/)
        expect(region).toMatch(/inset-block-start: var\(--space-4\);/)
        expect(region).toMatch(/inset-inline-end: var\(--space-4\);/)
        // Over a dialog opened from an older page's modal (10000), under the
        // screen shown while the language changes (99999).
        expect(region).toMatch(/z-index: 10001;/)
        expect(region).toMatch(/flex-direction: column;/)
        expect(region).toMatch(/max-block-size: calc\(100dvh - 2 \* var\(--space-4\)\);/)
        expect(region).toMatch(/overflow-y: auto;/)
        // Clicks go through where there's no toast.
        expect(region).toMatch(/pointer-events: none;/)
        expect(SRC).toContain('<div ref={region} className="ui-toasts">')
    })

    it("draw one as a level-2 panel on --panel-raised with 8px corners, up to 400px wide", () => {
        const one = rule(".ui-toast")
        for (const want of [/background: var\(--panel-raised\);/, /border: 1px solid var\(--rule\);/, /border-radius: var\(--radius-menu\);/, /box-shadow: var\(--elev-2\);/,
            /inline-size: min\(400px, calc\(100vw - 2 \* var\(--space-4\)\)\);/, /pointer-events: auto;/]) {
            expect(one).toMatch(want)
        }
        // Its words in the page's ink, not its meaning's colour.
        expect(rule(".ui-toast-text")).toMatch(/color: var\(--ink\);/)
        expect(one).not.toMatch(/\b(left|right)\b/)
    })

    it("give each its meaning's colour as a 3px bar on its start edge, and on its icon", () => {
        // The toast's colour is its meaning's; the bar and the icon take it.
        expect(rule(".ui-toast")).toMatch(/border-inline-start: 3px solid currentColor;/)
        for (const [tone, token] of [["good", "--status-good-fg"], ["problem", "--problem-text"], ["waiting", "--status-waiting-fg"], ["neutral", "--status-neutral-fg"]]) {
            expect(rule(`.ui-toast[data-tone="${tone}"]`), tone).toMatch(new RegExp(`color: var\\(${token}\\);`))
        }
        expect(rule(".ui-toast-icon")).not.toMatch(/color:/)
    })

    it("slide one in from the end side in 200ms, the other way in Arabic, and not at all with reduce motion", () => {
        expect(rule(".ui-toast")).toMatch(/animation: ui-toast-in 200ms ease-out;/)
        expect(UI).toMatch(/@keyframes ui-toast-in \{\s*from \{\s*opacity: 0;\s*transform: translateX\(16px\);\s*\}\s*\}/)
        expect(UI).toMatch(/@keyframes ui-toast-in-rtl \{\s*from \{\s*opacity: 0;\s*transform: translateX\(-16px\);\s*\}\s*\}/)
        expect(rule('[dir="rtl"] .ui-toast')).toMatch(/animation-name: ui-toast-in-rtl;/)
        expect(UI).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.ui-toast \{\s*animation: none;\s*\}\s*\.ui-toast-close \{\s*transition: none;\s*\}\s*\}/)
    })

    it("make Close a 32px target, 44px under a finger, with a ring when the keyboard reaches it", () => {
        const close = rule(".ui-toast-close")
        expect(close).toMatch(/inline-size: 32px;/)
        expect(close).toMatch(/block-size: 32px;/)
        expect(close).toMatch(/color: var\(--muted\);/)
        expect(rule(".ui-toast-close:focus-visible")).toMatch(/outline: 2px solid var\(--brand-text\);/)
        expect(UI).toMatch(/@media \(pointer: coarse\) \{\s*\.ui-toast-close \{\s*inline-size: 44px;\s*block-size: 44px;/)
    })

    it("stretch the toasts between the screen's edges on a phone, less 16px each side", () => {
        expect(UI).toMatch(/@media \(max-width: 767px\) \{\s*\.ui-toasts \{\s*inset-inline-start: var\(--space-4\);\s*\}\s*\.ui-toast \{\s*inline-size: auto;\s*\}\s*\}/)
    })
})
