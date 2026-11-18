import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { checkTaxFile, type TaxCheck } from "./tax-check"
import { readTaxSheet, TAX_FILE_HEADINGS as H, type ClaimDraft, type TaxClaimsNow, type TaxFile, type TaxMistakeCode, type TaxSheetRow } from "./tax-file"

/**
 * The upload's check screen (CLIENT_PORTAL_PLAN.md §4.1, §15; DESIGN.md §5.5,
 * Uploading the tax portal's file; PR 316): what it says of a file before
 * anything is saved. The companies and claims here are made up.
 */

const state = { locale: "en" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))

type Props = { fileName: string; rows: number; check: TaxCheck; asOf: string; today: string; busy?: boolean; onAsOf: (day: string) => void; onAnother: () => void }
let Check: (props: Props) => ReactElement
beforeAll(async () => {
    Check = (await import("@/components/tax/TaxUploadCheck")).default
}, 60_000)
beforeEach(() => { state.locale = "en" })

const ALEF = "شركة ألف للتجارة"
const FILE = `مطالبات - ${ALEF} - 2026-11-16.xlsx`
const HEAD = [H.company, H.taxType, H.item, H.registrationType, H.claimNumber, H.original, H.paid, H.remaining, H.currency, H.status, H.periodStart, H.periodEnd, H.dueDate]
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const row = (number: unknown, original: unknown, paid: unknown, remaining: unknown, over: Record<number, unknown> = {}) =>
    Object.assign([ALEF, "دخل", "أقرار تجاري", "", number, original, paid, remaining, "جنيه مصري", "في انتظار السداد", day("2025-01-01"), day("2025-12-31"), day("2026-04-30")], over)
const file = (...rows: unknown[][]): TaxFile => {
    const read = readTaxSheet([HEAD, ...rows].map((cells, i): TaxSheetRow => ({ line: i + 1, cells })))
    if ("problem" in read) throw new Error(`refused: ${JSON.stringify(read)}`)
    return read
}
const claim = (claimNumber: string, originalAmount: number, paidAmount: number, remainingAmount: number): ClaimDraft => ({
    claimNumber, item: "أقرار تجاري", taxType: "دخل", registrationType: null, originalAmount, paidAmount, remainingAmount,
    currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30",
})
const now = (claims: ClaimDraft[], over: Partial<TaxClaimsNow> = {}): TaxClaimsNow =>
    ({ client: { id: "noor", name: ALEF }, today: "2026-11-18", uploads: claims.length ? 1 : 0, fileCompany: null, claims, ...over })

const render = (read: TaxFile, basis: TaxClaimsNow, over: Partial<Props> = {}) => renderToStaticMarkup(h(Check, {
    fileName: FILE, rows: read.rows.length + read.leftOut, check: checkTaxFile(read, basis), asOf: "2026-11-16", today: "2026-11-18", onAsOf: () => {}, onAnother: () => {}, ...over,
}))
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/[⁨⁩]/g, "").replace(/\s+/g, " ").trim()
const tiles = (html: string) => [...html.matchAll(/<dt>(.*?)<\/dt><dd>(.*?)<\/dd>/g)].map(m => [m[1], m[2]])

// One claim as it was, one paid in part since, one the file hasn't, and one new.
const BEFORE = [claim("000101", 1000, 0, 1000), claim("000102", 21088.26, 0, 21088.26), claim("000103", 8.45, 0, 8.45)]
const NEXT = () => file(row("000101", 1000, 0, 1000), row("000102", 21088.26, 7365, 13723.26), row("000104", 56.7, 0, 56.7))

describe("the file, at the top", () => {
    it("says its name and how many rows it has, with Another file", () => {
        const html = render(NEXT(), now(BEFORE))
        expect(html).toContain(`<span class="ui-tax-file-name"><bdi>${FILE}</bdi></span>`)
        expect(words(html)).toContain("3 rows in the file")
        expect(html).toMatch(/<button[^>]*>(<[^>]+>)*Another file/)
    })

    it("says which company it names, and whether that's this client", () => {
        expect(words(render(NEXT(), now(BEFORE)))).toContain(`Company in the file: ${ALEF} This client`)
        const other = file(row("000101", 1000, 0, 1000, { 0: "شركة باء" }))
        expect(words(render(other, now([])))).toContain("Company in the file: شركة باء Not this client's name")
        expect(render(other, now([]))).toContain("<bdi>شركة باء</bdi>")
        // The name its last file gave is this client too.
        expect(words(render(other, now([], { fileCompany: "شركه باء" })))).toContain("شركة باء This client")
        const none = file(row("000101", 1000, 0, 1000, { 0: "غير محدد" }))
        expect(words(render(none, now([])))).toContain("Company in the file: No company named")
    })
})

