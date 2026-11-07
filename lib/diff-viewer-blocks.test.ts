import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { wordDiff, type DiffPart } from "./word-diff"

/**
 * What an edit changed (components/DiffViewer.tsx; DESIGN.md §5.5, "What an
 * edit changed"; PR 218): a task's title or description as it is now, word by
 * word, taken out struck through and put in underlined.
 *
 * Its marks were colour alone to a screen reader, an added word only a green
 * background; the text took the page's direction, not its own, so English in
 * Arabic ran right to left; its line breaks were lost; its spaces were margins
 * set by the language; and a word that stayed could be shown taken out and put
 * back, as it looked only ten words ahead.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
beforeEach(() => { state.locale = "en" })

const source = (path: string) => readFileSync(path, "utf8")
const UI = source("components/ui/ui.css")
/** A rule's body in ui.css, by its exact selector. */
const rule = (selector: string) => {
    const start = UI.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return UI.slice(start, UI.indexOf("}", start))
}
const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean)
/** The text as it is now, and as it was, from the parts. */
const now = (parts: DiffPart[]) => wordsOf(parts.filter(p => p.kind !== "removed").map(p => p.text).join(""))
const was = (parts: DiffPart[]) => wordsOf(parts.filter(p => p.kind !== "added").map(p => p.text).join(""))
const changed = (parts: DiffPart[]) => parts.filter(p => p.kind !== "same").reduce((n, p) => n + wordsOf(p.text).length, 0)

async function viewer(oldText: string | null, newText: string | null) {
    const { default: DiffViewer } = await import("@/components/DiffViewer")
    return renderToStaticMarkup(h(DiffViewer, { oldText, newText }))
}

