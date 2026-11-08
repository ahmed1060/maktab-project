import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * What was left of the dashboard's frame (DESIGN.md §5.1 and §5.5, Loading;
 * PR 221): components/DashboardShell.tsx and the dashboard layout's loading
 * fallback, on the building blocks.
 *
 * The shell drew the frame and the "Powered by" signature in five inline
 * styles, the signature with a transition of everything and a hover that
 * couldn't happen, as nothing on it takes the pointer, and set the page's
 * direction itself, apart from the side bar's and the top bar's. While the
 * frame waited, the page said "Loading section..." in English, in classes of
 * no stylesheet.
 *
 * The signature keeps its look, as the product owner decided on 2026-11-05:
 * its sizes, colours and gradient are the app's CSS now, as they were.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }) }))
beforeEach(() => { state.locale = "en" })

const source = (path: string) => readFileSync(path, "utf8")
const SHELL = stripComments(source("components/DashboardShell.tsx"))
const LAYOUT = stripComments(source("app/(dashboard)/layout.tsx"))
const UI = source("components/ui/ui.css")
const GLOBALS = source("app/globals.css")
/** A rule's body, by its whole selector at the start of a line, outside any @media. */
const rule = (css: string, selector: string) => {
    const start = css.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return css.slice(start, css.indexOf("}", start))
}

describe("the shell (components/DashboardShell.tsx)", () => {
    it("has no style of its own: its frame is the building blocks'", () => {
        expect(SHELL).not.toContain("style={{")
        expect(SHELL).not.toContain("<style jsx>")
        expect(SHELL).toContain('<div className="ui-shell">')
        expect(SHELL).toContain('<main className="ui-shell-main">')
    })

    it("leaves the page's direction to the page, as the side bar and the top bar do", () => {
        // The root layout and the language switch set it on the page itself
        // (context/LanguageContext.tsx), for the whole frame at once.
        expect(SHELL).not.toMatch(/direction:/)
        expect(SHELL).not.toContain("isRtl")
    })

    it("puts the side bar beside the page, the page as tall as the screen and never wider than its column", () => {
        const shell = rule(UI, ".ui-shell")
        expect(shell).toContain("display: flex;")
        expect(shell).toContain("min-block-size: 100vh;")
        const main = rule(UI, ".ui-shell-main")
        for (const d of ["flex: 1;", "min-inline-size: 0;", "display: flex;", "flex-direction: column;", "min-block-size: 100vh;"]) expect(main).toContain(d)
    })
})

describe('the "Powered by" signature, kept as it is (DESIGN.md §5.1)', () => {
    const signature = SHELL.slice(SHELL.indexOf("{showPoweredBy && ("), SHELL.indexOf("DEFAULT_POWERED_BY_NAME}") + 40)

    it("is drawn by the app's CSS, not inline", () => {
        expect(signature).toContain('<div className="floating-attribution">')
        expect(signature).toContain(`<span className="floating-attribution-by">{t('powered_by')}</span>`)
        expect(signature).toContain('<span className="floating-attribution-name" translate="no">{poweredByName?.trim() || DEFAULT_POWERED_BY_NAME}</span>')
    })

    it("keeps the name from a browser's translation, as its preview on System settings does", () => {
        expect(source("components/SystemSettingsCards.tsx")).toContain('<span className="ui-signature-name" translate="no">')
        expect(signature).toContain('className="floating-attribution-name" translate="no"')
    })

    it("keeps its look: the same sizes, weights, colours and gradient", () => {
        const box = rule(GLOBALS, ".floating-attribution")
        for (const d of ["position: fixed;", "display: flex;", "flex-direction: column;", "align-items: center;", "pointer-events: none;", "text-align: center;"]) expect(box).toContain(d)
        const by = rule(GLOBALS, ".floating-attribution-by")
        for (const d of ["font-size: 0.45rem;", "color: var(--text-soft);", "font-weight: 600;", "text-transform: uppercase;", "letter-spacing: 0.1em;", "font-family: var(--font-inter), sans-serif;"]) expect(by).toContain(d)
        const name = rule(GLOBALS, ".floating-attribution-name")
        for (const d of ["opacity: 0.7;", "font-size: 1.35rem;", "color: var(--text-main);", "font-weight: 900;", "letter-spacing: 0.15em;", "margin-top: 0.05rem;", "text-transform: uppercase;", "font-family: var(--font-inter), sans-serif;", "background: linear-gradient(135deg, var(--text-main) 0%, var(--text-muted) 100%);", "-webkit-background-clip: text;", "-webkit-text-fill-color: transparent;"]) expect(name).toContain(d)
    })

    it("has no transition of everything, and no hover nothing can reach", () => {
        expect(SHELL).not.toMatch(/transition: 'all/)
        expect(SHELL).not.toContain(":hover")
        // Its own rules, phones' included: from its comment to the focus
        // ring's, which follows them since the old styles between went (PR 223).
        const start = GLOBALS.indexOf("/* The \"Powered by\" signature")
        const end = GLOBALS.indexOf("/* Keyboard focus, on everything")
        expect(start).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(start)
        const own = GLOBALS.slice(start, end)
        expect(own).toContain(".floating-attribution-name {")
        expect(own).toContain("@media (max-width: 600px) {")
        expect(own).not.toContain("transition")
        expect(own).not.toContain(":hover")
    })
})

describe("while the frame waits (app/(dashboard)/layout.tsx)", () => {
    it("says the page is loading as every page does, where the page will be", async () => {
        expect(LAYOUT).not.toContain("Loading section")
        expect(LAYOUT).toContain("<Suspense fallback={<PageLoading />}>")
        const { PageLoading } = await import("@/components/PageLoading")
        const html = renderToStaticMarkup(h(PageLoading))
        expect(html).toMatch(/^<div class="ui-page"><div class="ui-panel" role="status"><div class="ui-empty"><svg[^>]*aria-hidden="true"/)
        expect(html).toContain(`<p class="ui-empty-title">${en.loading}</p>`)
    })

    it("in the page's language", async () => {
        state.locale = "ar"
        const { PageLoading } = await import("@/components/PageLoading")
        expect(renderToStaticMarkup(h(PageLoading))).toContain(`<p class="ui-empty-title">${ar.loading}</p>`)
    })

    it("is the same screen as a page's own while it's on its way (app/(dashboard)/dashboard/loading.tsx)", async () => {
        const { PageLoading } = await import("@/components/PageLoading")
        const Loading = (await import("@/app/(dashboard)/dashboard/loading")).default
        expect(renderToStaticMarkup(h(Loading))).toBe(renderToStaticMarkup(h(PageLoading)))
    })
})