describe("the day the figures are from", () => {
    it("is a date field with the day it starts on, to today at the latest", () => {
        const html = render(NEXT(), now(BEFORE))
        expect(words(html)).toContain("Figures as of")
        expect(words(html)).toContain("The day in the file's name, or today where it has none. It can be changed, to today at the latest.")
        // The day itself is drawn in the browser, on the reader's calendar: the field is given it, and today as its last day.
        const source = readFileSync("components/tax/TaxUploadCheck.tsx", "utf8")
        expect(source).toContain("value={asOf}")
        expect(source).toContain("maxDate={today}")
    })

    it("asks for one where it's been cleared", () => {
        expect(words(render(NEXT(), now(BEFORE), { asOf: "" }))).toContain("Pick the day the figures are from.")
    })
})

describe("what the file would change", () => {
    it("counts what's in it, new, changed, as it was and going", () => {
        expect(tiles(render(NEXT(), now(BEFORE)))).toEqual([["In the file", "3"], ["New", "1"], ["Changed", "1"], ["As they were", "1"], ["Going", "1"]])
    })

    it("says what's owed now, and what will be after saving", () => {
        expect(words(render(NEXT(), now(BEFORE)))).toContain("Owed now: 22,096.71 EGP. After saving: 14,779.96 EGP.")
    })

    it("lists what's going first, with why it may be, then what changed with what was and is, then what's new", () => {
        const html = render(NEXT(), now(BEFORE))
        const said = words(html)
        const at = ["Going, as they aren't in the file (1)", "Changed (1)", "New (1)"].map(title => said.indexOf(title))
        expect(at.every(index => index > -1)).toBe(true)
        expect([...at].sort((a, b) => a - b)).toEqual(at)
        expect(said).toContain("They may have been paid, or hidden by a filter on the portal when the file was exported.")
        expect(said).toContain("Paid was 0.00 EGP, now 7,365.00 EGP")
        expect(said).toContain("Remaining was 21,088.26 EGP, now 13,723.26 EGP")
        // Each claim by its number, as it's typed into the portal, its item and what remains.
        expect(html).toContain(`<bdi dir="ltr" class="ui-num">000103</bdi>`)
        expect(said).toMatch(/000103 أقرار تجاري 8\.45 EGP/)
        expect(said).toMatch(/000104 أقرار تجاري 56\.70 EGP/)
        // What stays as it was is counted, not listed.
        expect(html).not.toContain(">000101<")
    })

    it("leaves out a group with nothing in it", () => {
        const said = words(render(file(row("000101", 1000, 0, 1000)), now([claim("000101", 1000, 0, 1000)])))
        for (const title of ["Going, as they", "Changed (", "New ("]) expect(said).not.toContain(title)
    })

    it("has a group of ten or fewer open to start with, and a longer one closed", () => {
        const many = (count: number) => file(...Array.from({ length: count }, (_, i) => row(String(i).padStart(6, "0"), 10, 0, 10)))
        expect(render(many(10), now([]))).toMatch(/<details class="ui-tax-group" open="">/)
        const closed = render(many(11), now([]))
        expect(closed).toContain(`<details class="ui-tax-group">`)
        expect(words(closed)).toContain("New (11)")
    })

    it("says how many rows were left out as paid, and for each other status", () => {
        const said = words(render(file(
            row("000101", 1000, 0, 1000), row("000102", 50, 50, 0), row("000103", 60, 60, 0), row("000104", 70, 0, 70, { 9: "ملغي" }),
        ), now([])))
        expect(said).toContain("Rows left out, with nothing left to pay: 2")
        expect(said).toMatch(/Rows left out, with the status ملغي ?: 1/)
        expect(words(render(NEXT(), now(BEFORE)))).not.toContain("Rows left out")
    })
})