describe("what an edit changed, word by word (lib/word-diff.ts)", () => {
    it("marks what was taken out and what was put in, those that changed together as one", () => {
        expect(wordDiff("Deliver to the bank", "Deliver to the tax office")).toEqual([
            { kind: "same", text: "Deliver to the " },
            { kind: "removed", text: "bank" },
            { kind: "same", text: " " },
            { kind: "added", text: "tax office" },
        ])
        expect(wordDiff("Pick up the papers", "Pick up the stamped papers")).toEqual([
            { kind: "same", text: "Pick up the " },
            { kind: "added", text: "stamped" },
            { kind: "same", text: " papers" },
        ])
        expect(wordDiff("Pay the old fee today", "Pay the fee today")).toEqual([
            { kind: "same", text: "Pay the " },
            { kind: "removed", text: "old" },
            { kind: "same", text: " fee today" },
        ])
    })

    it("marks only what changed: a word that stayed is never taken out and put back", () => {
        // Looking only ten words ahead, with more than ten put in before it, the
        // old one marked "Hana" and "at" taken out, then put them in again.
        expect(wordDiff("Call Hana at the bank", "Before you go anywhere this morning check that the stamped forms are ready then call Hana at the bank")).toEqual([
            { kind: "removed", text: "Call" },
            { kind: "same", text: " " },
            { kind: "added", text: "Before you go anywhere this morning check that the stamped forms are ready then call" },
            { kind: "same", text: " Hana at the bank" },
        ])
        const before = "Bring the signed contract to the office and give it to Hana before noon on Sunday"
        const after = "Before noon on Sunday, bring the signed contract to the office and give it to Hana"
        const parts = wordDiff(before, after)
        expect([now(parts), was(parts)]).toEqual([wordsOf(after), wordsOf(before)])
        // "the signed contract to the office and give it to Hana" stays, 11 words, and only the rest is marked.
        expect(changed(parts)).toBe(wordsOf(before).length + wordsOf(after).length - 2 * 11)
        expect(wordDiff("a b a c", "a c")).toEqual([{ kind: "same", text: "a " }, { kind: "removed", text: "b a" }, { kind: "same", text: " c" }])
    })

    it("keeps the text's line breaks, and its words in order either way", () => {
        const parts = wordDiff("Collect the forms\nStamp them", "Collect the signed forms\nStamp them at the bank")
        expect(parts).toEqual([
            { kind: "same", text: "Collect the " },
            { kind: "added", text: "signed" },
            { kind: "same", text: " forms\nStamp them " },
            { kind: "added", text: "at the bank" },
        ])
        // What was taken out sits where it was: a word off a line's end stays on that line, the
        // line break after it; a line taken out is a line of its own; a word put in where one was
        // taken out sits beside it.
        expect(wordDiff("Bring the forms today\nThen call", "Bring the forms\nThen call")).toEqual([
            { kind: "same", text: "Bring the forms " },
            { kind: "removed", text: "today" },
            { kind: "same", text: "\nThen call" },
        ])
        expect(wordDiff("Para one.\nRemoved line.\nPara three.", "Para one.\nPara three.")).toEqual([
            { kind: "same", text: "Para one.\n" },
            { kind: "removed", text: "Removed line." },
            { kind: "same", text: "\nPara three." },
        ])
        expect(wordDiff("Bring forms\nextra Then call", "Bring forms\nThen call")).toEqual([
            { kind: "same", text: "Bring forms\n" },
            { kind: "removed", text: "extra" },
            { kind: "same", text: " Then call" },
        ])
        expect(wordDiff("Deliver to the bank\nThen call", "Deliver to the tax office\nThen call")).toEqual([
            { kind: "same", text: "Deliver to the " },
            { kind: "removed", text: "bank" },
            { kind: "same", text: " " },
            { kind: "added", text: "tax office" },
            { kind: "same", text: "\nThen call" },
        ])
        // A line break now where there was none comes before what was put in.
        expect(wordDiff("Call the bank today", "Call the\nbranch today")).toEqual([
            { kind: "same", text: "Call the " },
            { kind: "removed", text: "bank" },
            { kind: "same", text: "\n" },
            { kind: "added", text: "branch" },
            { kind: "same", text: " today" },
        ])
        // A paragraph's blank line stays one; spaces between words are one.
        expect(wordDiff("One.\n\nTwo  three.", "One.\n\nTwo  three.")).toEqual([{ kind: "same", text: "One.\n\nTwo three." }])
        for (const [before, after] of [
            ["Call the client\nthen the bank", "Call the bank\nthen the client"],
            ["", "A description where there was none"],
            ["The whole of it", ""],
            ["تسليم الأوراق إلى البنك", "تسليم الأوراق المختومة إلى مكتب الضرائب"],
        ]) {
            const p = wordDiff(before, after)
            expect([now(p), was(p)], `${before} → ${after}`).toEqual([wordsOf(after), wordsOf(before)])
            // Parts of one kind never sit side by side: words that changed together are one mark.
            p.forEach((part, i) => { if (i) expect(part.kind, `${before} → ${after}`).not.toBe(p[i - 1].kind) })
        }
    })

    it("in Arabic too, and with nothing before or after", () => {
        expect(wordDiff("تسليم الأوراق إلى البنك", "تسليم الأوراق المختومة إلى البنك")).toEqual([
            { kind: "same", text: "تسليم الأوراق " },
            { kind: "added", text: "المختومة" },
            { kind: "same", text: " إلى البنك" },
        ])
        expect(wordDiff(null, "A new description")).toEqual([{ kind: "added", text: "A new description" }])
        expect(wordDiff("The old description", "")).toEqual([{ kind: "removed", text: "The old description" }])
        expect(wordDiff("", null)).toEqual([])
    })

    it("stays quick on a text far longer than the form takes, as an older one may be", () => {
        // A thousand characters is the most the form takes; one written before that may be longer.
        const before = Array.from({ length: 2600 }, (_, i) => `old${i}`).join(" ")
        const after = Array.from({ length: 2600 }, (_, i) => `new${i}`).join(" ")
        const started = performance.now()
        const parts = wordDiff(before, after)
        expect(performance.now() - started).toBeLessThan(1000)
        expect([now(parts), was(parts)]).toEqual([wordsOf(after), wordsOf(before)])
        // What's the same at either end is never marked, however long the rest.
        const long = wordDiff(`Start ${before} end`, `Start ${after} end`)
        expect([long[0], long[long.length - 1]]).toEqual([{ kind: "same", text: "Start " }, { kind: "same", text: " end" }])
    })
})

