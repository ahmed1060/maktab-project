import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The tax position page's building blocks (CLIENT_PORTAL_PLAN.md §12 step 8b;
 * DESIGN.md §3.2, §5.5; PR 337): bars by part, the share bar, and the page's
 * one large figure, rendered to HTML, with the rules their stylesheet keeps.
 */

const ui = await import("@/components/ui")
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el)
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "")
const CSS = stripComments(readFileSync("components/ui/ui.css", "utf8"))
const GLOBALS = stripComments(readFileSync("app/globals.css", "utf8"))

/** The body of the first rule whose selector is exactly this one, outside any media block. */
function rule(css: string, selector: string): string {
    const at = css.search(new RegExp(`(^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"))
    expect([selector, at >= 0]).toEqual([selector, true])
    const open = css.indexOf("{", at + 1)
    return css.slice(open + 1, css.indexOf("}", open))
}

/** What's inside the phone's media blocks (up to 767px wide), all of them together. */
function phone(css: string): string {
    const parts: string[] = []
    const head = /@media (screen and )?\(max-width: 767px\) \{/g
    let m: RegExpExecArray | null
    while ((m = head.exec(css))) {
        let depth = 1, i = m.index + m[0].length
        const from = i
        for (; i < css.length && depth > 0; i++) {
            if (css[i] === "{") depth++
            else if (css[i] === "}") depth--
        }
        parts.push(css.slice(from, i - 1))
    }
    return parts.join("\n")
}

describe("the page's one large figure", () => {
    it("is the amount in even-width digits, its unit after it", () => {
        const html = render(h(ui.LargeFigure, { value: "1,340.25", unit: "EGP" }))
        expect(html).toBe('<p class="ui-large-figure"><span class="ui-large-figure-value ui-num">1,340.25</span> <span class="ui-large-figure-unit">EGP</span></p>')
    })

    it("is the amount alone where there's no unit", () => {
        expect(render(h(ui.LargeFigure, { value: "٠" }))).toBe('<p class="ui-large-figure"><span class="ui-large-figure-value ui-num">٠</span></p>')
    })

    it("is --text-hero, weight 600, its unit in --text-lg and --muted", () => {
        const value = rule(CSS, ".ui-large-figure-value")
        expect(value).toMatch(/font-size: var\(--text-hero\);/)
        expect(value).toMatch(/line-height: var\(--leading-hero\);/)
        expect(value).toMatch(/font-weight: 600;/)
        const unit = rule(CSS, ".ui-large-figure-unit")
        expect(unit).toMatch(/font-size: var\(--text-lg\);/)
        expect(unit).toMatch(/color: var\(--muted\);/)
    })

    it("--text-hero is 48 / 56px, and 36 / 44px on phones (DESIGN.md §3.2)", () => {
        expect(GLOBALS).toMatch(/--text-3xl: 28px;\s*--leading-3xl: 34px;\s*--text-hero: 48px;\s*--leading-hero: 56px;/)
        expect(phone(GLOBALS)).toMatch(/:root \{\s*--text-hero: 36px;\s*--leading-hero: 44px;\s*\}/)
    })

    it("nothing else is larger than --text-3xl: only the large figure uses --text-hero", () => {
        expect(CSS.match(/var\(--text-hero\)/g)).toHaveLength(1)
        expect(readFileSync("DESIGN.md", "utf8")).toMatch(/\| `--text-hero` \| 48 \/ 56px, 36 \/ 44px on phones \|/)
    })
})

describe("bars by part", () => {
    const parts = [
        { key: "vat", name: "إقرار القيمة المضافة", value: 600.25, amount: "600.25", note: "45%, 2 claims" },
        { key: "income", name: "إقرار ضريبة الدخل", value: 1075, amount: "1,075.00", note: "55%, 2 claims" },
        { key: "takaful", name: "مساهمة تكافلية", value: 0, amount: "0.00" },
    ]

    it("is a list named for screen readers, a row for each part: its name, its amount and its note", () => {
        const html = render(h(ui.BarsByPart, { label: "What's owed by item", parts }))
        expect(html).toMatch(/^<ul class="ui-bars" aria-label="What&#x27;s owed by item">/)
        expect(html.match(/<li class="ui-bars-row"/g)).toHaveLength(3)
        expect(html).toContain('<span class="ui-bars-name">إقرار ضريبة الدخل</span> ')
        expect(html).toContain('<span class="ui-bars-amount ui-num">1,075.00</span> <span class="ui-bars-note">55%, 2 claims</span>')
        // No note, nothing under the amount.
        expect(html).toMatch(/<span class="ui-bars-amount ui-num">0\.00<\/span><\/li>/)
    })

    it("shows a row's full name and amount when it's pointed at", () => {
        const html = render(h(ui.BarsByPart, { label: "By item", parts }))
        expect(html).toContain('title="إقرار ضريبة الدخل: 1,075.00"')
    })

    it("a part can go by a short name, its full name when pointed at and for screen readers (DESIGN.md §5.5, PR 338)", () => {
        const html = render(h(ui.BarsByPart, { label: "By item", parts: [{ key: "health", name: "مساهمة تكافلية - تأمين صحي", short: "تأمين صحي", value: 40, amount: "40.00" }] }))
        expect(html).toContain('<li class="ui-bars-row" title="مساهمة تكافلية - تأمين صحي: 40.00"><span class="ui-bars-name"><span aria-hidden="true">تأمين صحي</span><span class="ui-visually-hidden">مساهمة تكافلية - تأمين صحي</span></span> ')
        // A part with no short name, or one the same as its name, is its name alone.
        expect(render(h(ui.BarsByPart, { label: "By item", parts: [{ key: "a", name: "رسم تنمية الموارد", value: 4, amount: "4.00" }] }))).toContain('<span class="ui-bars-name">رسم تنمية الموارد</span> ')
        expect(render(h(ui.BarsByPart, { label: "By item", parts: [{ key: "a", name: "رسم تنمية الموارد", short: "رسم تنمية الموارد", value: 4, amount: "4.00" }] }))).toContain('<span class="ui-bars-name">رسم تنمية الموارد</span> ')
    })

    it("the largest first, parts owing the same in the order they came", () => {
        const html = render(h(ui.BarsByPart, { label: "By item", parts: [
            { key: "a", name: "A", value: 50, amount: "50" },
            { key: "b", name: "B", value: 900, amount: "900" },
            { key: "c", name: "C", value: 50, amount: "50" },
        ] }))
        expect([...html.matchAll(/class="ui-bars-name">([^<]+)</g)].map(m => m[1])).toEqual(["B", "A", "C"])
    })

    it("parts with an order of their own keep it", () => {
        const html = render(h(ui.BarsByPart, { label: "How late", ordered: true, parts: [
            { key: "not_due", name: "Not due yet", value: 40, amount: "40" },
            { key: "under_6", name: "Under 6 months", value: 375, amount: "375" },
            { key: "over_2", name: "More than 2 years", value: 0, amount: "0" },
        ] }))
        expect([...html.matchAll(/class="ui-bars-name">([^<]+)</g)].map(m => m[1])).toEqual(["Not due yet", "Under 6 months", "More than 2 years"])
    })

    it("the largest fills the space and the rest are to scale; a part at nothing has no bar", () => {
        const html = render(h(ui.BarsByPart, { label: "By item", parts }))
        expect(html).toMatch(/title="إقرار ضريبة الدخل: 1,075.00"><span class="ui-bars-name">[^<]+<\/span> <span class="ui-bars-track" aria-hidden="true"><span class="ui-bars-bar" style="--part:100%"><\/span><\/span>/)
        expect(html).toMatch(/title="إقرار القيمة المضافة: 600.25">[\s\S]*?<span class="ui-bars-bar" style="--part:55.84%">/)
        expect(html).toMatch(/title="مساهمة تكافلية: 0.00"><span class="ui-bars-name">[^<]+<\/span> <span class="ui-bars-track" aria-hidden="true"><\/span>/)
    })

    it("works out each bar's length from the largest", () => {
        expect(ui.barLengths([200, 50, 0, -5, 0.001])).toEqual([100, 25, null, null, 0])
        expect(ui.barLengths([0, 0])).toEqual([null, null])
        expect(ui.barLengths([])).toEqual([])
        expect(ui.barLengths([3, 1])).toEqual([100, 33.33])
    })

    it("is drawn as DESIGN.md §5.5 says: 8px bars in the brand colour from the start side, the far end rounded, at least 4px long", () => {
        const bar = rule(CSS, ".ui-bars-bar")
        expect(bar).toMatch(/block-size: 8px;/)
        expect(bar).toMatch(/inline-size: max\(4px, var\(--part\)\);/)
        expect(bar).toMatch(/background: var\(--brand\);/)
        expect(bar).toMatch(/border-start-end-radius: 4px;\s*border-end-end-radius: 4px;/)
        expect(bar).not.toMatch(/border-(start|end)-start-radius/)
        // No axis or grid lines: the bar's track has nothing of its own.
        expect(rule(CSS, ".ui-bars-track")).not.toMatch(/background|border/)
    })

    it("its words are in the text colours, never the bar's, and a long name is cut short", () => {
        for (const selector of [".ui-bars-name", ".ui-bars-amount", ".ui-bars-note"]) {
            expect([selector, rule(CSS, selector)]).not.toEqual([selector, expect.stringMatching(/--brand/)])
        }
        expect(rule(CSS, ".ui-bars-name")).toMatch(/text-overflow: ellipsis;/)
    })

    it("in the owner's mockup's sizes: the name in --text-sm and --ink-2, the amount weight 600, the note in --text-xs (PR 338)", () => {
        const name = rule(CSS, ".ui-bars-name")
        expect(name).toMatch(/font-size: var\(--text-sm\);/)
        expect(name).toMatch(/color: var\(--ink-2\);/)
        const amount = rule(CSS, ".ui-bars-amount")
        expect(amount).toMatch(/font-size: var\(--text-sm\);/)
        expect(amount).toMatch(/font-weight: 600;/)
        expect(amount).toMatch(/color: var\(--ink\);/)
        expect(rule(CSS, ".ui-bars-note")).toMatch(/font-size: var\(--text-xs\);[\s\S]*color: var\(--muted\);/)
    })

    it("a name in the other language is cut short at its own end, not its start, and still sits at the row's start", () => {
        // Found in the browser (PR 337): an item's Arabic name on the English page lost its first words.
        const name = rule(CSS, ".ui-bars-name")
        expect(name).toMatch(/unicode-bidi: plaintext;/)
        expect(name).toMatch(/justify-self: start;/)
        expect(name).toMatch(/max-inline-size: 100%;/)
    })

    // From Codex's review (PR 337): a row sizing its own columns gave each bar a track of its own width.
    it("every row shares the list's columns, so every bar is drawn against the same width", () => {
        // The names in a column 140px wide, the amounts and notes up to 150px, as the owner's mockup draws them (PR 338).
        expect(rule(CSS, ".ui-bars")).toMatch(/grid-template-columns: 140px minmax\(0, 1fr\) fit-content\(150px\);/)
        const row = rule(CSS, ".ui-bars-row")
        expect(row).toMatch(/grid-column: 1 \/ -1;/)
        expect(row).toMatch(/grid-template-columns: subgrid;/)
        expect(row).not.toMatch(/grid-template-columns: (?!subgrid)/)
    })

    it("each row is its name, its bar and its amount, with the note under the amount", () => {
        expect(rule(CSS, ".ui-bars-name")).toMatch(/grid-column: 1;\s*grid-row: 1;/)
        expect(rule(CSS, ".ui-bars-track")).toMatch(/grid-column: 2;\s*grid-row: 1;/)
        expect(rule(CSS, ".ui-bars-amount")).toMatch(/grid-column: 3;\s*grid-row: 1;/)
        expect(rule(CSS, ".ui-bars-note")).toMatch(/grid-column: 3;\s*grid-row: 2;/)
    })

    it("on phones the bar goes under the name, the amount to the row's end, the note under the bar", () => {
        const small = phone(CSS)
        expect(small).toMatch(/\.ui-bars \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/)
        expect(small).toMatch(/\.ui-bars-amount \{[^}]*grid-column: 2;/)
        expect(small).toMatch(/\.ui-bars-track \{[^}]*grid-column: 1 \/ -1;\s*grid-row: 2;/)
        expect(small).toMatch(/\.ui-bars-note \{[^}]*grid-column: 1 \/ -1;\s*grid-row: 3;\s*justify-self: start;/)
    })
})

describe("the share bar", () => {
    it("says it in words, the two amounts at its end, over a bar screen readers don't read", () => {
        const html = render(h(ui.ShareBar, { share: 0.157, line: "16% paid", amounts: "210.25 of 1,340.25" }))
        expect(html).toBe(
            '<div class="ui-share"><p class="ui-share-line"><span class="ui-share-words">16% paid</span> <span class="ui-share-amounts ui-num">210.25 of 1,340.25</span></p>'
            + '<span class="ui-share-track" aria-hidden="true"><span class="ui-share-bar" style="--share:15.7%"></span></span></div>',
        )
    })

    it("is never more than full, and empty at nothing", () => {
        expect(render(h(ui.ShareBar, { share: 1.4, line: "All paid" }))).toContain('style="--share:100%"')
        const none = render(h(ui.ShareBar, { share: 0, line: "0% paid" }))
        expect(none).toContain('<span class="ui-share-track" aria-hidden="true"></span>')
        expect(render(h(ui.ShareBar, { share: -1, line: "0% paid" }))).not.toContain("ui-share-bar")
        expect(none).not.toContain("ui-share-amounts")
    })

    it("is a 10px bar of the brand colour on its strong tint, fully rounded", () => {
        const track = rule(CSS, ".ui-share-track")
        expect(track).toMatch(/block-size: 10px;/)
        expect(track).toMatch(/background: var\(--brand-tint-strong\);/)
        expect(track).toMatch(/border-radius: var\(--radius-pill\);/)
        const bar = rule(CSS, ".ui-share-bar")
        expect(bar).toMatch(/inline-size: var\(--share\);/)
        expect(bar).toMatch(/background: var\(--brand\);/)
        expect(bar).toMatch(/border-radius: var\(--radius-pill\);/)
    })

    it("its line in --text-sm, the words weight 500, the amounts muted at its end (PR 338)", () => {
        const line = rule(CSS, ".ui-share-line")
        expect(line).toMatch(/justify-content: space-between;/)
        expect(line).toMatch(/font-size: var\(--text-sm\);/)
        expect(rule(CSS, ".ui-share-words")).toMatch(/font-weight: 500;/)
        expect(rule(CSS, ".ui-share-amounts")).toMatch(/color: var\(--muted\);/)
    })

    it("on phones its amounts go under the bar, in --text-xs, as the owner's mockup draws it (PR 338)", () => {
        const small = phone(CSS)
        expect(small).toMatch(/\.ui-share-line \{\s*display: contents;\s*\}/)
        expect(small).toMatch(/\.ui-share-words \{\s*order: 1;\s*\}/)
        expect(small).toMatch(/\.ui-share-track \{\s*order: 2;\s*\}/)
        expect(small).toMatch(/\.ui-share-amounts \{\s*order: 3;\s*font-size: var\(--text-xs\);/)
    })
})

describe("where they're found", () => {
    it("are building blocks, from components/ui", () => {
        expect(readFileSync("components/ui/index.ts", "utf8")).toMatch(/export \{ BarsByPart, ShareBar, LargeFigure, barLengths, type BarPart \} from '\.\/Bars'/)
    })

    it("are on the building blocks page, in both languages", () => {
        const page = readFileSync("app/(dashboard)/dashboard/ui-kit/page.tsx", "utf8")
        expect(page).toMatch(/<LargeFigure /)
        expect(page).toMatch(/<ShareBar /)
        expect(page).toMatch(/<BarsByPart [^>]*ordered/)
        expect(page).toMatch(/<BarsByPart (?![^>]*ordered)/)
    })
})
