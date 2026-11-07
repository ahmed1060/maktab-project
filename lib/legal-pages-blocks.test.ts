import { describe, it, expect } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import LegalLayout from "@/app/(legal)/layout"
import PrivacyPolicy, { metadata as privacyMetadata } from "@/app/(legal)/privacy/page"
import TermsOfService, { metadata as termsMetadata } from "@/app/(legal)/terms/page"

/**
 * The privacy policy and the terms of service (DESIGN.md §5.5; PR 220):
 * app/(legal)/layout.tsx and the two documents, on the building blocks.
 *
 * They were a column of their own making on the older pages' grey, in sizes
 * and colours of their own: Nizmo's name above in spaced capitals, their
 * titles and the links under them in Title Case, and words in bold heavier
 * than the app's. In Arabic, their frame was set left to right but not marked
 * as English, so a screen reader read the English as Arabic. Printed, either
 * one came out as blank pages.
 *
 * What they say, and that anyone can open them, is lib/public-legal-pages.test.ts.
 */

const source = (path: string) => readFileSync(path, "utf8")
const UI = source("components/ui/ui.css")
const GLOBALS = source("app/globals.css")

/** The public documents' own part of ui.css, from its heading to its end. */
const BLOCK = (() => {
    const start = UI.indexOf("/* ── Public documents (§5.5)")
    const end = UI.indexOf("/* end of the public documents */")
    return start >= 0 && end > start ? UI.slice(start, end) : ""
})()
/**
 * A rule's body in the public documents' part of ui.css, by its whole selector:
 * one that starts a rule, after another's end or a comment, rather than the
 * last line of a longer selector list.
 */
const rule = (selector: string) => {
    let start = BLOCK.indexOf(`\n${selector} {`)
    while (start >= 0 && !/(\}|\*\/)$/.test(BLOCK.slice(0, start))) start = BLOCK.indexOf(`\n${selector} {`, start + 1)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return BLOCK.slice(start, BLOCK.indexOf("}", start))
}
/** What's inside one of the block's @media rules, by its query. */
const media = (query: string) => {
    const start = BLOCK.indexOf(`@media ${query} {`)
    if (start < 0) throw new Error(`no @media ${query}`)
    return BLOCK.slice(start, BLOCK.indexOf("\n}", start))
}

const page = (doc: () => ReactElement) => renderToStaticMarkup(h(LegalLayout, null, h(doc)))

describe("the page around the document (app/(legal)/layout.tsx)", () => {
    it("is the building blocks', with no style of its own", () => {
        const src = stripComments(source("app/(legal)/layout.tsx"))
        expect(src).not.toContain("style=")
        expect(page(PrivacyPolicy).startsWith('<div class="ui-legal" lang="en" dir="ltr">')).toBe(true)
    })

    it("is in English and left to right, marked so for screen readers whatever language the app is in", () => {
        // The root layout marks the page as Arabic for someone using the app in
        // Arabic: the wrapper says this part of it is English.
        for (const doc of [PrivacyPolicy, TermsOfService]) {
            expect(page(doc)).toMatch(/^<div class="ui-legal" lang="en" dir="ltr">/)
        }
    })

    it("has Nizmo's mark and name at its top, a link to sign in", () => {
        expect(page(PrivacyPolicy)).toContain(
            '<header class="ui-legal-head"><a href="/login" class="ui-legal-brand">'
            + '<span class="ui-company-mark" aria-hidden="true"><span class="ui-company-letter">N</span></span>'
            + "<span>Nizmo</span></a></header>",
        )
    })

    it("holds the document on a sheet, as the page's main part", () => {
        expect(page(PrivacyPolicy)).toContain('<main class="ui-legal-main"><article class="ui-panel ui-legal-doc"><h1 class="ui-page-title">')
        expect(page(TermsOfService)).toContain('<main class="ui-legal-main"><article class="ui-panel ui-legal-doc"><h1 class="ui-page-title">')
    })

    it("has the privacy policy, the terms and Sign in under it, in the app's words", () => {
        const foot = `<footer class="ui-legal-foot"><a href="/privacy">${en.privacy_policy}</a><a href="/terms">${en.terms_of_service}</a><a href="/login">${en.sign_in}</a></footer>`
        expect([en.privacy_policy, en.terms_of_service, en.sign_in]).toEqual(["Privacy policy", "Terms of service", "Sign in"])
        expect(page(PrivacyPolicy).endsWith(`</article></main>${foot}</div>`)).toBe(true)
    })
})