describe("the change's text (components/DiffViewer.tsx)", () => {
    it("is the text as it is now, taken out struck through and put in underlined, each named for screen readers", async () => {
        const html = await viewer("Deliver to the bank", "Deliver to the tax office")
        expect(html).toContain('<div class="ui-diff-text" dir="auto">Deliver to the <del class="ui-diff-removed"><span class="ui-visually-hidden" dir="ltr">Removed: </span>bank</del> <ins class="ui-diff-added"><span class="ui-visually-hidden" dir="ltr">Added: </span>tax office</ins></div>')
        // The text's own direction, which the screen readers' words, in the page's, don't decide.
        expect(html).not.toContain("direction")
    })

    it("has a key above it naming each mark that's in it, for those who don't see colour", async () => {
        const html = await viewer("Deliver to the bank", "Deliver to the tax office")
        expect(html.startsWith('<div class="ui-diff"><div class="ui-diff-key" aria-hidden="true"><span class="ui-diff-removed">Removed</span><span class="ui-diff-added">Added</span></div>')).toBe(true)
        // Only the marks it has: a word put in, nothing taken out.
        const added = await viewer("Pick up the papers", "Pick up the stamped papers")
        expect(added).toContain('<div class="ui-diff-key" aria-hidden="true"><span class="ui-diff-added">Added</span></div>')
        expect(added).not.toContain("<del")
    })

    it("says its marks in Arabic, and keeps an English text's direction on an Arabic page", async () => {
        state.locale = "ar"
        const html = await viewer("Deliver to the bank", "Deliver to the tax office")
        expect(html).toContain(`<span class="ui-diff-removed">${ar.diff_removed}</span><span class="ui-diff-added">${ar.diff_added}</span>`)
        expect(html).toContain(`<del class="ui-diff-removed"><span class="ui-visually-hidden" dir="rtl">${ar.diff_removed}: </span>bank</del>`)
        expect(html).toContain('<div class="ui-diff-text" dir="auto">')
        expect([ar.diff_removed, ar.diff_added, en.diff_removed, en.diff_added]).toEqual(["محذوف", "مضاف", "Removed", "Added"])
    })

    it("shows nothing with nothing before or after, and is drawn by ui.css alone", async () => {
        expect(await viewer("", "")).toBe("")
        const viewerSource = source("components/DiffViewer.tsx")
        for (const old of ["style=", "marginRight", "marginLeft", "--ok-bg", "--danger-bg", "split(/\\s+/)"]) expect(viewerSource, old).not.toContain(old)
    })
})

describe("its look (components/ui/ui.css)", () => {
    it("strikes through what was taken out in the Problem colours, and underlines what was put in in the Done or good colours", () => {
        const removed = rule(".ui-diff-removed")
        for (const decl of ["background: var(--status-problem-bg);", "color: var(--status-problem-fg);", "text-decoration: line-through;"]) expect(removed, decl).toContain(decl)
        const added = rule(".ui-diff-added")
        for (const decl of ["background: var(--status-good-bg);", "color: var(--status-good-fg);", "text-decoration: underline;"]) expect(added, decl).toContain(decl)
        // A mark that runs onto a second line is drawn whole on each, its corners as a focus ring's.
        const marks = rule(".ui-diff-removed,\n.ui-diff-added")
        for (const decl of ["border-radius: 2px;", "box-decoration-break: clone;", "-webkit-box-decoration-break: clone;"]) expect(marks, decl).toContain(decl)
    })

    it("keeps the text's line breaks, breaks a word with no space where it must, and puts the key above it", () => {
        const text = rule(".ui-diff-text")
        for (const decl of ["white-space: pre-wrap;", "overflow-wrap: anywhere;"]) expect(text, decl).toContain(decl)
        expect(rule(".ui-diff")).toContain("gap: var(--space-3);")
        const key = rule(".ui-diff-key")
        for (const decl of ["gap: var(--space-2);", "font-size: var(--text-sm);"]) expect(key, decl).toContain(decl)
        const block = UI.slice(UI.indexOf("/* ── What an edit changed"), UI.indexOf("end of what an edit changed"))
        expect(block).not.toMatch(/\b(left|right):|margin-(left|right)|padding-(left|right)|#[0-9a-f]{3,8}\b/i)
    })
})

describe("on a task's page (app/(dashboard)/dashboard/tasks/[id]/client.tsx)", () => {
    it("opens it in the dialog named for the field, which sets no direction of its own", () => {
        const src = source("app/(dashboard)/dashboard/tasks/[id]/client.tsx")
        const dialog = src.slice(src.indexOf("open={!!diffField}"), src.indexOf("<TaskEditDetailsModal"))
        expect(dialog).toContain("<DiffViewer oldText={latestChanges[diffField].from} newText={latestChanges[diffField].to} />")
        expect(dialog).not.toContain('dir="auto"')
        expect([en.title_changes_title, en.description_changes_title]).toEqual(["Title changes", "Description changes"])
    })
})
