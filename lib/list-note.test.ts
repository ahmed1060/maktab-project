import { describe, it, expect } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { TranslateIcon } from "@phosphor-icons/react/ssr"
import { ListNote } from "@/components/ui"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { countOf } from "./plural"

/**
 * A note above a list's filter bar (DESIGN.md §5.3; LATER_CHANGES_PLAN.md
 * §3.1, step 5, PR 405), as the names still missing a language on the
 * Employees page, and the Clients page next: a panel with a round neutral
 * icon, a title naming it, and a line.
 */

const t = (lang: "en" | "ar") => (key: string) => (lang === "ar" ? ar : en)[key as keyof typeof en] ?? key

describe("a note above a list", () => {
    const html = renderToStaticMarkup(h(ListNote, { icon: TranslateIcon, title: "3 names have only one language", children: "Each one is asked for its other language." }))

    it("is a section in a panel, named by its title", () => {
        expect(html).toMatch(/^<section class="ui-panel ui-list-note" aria-labelledby="([^"]+)">/)
        const id = html.match(/aria-labelledby="([^"]+)"/)![1]
        expect(html).toContain(`<h2 class="ui-list-note-title" id="${id}">3 names have only one language</h2>`)
        expect(html).toContain('<p class="ui-list-note-text">Each one is asked for its other language.</p>')
    })

    it("has its icon round and neutral, read past by screen readers", () => {
        expect(html).toMatch(/<span class="ui-list-note-icon"><svg[^>]*aria-hidden="true"/)
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-form-note-icon,\n\.ui-list-note-icon \{/)
    })
})

describe("the names still missing a language, said", () => {
    it("in both languages, each count in its own form", () => {
        expect(countOf(t("en"), "en", 1, "one_language")).toBe("1 name has only one language")
        expect(countOf(t("en"), "en", 3, "one_language")).toBe("3 names have only one language")
        expect(countOf(t("ar"), "ar", 1, "one_language")).toBe("اسم واحد بلغة واحدة فقط")
        expect(countOf(t("ar"), "ar", 2, "one_language")).toBe("اسمان بلغة واحدة فقط")
        expect(countOf(t("ar"), "ar", 3, "one_language")).toBe("٣ أسماء بلغة واحدة فقط")
        expect(countOf(t("ar"), "ar", 11, "one_language")).toBe("١١ اسمًا بلغة واحدة فقط")
        expect(en.names_missing_note_body).toBe("Each one is asked for its other language the next time it's edited. Until then, it's shown in the language it has.")
        for (const key of ["names_missing_note_body", "names_filter_label", "names_filter_all", "names_filter_missing", "names_missing_column", "name_missing_ar_badge", "name_missing_en_badge"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
        expect([en.names_filter_all, en.names_filter_missing, en.names_missing_column, en.name_missing_ar_badge, en.name_missing_en_badge]).toEqual(["All names", "Missing a language", "Missing", "No Arabic", "No English"])
    })
})
