import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { moduleForPagePath } from "./features/routes"
import { resolveTitleKey } from "./page-title"
import { TAX_EXPORT_CODE } from "./tax-export-button"
import { TAX_EXPORT_NOTES, TAX_EXPORT_PAGE, TAX_EXPORT_STEPS, TAX_PORTAL_WORDS } from "./tax-export-page"

/**
 * The tax portal's export button's page (CLIENT_PORTAL_PLAN.md §10, §12
 * step 4b; DESIGN.md §5.5, The tax portal's export button; PR 319): who has
 * it, the button to drag from it, its steps and what to know, in both
 * languages. That the button dragged from it works on a page laid out like
 * the portal's is in the browser flows.
 */

const state = { locale: "en" as "en" | "ar", perms: new Set<string>() }
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (k: string) => state.perms.has(k) }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (k: string) => (k === "clients" ? "Clients" : k) }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/components/AccessDenied", () => ({ default: () => h("div", { "data-denied": "" }) }))

const PAGE = "app/(dashboard)/dashboard/tax-export/page.tsx"
const LAYOUT = "app/(dashboard)/dashboard/tax-export/layout.tsx"
const words = (locale: "en" | "ar") => (locale === "ar" ? ar : en) as Record<string, string>

let Page: () => ReactElement
beforeAll(async () => {
    Page = (await import("@/app/(dashboard)/dashboard/tax-export/page")).default
}, 60_000)
beforeEach(() => {
    state.locale = "en"
    state.perms = new Set(["tax.manage"])
})
const render = () => renderToStaticMarkup(h(Page))
/** A card by its title, up to the next card. */
const card = (html: string, title: string) => {
    const from = html.indexOf(`<h2 class="ui-card-title">${title}</h2>`)
    expect(from, title).toBeGreaterThan(-1)
    const next = html.indexOf('<h2 class="ui-card-title">', from + 1)
    return html.slice(from, next === -1 ? undefined : next)
}

describe("The tax portal's export button's page: who has it", () => {
    it("is the client portal's: a company whose package hasn't the add-on is told so by its address", () => {
        expect(TAX_EXPORT_PAGE).toBe("/dashboard/tax-export")
        expect(moduleForPagePath(TAX_EXPORT_PAGE)).toBe("TAX_POSITION")
        // The gate is only real if its layout is there, and asks for that module.
        expect(existsSync(LAYOUT)).toBe(true)
        expect(readFileSync(LAYOUT, "utf8")).toContain("guardModule('TAX_POSITION')")
    })

    it("is for whoever may update clients' tax position, and nobody else", () => {
        expect(render()).toContain('<h1 class="ui-page-title">The tax portal&#x27;s export button</h1>')

        // Seeing the tax position isn't enough: the file it makes is what an upload takes.
        state.perms = new Set(["tax.view", "clients.view"])
        const refused = render()
        expect(refused).toContain("data-denied")
        expect(refused).not.toContain("ui-page-title")
    })

    it("is decided on its first paint: the page is the button itself, so nobody without the permission has it for a moment", () => {
        // Who's signed in comes from the dashboard's layout at first, grants included (lib/useCan.ts).
        // The page waits for nothing else: the session hook is empty for its first second.
        state.perms = new Set()
        const html = render()
        expect(html).toContain("data-denied")
        expect(html).not.toContain("ui-btn-bookmark")
        expect(readFileSync(PAGE, "utf8")).not.toContain("useSession")
    })

    it("is named in the browser's tab, and isn't in the side bar: it's reached from the upload", () => {
        expect(resolveTitleKey(TAX_EXPORT_PAGE)).toBe("tax_export_title")
        expect(en.tax_export_title).toBe("The tax portal's export button")
        expect(readFileSync("lib/side-bar.ts", "utf8")).not.toContain("tax-export")
        // Clients to go back to.
        expect(render()).toMatch(/<a[^>]*class="ui-back-link"[^>]*href="\/dashboard\/clients"[^>]*>(<svg.*?<\/svg>)?Clients<\/a>/)
    })
})