describe("the documents (app/(legal)/privacy and terms)", () => {
    it("are titled as a page title is, in sentence case, with when they were last updated under it", () => {
        expect(page(PrivacyPolicy)).toContain('<h1 class="ui-page-title">Privacy policy</h1><p class="ui-page-subtitle">Last updated 17 September 2026</p><p class="ui-legal-lede">')
        expect(page(TermsOfService)).toContain('<h1 class="ui-page-title">Terms of service</h1><p class="ui-page-subtitle">Last updated 17 September 2026</p><p class="ui-legal-lede">')
    })

    it("name themselves in the browser's tab as the app's pages do", () => {
        expect(privacyMetadata.title).toBe("Nizmo — Privacy policy")
        expect(termsMetadata.title).toBe("Nizmo — Terms of service")
    })

    it("name each other as the links do, in sentence case", () => {
        for (const file of ["app/(legal)/privacy/page.tsx", "app/(legal)/terms/page.tsx"]) {
            const src = stripComments(source(file))
            expect(src, file).not.toMatch(/Privacy Policy|Terms of Service/)
        }
        expect(page(TermsOfService)).toContain('<a href="/privacy">privacy policy</a>')
    })

    it("name the app's button as the app does", () => {
        expect(en.capture_location_button).toBe("Check in")
        expect(page(PrivacyPolicy)).toContain(`press ${en.capture_location_button} on a task`)
    })

    it("keep HERE, a service's name that's also an English word, from a browser's translation", () => {
        // A translation the note allows could otherwise turn the mapping
        // provider into the word for "here" (found in the web interface audit).
        const html = page(PrivacyPolicy)
        expect(html).toContain('we send them to <span translate="no">HERE</span>, a mapping provider.')
        expect(html).toContain('<dt translate="no">HERE</dt>')
        expect(html.match(/\bHERE\b/g)).toHaveLength(2)
    })

    it("keep their note that English governs as a note", () => {
        for (const doc of [PrivacyPolicy, TermsOfService]) {
            expect(page(doc)).toContain('<div class="ui-legal-note"><p>This document is published in English, and the English version governs.')
        }
    })

    it("leave no class of the old block behind, and the old block is gone", () => {
        for (const file of ["app/(legal)/layout.tsx", "app/(legal)/privacy/page.tsx", "app/(legal)/terms/page.tsx"]) {
            expect(source(file), file).not.toMatch(/className="legal/)
        }
        expect(GLOBALS).not.toMatch(/^\.legal\b/m)
    })
})

describe("the look (components/ui/ui.css)", () => {
    it("is the page's flat colour, in the app's font, with the page's edge around the column", () => {
        const page = rule(".ui-legal")
        expect(page).toContain("background: var(--page);")
        expect(page).toContain("color: var(--ink);")
        expect(page).toContain("min-block-size: 100dvh;")
        expect(page).toContain("padding: var(--space-8) var(--space-8) var(--space-12);")
        expect(UI).toMatch(/\n\.ui-legal,\n[^{]*\{\n {2}font-family: var\(--font-ui\);/)
        expect(rule(".ui-legal-head,\n.ui-legal-main,\n.ui-legal-foot")).toContain("max-inline-size: 736px;")
        expect(media("(max-width: 767px)")).toContain("padding: var(--space-4) var(--space-4) var(--space-8);")
    })

    it("draws Nizmo's mark and name at the side bar head's size", () => {
        const brand = rule(".ui-legal-brand")
        expect(brand).toContain("gap: var(--space-3);")
        expect(brand).toContain("font-size: var(--text-lg);")
        expect(brand).toContain("font-weight: 500;")
        expect(brand).toContain("color: var(--ink);")
        expect(brand).toContain("text-decoration: none;")
    })

    it("sets the document on a sheet at --text-lg, 32px inside and 16px on phones", () => {
        const sheet = rule(".ui-legal-doc")
        expect(sheet).toContain("padding: var(--space-8);")
        expect(sheet).toContain("font-size: var(--text-lg);")
        expect(sheet).toContain("line-height: var(--leading-lg);")
        expect(sheet).toContain("color: var(--ink-2);")
        expect(media("(max-width: 767px)")).toMatch(/\.ui-legal-doc \{\n\s+padding: var\(--space-4\);/)
    })

    it("sets its first paragraph at --text-xl, and its headings, terms and stressed words at weight 500 in --ink", () => {
        expect(rule(".ui-legal-doc .ui-legal-lede")).toContain("font-size: var(--text-xl);")
        const h2 = rule(".ui-legal-doc h2")
        expect(h2).toContain("font-size: var(--text-xl);")
        expect(h2).toContain("font-weight: 500;")
        expect(h2).toContain("color: var(--ink);")
        const stressed = rule(".ui-legal-doc dt,\n.ui-legal-doc strong")
        expect(stressed).toContain("font-weight: 500;")
        expect(stressed).toContain("color: var(--ink);")
        expect(BLOCK).not.toMatch(/font-weight: (600|700)/)
    })

    it("keeps its links underlined in --brand-text, with a ring for the keyboard", () => {
        const link = rule(".ui-legal-doc a")
        expect(link).toContain("color: var(--brand-text);")
        expect(link).not.toContain("text-decoration: none")
        expect(BLOCK).toMatch(/\.ui-legal-doc a:focus-visible,\n\.ui-legal-brand:focus-visible,\n\.ui-legal-foot a:focus-visible \{\n\s+outline: 2px solid var\(--brand-text\);/)
    })

    it("gives a note a 3px bar in the neutral colour on its start edge", () => {
        expect(rule(".ui-legal-note")).toContain("border-inline-start: 3px solid var(--status-neutral-fg);")
    })

    it("sets the links under it at --text-sm in --brand-text, 44px tall on phones as the mark and name are", () => {
        expect(rule(".ui-legal-foot")).toContain("font-size: var(--text-sm);")
        expect(rule(".ui-legal-foot a")).toContain("color: var(--brand-text);")
        expect(media("(max-width: 767px)")).toMatch(/\.ui-legal-brand,\n\s+\.ui-legal-foot a \{\n\s+min-block-size: 44px;/)
    })

    it("uses only the tokens, and only logical properties", () => {
        expect(BLOCK.length).toBeGreaterThan(0)
        expect(BLOCK).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
        expect(BLOCK).not.toMatch(/\d(rem|em)\b/)
        expect(BLOCK).not.toMatch(/(^|[\s;{])((margin|padding|border)-(left|right|top|bottom)\b|(left|right|top|bottom|(max-|min-)?(width|height)):|text-align: (left|right))/m)
    })

    it("leaves the English documents out of the Arabic text rules", () => {
        // Keyed to the page's language, they reached into the English document
        // of someone using the app in Arabic: its title lost its spacing.
        expect(UI).not.toContain('html[lang="ar"]')
        expect(UI).toContain(".ui-page-title:lang(ar) {")
        expect(UI).toMatch(/\.ui-table:lang\(ar\),\n\.ui-page-subtitle:lang\(ar\),\n\.ui-empty-title:lang\(ar\) \{/)
    })

    it("prints the document alone, black on white, from dark mode too", () => {
        const print = media("print")
        expect(print).toMatch(/\.ui-legal-head,\n\s+\.ui-legal-foot \{\n\s+display: none;/)
        expect(print).toMatch(/\.ui-legal-doc,\n\s+\.ui-legal-doc \* \{\n\s+visibility: visible;/)
        for (const ink of ["--ink: var(--ink-on-paper);", "--ink-2: var(--ink-on-paper);", "--muted: var(--ink-on-paper);", "--status-neutral-fg: var(--neutral-on-paper);"]) {
            expect(print).toContain(ink)
        }
        expect(print).toContain("background: var(--paper);")
    })
})
