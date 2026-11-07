import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A page that broke, and the app itself (DESIGN.md §5.5, "A page that broke"
 * and "When the app itself broke"; PR 219): components/DashboardErrorBoundary.tsx
 * and app/global-error.tsx, on the building blocks.
 *
 * A page that broke was a card of its own making, in English only, under a
 * warning emoji: it told of "a client-side exception", offered Reload Page and
 * a red Reset Settings & Reload, which also switched the app to English, and
 * screen readers weren't told. It stayed when the person went to another page,
 * until the page was reloaded. When the app itself broke, its screen was in
 * English only, its Try Again in Title Case, and the app's styles, fonts and
 * the theme the person chose didn't reach it.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
// next/font only runs in Next's compiler; the variables are all the page needs of it.
vi.mock("@/app/fonts", () => ({ fontVariables: "font-outfit font-inter font-noto-arabic" }))
const report = vi.hoisted(() => ({ calls: [] as unknown[] }))
vi.mock("@/lib/client-error-report", () => ({ reportClientError: async (error: unknown) => { report.calls.push(error); return "3FA9C2D1" } }))
beforeEach(() => { state.locale = "en"; report.calls.length = 0 })

const source = (path: string) => readFileSync(path, "utf8")
const UI = source("components/ui/ui.css")
/** A rule's body in ui.css, by its exact selector. */
const rule = (selector: string) => {
    const start = UI.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return UI.slice(start, UI.indexOf("}", start))
}
const KEYS = ["error_screen_title", "error_screen_detail", "error_screen_reload", "error_screen_start_again", "error_screen_reference"] as const

async function brokenPage(props: { standalone?: boolean } = {}) {
    const { BrokenPage } = await import("@/components/DashboardErrorBoundary")
    return renderToStaticMarkup(h(BrokenPage, { error: new Error("boom"), ...props }))
}
async function screenView(reference: string | null) {
    const { ErrorScreenView } = await import("@/components/ErrorScreen")
    const { ERROR_SCREEN_WORDS } = await import("@/lib/error-screen")
    return renderToStaticMarkup(h(ErrorScreenView, { words: ERROR_SCREEN_WORDS[state.locale], reference }))
}

describe("the words", () => {
    it("say what happened and what to do, in both languages", () => {
        expect(KEYS.map(k => en[k])).toEqual([
            "This page stopped working",
            "Reloading the page usually puts it right. If it keeps happening, start again: that clears what this browser keeps for the app, and you stay signed in.",
            "Reload page",
            "Start again",
            "To report it, share this reference with your Admin: {ref}",
        ])
        expect(KEYS.map(k => ar[k])).toEqual([
            "توقفت هذه الصفحة عن العمل",
            "عادةً ما تُصلح إعادة تحميل الصفحة ذلك. وإذا تكرر، يُرجى البدء من جديد: يمسح ذلك ما يحفظه هذا المتصفح للتطبيق، مع بقاء تسجيل الدخول.",
            "إعادة تحميل الصفحة",
            "البدء من جديد",
            "وللإبلاغ عن ذلك، يُرجى مشاركة هذا المرجع مع المسؤول: {ref}",
        ])
    })

    it("are the same for the screen drawn with no dictionary, word for word", async () => {
        const { ERROR_SCREEN_WORDS } = await import("@/lib/error-screen")
        for (const k of KEYS) {
            expect(ERROR_SCREEN_WORDS.en[k], k).toBe(en[k])
            expect(ERROR_SCREEN_WORDS.ar[k], k).toBe(ar[k])
        }
        expect(Object.keys(ERROR_SCREEN_WORDS.en).sort()).toEqual([...KEYS].sort())
    })
})