describe("The tax portal's export button's page: the button", () => {
    it("is a link that looks like a button, to drag to the bookmarks bar, named for what it does", () => {
        const add = card(render(), "Add it to the browser")
        const link = /<a[^>]*class="ui-btn ui-btn-secondary ui-btn-bookmark"[^>]*>(<svg.*?<\/svg>)?Export claims<\/a>/.exec(add)
        expect(link, add).not.toBeNull()
        // Said by the line that says where it's dragged to, and how the bar is shown.
        const says = /aria-describedby="([^"]+)"/.exec(link![0])
        expect(says).not.toBeNull()
        expect(add).toContain(`<p id="${says![1]}">${en.tax_export_add_drag.replace(/'/g, "&#x27;")}</p>`)
        expect(en.tax_export_add_drag.startsWith("Drag this button to the browser's bookmarks bar.")).toBe(true)
        // The keys that show the bar stay on one line, in both languages.
        for (const said of [en.tax_export_add_drag, ar.tax_export_add_drag]) {
            expect(said).toContain("Ctrl\u00a0+\u00a0Shift\u00a0+\u00a0B")
            expect(said).toContain("⌘\u00a0+\u00a0Shift\u00a0+\u00a0B")
        }
    })

    it("has no address as it's drawn: React draws no javascript: address, so it's put on the link once it's on the page", () => {
        const html = render()
        expect(html).not.toContain("javascript:")
        expect(/<a[^>]*ui-btn-bookmark[^>]*>/.exec(html)![0]).not.toContain("href=")
        // The building block puts it there, and the page gives it the button's own.
        expect(readFileSync("components/ui/Button.tsx", "utf8")).toContain("setAttribute('href', address)")
        expect(readFileSync("components/tax/TaxExportButton.tsx", "utf8")).toContain("address={taxExportBookmark()}")
    })

    it("has Copy address beside it for whoever can't drag, and says how a bookmark is added by hand", () => {
        const add = card(render(), "Add it to the browser")
        expect(add).toMatch(/<button[^>]*class="ui-btn ui-btn-secondary"[^>]*>(<svg.*?<\/svg>)?Copy address<\/button>/)
        expect(add).toContain("Can&#x27;t drag it? Copy its address, add a bookmark in the browser, and paste the address as the bookmark&#x27;s address.")
        // Read out once it's copied, as a guide's Copy is.
        expect(add).toContain('<span class="ui-visually-hidden" role="status"></span>')
        expect(add).toContain("A bookmark keeps the copy it was made from. After the button changes, drag it again from here.")
    })

    it("is added on a computer: a phone has neither, and says so", () => {
        const add = card(render(), "Add it to the browser")
        // Both are drawn, and the styles show one: what's for a computer holds the button and Copy address.
        const computer = add.indexOf('class="ui-card-lines ui-tax-export-computer"')
        const phone = add.indexOf('<p class="ui-tax-export-phone">The button is added on a computer. Open this page there to add it.</p>')
        expect(computer).toBeGreaterThan(-1)
        expect(phone).toBeGreaterThan(add.indexOf("Copy address"))
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-tax-export-phone \{\s*display: none;\s*\}/)
        expect(css).toMatch(/@media \(max-width: 767px\) \{\s*\.ui-tax-export-computer \{\s*display: none;\s*\}\s*\.ui-tax-export-phone \{\s*display: block;\s*\}\s*\}/)
        // It's dragged, and its cursor says so.
        expect(css).toMatch(/\.ui-btn-bookmark \{\s*cursor: grab;\s*\}/)
    })
})