describe("a row with a problem", () => {
    const wrong = () => file(row("000101", 1000, 0, 1000), row("000102", 21088.26, 7365, 13723), row(372601708, 56.7, 0, 56.7), row("", 5, 0, 5))

    it("stops the save: a note says how many rows have one, and why nothing is saved", () => {
        const html = render(wrong(), now(BEFORE))
        expect(html).toMatch(/<div class="ui-dialog-note" data-tone="problem" role="alert">/)
        expect(words(html)).toContain("Rows with a problem: 3. Nothing can be saved until the file is fixed or exported again, as saving the rest would delete their claims.")
    })

    it("lists each with its line in the file, its claim's number and what's wrong", () => {
        const html = render(wrong(), now(BEFORE))
        const said = words(html)
        expect(said).toContain("Row 3, claim 000102 Paid and remaining don't add up to the original.")
        expect(said).toContain("Row 4, claim 372601708 Its claim number is kept as a number, so zeros at its start may have been lost.")
        expect(said).toContain("Row 5 It has no claim number.")
        expect(html).toContain(`<bdi dir="ltr" class="ui-num">372601708</bdi>`)
    })

    it("says nothing of what the file would change, as it can't be saved", () => {
        const html = render(wrong(), now(BEFORE))
        expect(tiles(html)).toEqual([])
        for (const gone of ["Figures as of", "Owed now", "Going, as they", "Company in the file"]) expect(words(html)).not.toContain(gone)
        // The file is still named, with Another file.
        expect(html).toContain(FILE)
        expect(html).toMatch(/<button[^>]*>(<[^>]+>)*Another file/)
    })

    it("has words for each thing that can be wrong, with what the file had, in both languages", () => {
        const all: [TaxMistakeCode, string | undefined][] = [
            ["number_missing", undefined], ["number_as_number", "372601708"], ["number_too_long", undefined], ["number_twice", "9"],
            ["item_missing", undefined], ["due_missing", undefined], ["due_unreadable", "soon"], ["period_unreadable", "Q1"], ["period_backwards", undefined],
            ["amount_missing", undefined], ["amount_unreadable", "12,50"], ["amount_negative", undefined], ["amounts_dont_add_up", undefined], ["text_too_long", H.item],
        ]
        const check: TaxCheck = { ...checkTaxFile(file(row("000101", 1000, 0, 1000)), now([])), problems: all.map(([code, detail], i) => ({ line: i + 2, claimNumber: "000101", mistakes: [{ code, detail }] })) }
        for (const locale of ["en", "ar"]) {
            state.locale = locale
            const said = words(renderToStaticMarkup(h(Check, { fileName: FILE, rows: 14, check, asOf: "2026-11-16", today: "2026-11-18", onAsOf: () => {}, onAnother: () => {} })))
            expect(said, locale).not.toMatch(/tax_mistake_|\{[a-z]+\}/)
            for (const had of ["soon", "Q1", "12,50", H.item]) expect(said, `${locale} ${had}`).toContain(had)
        }
        state.locale = "en"
        const said = words(renderToStaticMarkup(h(Check, { fileName: FILE, rows: 14, check, asOf: "2026-11-16", today: "2026-11-18", onAsOf: () => {}, onAnother: () => {} })))
        expect(said).toContain("Its claim number is also on row 9.")
        expect(said).toContain("An amount isn't a number to the piastre: 12,50")
        expect(said).toContain(`Longer than 200 characters: ${H.item}`)
    })
})

describe("what the file had, in a mistake's words", () => {
    it("is put in as it was, whatever it was", () => {
        const check: TaxCheck = { ...checkTaxFile(file(row("000101", 1000, 0, 1000)), now([])), problems: [{ line: 2, claimNumber: "000101", mistakes: [{ code: "amount_unreadable", detail: "$& $1 $$ {had}" }] }] }
        const said = words(renderToStaticMarkup(h(Check, { fileName: FILE, rows: 1, check, asOf: "2026-11-16", today: "2026-11-18", onAsOf: () => {}, onAnother: () => {} })))
        expect(said).toContain("An amount isn't a number to the piastre: $& $1 $$ {had}")
    })
})

describe("in Arabic", () => {
    it("counts in the page's digits, and keeps a claim's number as it's typed into the portal", () => {
        state.locale = "ar"
        const html = render(NEXT(), now(BEFORE))
        const said = words(html)
        expect(said).toContain("٣ صفوف في الملف")
        expect(tiles(html)).toEqual([["في الملف", "٣"], ["جديدة", "١"], ["تغيّرت", "١"], ["كما هي", "١"], ["ستُحذف", "١"]])
        expect(said).toContain("ستُحذف لأنها ليست في الملف (١)")
        expect(html).toContain(`<bdi dir="ltr" class="ui-num">000103</bdi>`)
        expect(said).toContain("هذا العميل")
    })
})

describe("while it's sent", () => {
    it("has Another file and the day off", () => {
        const html = render(NEXT(), now(BEFORE), { busy: true })
        expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(<[^>]+>)*Another file/)
        expect((html.match(/disabled=""/g) ?? []).length).toBeGreaterThanOrEqual(2)
    })
})