describe("a page that broke (components/DashboardErrorBoundary.tsx)", () => {
    it("is Next's own boundary: going to another page leaves it behind, and a redirect or Not found passes through it", () => {
        const src = source("components/DashboardErrorBoundary.tsx")
        expect(src).toContain("import { catchError, type ErrorInfo } from 'next/error'")
        expect(src).toMatch(/export default catchError\(/)
        expect(src).not.toMatch(/extends Component|getDerivedStateFromError|componentDidCatch/)
    })

    it("says so in its place: the warning icon, its title, what to do, Reload page and Start again", async () => {
        const html = await brokenPage()
        expect(html.startsWith('<div class="ui-page"><div class="ui-panel"><div class="ui-empty"><svg')).toBe(true)
        expect(html).toContain('<h1 tabindex="-1" class="ui-empty-title ui-error-title">This page stopped working</h1>')
        expect(html).toContain(`<p class="ui-empty-detail">${en.error_screen_detail}</p>`)
        expect(html).toContain('<div class="ui-form-actions ui-error-actions"><button type="button" class="ui-btn ui-btn-primary">Reload page</button><button type="button" class="ui-btn ui-btn-secondary">Start again</button></div>')
        // Neither is red: nothing is deleted.
        expect(html).not.toContain("ui-btn-danger")
        expect(html).not.toMatch(/style=|⚠|exception/)
    })

    it("in the page's language", async () => {
        state.locale = "ar"
        const html = await brokenPage()
        expect(html).toContain(`>${ar.error_screen_title}</h1>`)
        expect(html).toContain(`>${ar.error_screen_reload}</button><button type="button" class="ui-btn ui-btn-secondary">${ar.error_screen_start_again}</button>`)
    })

    it("keeps the side bar and the top bar: the dashboard has it inside its frame", () => {
        const layout = source("app/(dashboard)/layout.tsx")
        expect(layout.indexOf("<DashboardErrorBoundary>")).toBeGreaterThan(layout.indexOf("<DashboardShell"))
        expect(layout.indexOf("<DashboardErrorBoundary>")).toBeLessThan(layout.indexOf("</DashboardShell>"))
    })

    it("on a page with no side bar, such as signing in, has the whole screen", async () => {
        expect(source("app/(auth)/layout.tsx")).toContain("<DashboardErrorBoundary standalone>")
        expect((await brokenPage({ standalone: true })).startsWith('<main class="ui-error-page"><div class="ui-panel">')).toBe(true)
    })
})

describe("the error screen (components/ErrorScreen.tsx)", () => {
    it("shows the logged failure's reference under the buttons, as made, for a browser's translation to leave alone", async () => {
        expect(await screenView("3FA9C2D1")).toContain('</div><p class="ui-empty-detail ui-error-reference">To report it, share this reference with your Admin: <span class="ui-error-code" translate="no" dir="ltr">3FA9C2D1</span></p></div></div>')
        state.locale = "ar"
        expect(await screenView("3FA9C2D1")).toContain(`<p class="ui-empty-detail ui-error-reference">وللإبلاغ عن ذلك، يُرجى مشاركة هذا المرجع مع المسؤول: <span class="ui-error-code" translate="no" dir="ltr">3FA9C2D1</span></p>`)
        expect(await screenView(null)).not.toContain("ui-error-reference")
    })

    it("reports the failure through the app's one report, so both the log and Sentry have it, and once however often it's drawn", async () => {
        const { reportOnce } = await import("@/components/ErrorScreen")
        const failure = new Error("boom")
        expect(await reportOnce(failure)).toBe("3FA9C2D1")
        expect(await reportOnce(failure)).toBe("3FA9C2D1")
        expect(report.calls).toEqual([failure])
        await reportOnce(new Error("another"))
        expect(report.calls).toHaveLength(2)
    })

    it("puts the focus on its title, where the page was", () => {
        const src = source("components/ErrorScreen.tsx")
        expect(src).toMatch(/useEffect\(\(\) => \{\s*title\.current\?\.focus\(\)\s*\}, \[\]\)/)
        expect(src).toContain("ref={titleRef} tabIndex={-1}")
    })
})

describe("start again (lib/error-screen.ts)", () => {
    const browser = () => {
        const kept = new Map([["nizmo-face-sent-review", "r1"], ["selectedCompanyId", "c-1"], ["draft", "x"]])
        const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), clear: () => kept.clear() }
        const written: string[] = []
        const doc = { set cookie(value: string) { written.push(value) }, get cookie() { return "" } }
        return { kept, storage, written, doc, reload: vi.fn() }
    }

    it("clears what the browser keeps for the app, the phone's own records apart, forgets the company a Super Admin picked, and loads the page again", async () => {
        const { startAgain } = await import("@/lib/error-screen")
        const b = browser()
        startAgain(b.storage, b.doc, b.reload)
        expect([...b.kept]).toEqual([["nizmo-face-sent-review", "r1"]])
        expect(b.written).toEqual(["scopedCompanyId=;path=/;max-age=0;samesite=lax"])
        expect(b.reload).toHaveBeenCalledTimes(1)
    })

    it("keeps the person's language and theme: it no longer switches the app to English", () => {
        for (const f of ["lib/error-screen.ts", "components/ErrorScreen.tsx", "components/DashboardErrorBoundary.tsx", "app/global-error.tsx"]) {
            expect(source(f), f).not.toMatch(/NEXT_LOCALE=|NEXT_THEME=/)
        }
        expect(source("components/ErrorScreen.tsx")).toContain("onClick={() => startAgain()}")
    })
})