describe("The tax portal's export button's page: how to use it, and what to know", () => {
    it("numbers its steps as a guide's are, each saying where it's done, then what to do", () => {
        const use = card(render(), "How to use it")
        expect(use).toContain('<ol class="ui-guide-steps" role="list">')
        // On a page, a step's place keeps none of a paragraph's own margins, which a dialog takes away.
        expect(readFileSync("components/ui/ui.css", "utf8")).toMatch(/\.ui-tax-export \.ui-guide-who \{\s*margin: 0;\s*\}/)
        const steps = [...use.matchAll(/<li class="ui-guide-step"><span class="ui-guide-number" aria-hidden="true">(.*?)<\/span><div class="ui-guide-body"><h3 class="ui-guide-title">(.*?)<\/h3><p class="ui-guide-who">(.*?)<\/p>/g)].map(found => found.slice(1))
        expect(steps).toEqual([
            ["1", "Open the client&#x27;s claims", "On the tax portal"],
            ["2", "Choose the filter needed", "On the tax portal"],
            ["3", "Press the button", "In the browser&#x27;s bookmarks bar"],
            ["4", "Download the file", "On the button&#x27;s panel"],
            ["5", "Upload it to the client&#x27;s page", "In Nizmo"],
        ])
        expect(TAX_EXPORT_STEPS.map(step => step.title)).toEqual(["tax_export_step_open", "tax_export_step_filter", "tax_export_step_press", "tax_export_step_download", "tax_export_step_upload"])
        // The last one names Nizmo's own button and section as the client's page has them.
        expect(use).toContain("Open the client&#x27;s page and press Upload from the tax portal in its Tax position.")
    })

    it("says what the plan lists: one company and one filter to a file, what a filter hides, that the file is what the portal shows then, and that nothing is sent or kept (§10)", () => {
        const know = card(render(), "What to know")
        expect(TAX_EXPORT_NOTES).toEqual(["tax_export_know_one", "tax_export_know_filter", "tax_export_know_now", "tax_export_know_sends"])
        expect([...know.matchAll(/<li>/g)].length).toBe(4)
        expect(know).toContain("Each file is one company&#x27;s, with one filter.")
        expect(know).toContain("A claim the portal&#x27;s filter hides isn&#x27;t in the file. The upload then lists it as going, before anything is saved.")
        expect(know).toContain("Where the page has changed since the button gathered it, the button gathers every page again first. Where its rows still aren&#x27;t as many as the portal counts, it asks before saving.")
        expect(know).toContain("The button reads the table on the screen and saves a file on the computer. It sends nothing to Nizmo or anywhere else, and keeps nothing in the browser once the portal&#x27;s page is closed.")
        // As the button does (PR 318): nothing of a client's is left on a shared computer, so the page has no note for one.
        expect(TAX_EXPORT_CODE.split("localStorage").length - 1).toBe(1)
        expect(know).not.toContain("shared computer")
    })

    it("writes the portal's and the panel's own words as they have them, in Arabic, in either language", () => {
        const their = (word: string) => `<bdi lang="ar" translate="no" class="ui-their-word">${word}</bdi>`
        for (const locale of ["en", "ar"] as const) {
            state.locale = locale
            const html = render()
            for (const word of Object.values(TAX_PORTAL_WORDS)) expect(html, `${locale}: ${word}`).toContain(their(word))
        }
        state.locale = "en"
        expect(render()).toContain(`then press ${their("تنزيل Excel")}.`)
        // They're the button's own: a word changed on its panel is changed here.
        for (const word of Object.values(TAX_PORTAL_WORDS)) expect(TAX_EXPORT_CODE, word).toContain(word)
        // Bold, and no taller than the line they're in: Arabic's letters stand taller than Latin ones.
        expect(readFileSync("components/ui/ui.css", "utf8")).toMatch(/\.ui-their-word \{\s*font-weight: 600;\s*line-height: 1;\s*\}/)
    })

    it("is in Arabic too, its steps counted in Arabic's digits", () => {
        state.locale = "ar"
        const html = render()
        expect(html).toContain(`<h1 class="ui-page-title">${ar.tax_export_title}</h1>`)
        const use = card(html, ar.tax_export_use_title)
        expect([...use.matchAll(/<span class="ui-guide-number" aria-hidden="true">(.*?)<\/span>/g)].map(found => found[1])).toEqual(["١", "٢", "٣", "٤", "٥"])
        expect(card(html, ar.tax_export_add_title)).toMatch(new RegExp(`<a[^>]*ui-btn-bookmark[^>]*>(<svg.*?</svg>)?${ar.tax_export_bookmark}</a>`))
        expect(html).toContain(ar.tax_upload)
        expect(html).toContain(ar.tax_position)
    })

    it("has every word in both languages, with nothing left to fill in", () => {
        const keys = Object.keys(en).filter(key => key.startsWith("tax_export_"))
        expect(keys.length).toBeGreaterThan(20)
        expect(Object.keys(ar).filter(key => key.startsWith("tax_export_")).sort()).toEqual([...keys].sort())
        // Every word the page is built from is there.
        const used = [...TAX_EXPORT_STEPS.flatMap(step => [step.title, step.where, ...step.lines]), ...TAX_EXPORT_NOTES]
        for (const key of used) for (const locale of ["en", "ar"] as const) expect(words(locale)[key], `${locale}: ${key}`).toBeTruthy()
        // What a line leaves to be filled in is filled in.
        for (const locale of ["en", "ar"] as const) {
            state.locale = locale
            expect(render()).not.toMatch(/\{[a-z]+\}/)
        }
        // The page, and the link to it (step 4c, PR 320).
        const source = readFileSync(PAGE, "utf8") + readFileSync("components/tax/TaxExportButton.tsx", "utf8") + readFileSync("components/tax/TaxExportLink.tsx", "utf8")
        for (const key of keys) expect(source + JSON.stringify([TAX_EXPORT_STEPS, TAX_EXPORT_NOTES]) + readFileSync("lib/page-title.ts", "utf8"), key).toContain(key)
    })
})