describe("when the app itself broke (app/global-error.tsx)", () => {
    it("draws its own page with the app's styles and fonts, which Next leaves out of it", () => {
        const src = source("app/global-error.tsx")
        expect(src).toContain("import './globals.css'")
        expect(src).toContain("import '@/components/ui/ui.css'")
        expect(src).toContain("import { fontVariables } from './fonts'")
        // The dictionaries are the size of all the app's words, and this screen is in every page's code.
        expect(src).not.toMatch(/translations/)
    })

    it("in the language and theme the person chose, from the browser's cookies", async () => {
        const { errorScreenLook } = await import("@/lib/error-screen")
        expect(errorScreenLook("NEXT_LOCALE=ar; NEXT_THEME=dark")).toEqual({ locale: "ar", dir: "rtl", theme: "dark" })
        expect(errorScreenLook("a=1; NEXT_THEME=light;NEXT_LOCALE=en")).toEqual({ locale: "en", dir: "ltr", theme: "light" })
        // No choice yet: the browser's language, as the server picks it (lib/locale.ts).
        expect(errorScreenLook("", "ar-EG")).toEqual({ locale: "ar", dir: "rtl", theme: "light" })
        expect(errorScreenLook("NEXT_LOCALE=xx; NEXT_THEME=system")).toEqual({ locale: "en", dir: "ltr", theme: "light" })
    })

    it("says the same as a page that broke, the whole screen in the page's colour", async () => {
        const { default: GlobalError } = await import("@/app/global-error")
        const html = renderToStaticMarkup(h(GlobalError, { error: new Error("boom") }))
        expect(html).toMatch(/^<html lang="en" dir="ltr" data-theme="light" class="font-outfit font-inter font-noto-arabic">/)
        expect(html).toContain("<title>This page stopped working</title>")
        expect(html).toContain('<main class="ui-error-page"><div class="ui-panel"><div class="ui-empty">')
        expect(html).toContain('<h1 tabindex="-1" class="ui-empty-title ui-error-title">This page stopped working</h1>')
        expect(html).toContain('<button type="button" class="ui-btn ui-btn-primary">Reload page</button><button type="button" class="ui-btn ui-btn-secondary">Start again</button>')
        expect(html).not.toMatch(/style=|⚠|Try Again/)
    })
})

describe("its look (components/ui/ui.css)", () => {
    it("the whole screen in the page's colour, the panel in its middle", () => {
        const page = rule(".ui-error-page")
        for (const d of ["min-block-size: 100dvh;", "display: grid;", "place-items: center;", "padding: var(--space-4);", "background: var(--page);"]) expect(page).toContain(d)
        expect(rule(".ui-error-page > .ui-panel")).toContain("inline-size: min(100%, 560px);")
    })

    it("its title a heading that looks like an empty state's, with no ring when the focus is put on it", () => {
        expect(rule(".ui-error-title")).toContain("font-weight: inherit;")
        expect(rule(".ui-error-title:focus")).toContain("outline: none;")
    })

    it("its buttons side by side in the middle, and the reference picked up whole", () => {
        expect(rule(".ui-error-actions")).toContain("justify-content: center;")
        expect(rule(".ui-error-code")).toContain("user-select: all;")
    })
})
