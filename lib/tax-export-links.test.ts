import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { checkTaxFile, type TaxCheck } from "./tax-check"
import type { TaxPosition } from "./tax-claims"
import { fileAtFault, TAX_EXPORT_PAGE, type TaxRefusalProblem } from "./tax-export-page"
import { readTaxSheet, TAX_FILE_HEADINGS as H, type TaxClaimsNow, type TaxFile, type TaxSheetRow } from "./tax-file"

/**
 * The links to the tax portal's export button's page (CLIENT_PORTAL_PLAN.md
 * §10, §12 step 4c; DESIGN.md §5.5, A client's tax position, for the
 * company's people, and Uploading the tax portal's file; PR 320): one link,
 * How to get the portal's file, where the upload is, and where the upload
 * says a file isn't right. That it opens the page, in a new tab from the
 * upload's dialogs, is in the browser flows. The companies and claims here
 * are made up.
 */

const state = { locale: "en", data: undefined as TaxPosition | undefined }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: ([url, scope]: [string, string]) => ({ error: undefined, isLoading: false, isValidating: false, mutate: async () => {}, data: state.data === undefined ? undefined : { scope, url, body: { data: state.data } } }),
}))

type CheckProps = { fileName: string; rows: number; check: TaxCheck; asOf: string; today: string; onAsOf: (day: string) => void; onAnother: () => void }
let Section: (props: { clientId: string; manages?: boolean }) => ReactElement
let Check: (props: CheckProps) => ReactElement
let ExportLink: (props: { newTab?: boolean }) => ReactElement
beforeAll(async () => {
    Section = (await import("@/components/tax/TaxPosition")).default
    Check = (await import("@/components/tax/TaxUploadCheck")).default
    ExportLink = (await import("@/components/tax/TaxExportLink")).default
}, 60_000)
beforeEach(() => {
    state.locale = "en"
    state.data = undefined
})

const SAME_TAB = `<a class="ui-text-link ui-tax-how" href="/dashboard/tax-export">How to get the portal&#x27;s file</a>`
const NEW_TAB = `<a class="ui-text-link ui-tax-how" target="_blank" rel="noopener noreferrer" href="/dashboard/tax-export">How to get the portal&#x27;s file<span class="ui-visually-hidden"> (opens in a new tab)</span></a>`

const POSITION: TaxPosition = {
    // Read 27 days after the day the figures are from: under the 30 from which the line says how long it's been
    // (§4.3, PR 321), which comes between its words and this link (lib/tax-figures-old.test.ts).
    client: { id: "noor", name: "Al Noor", archived: false }, today: "2026-11-10",
    position: { asOf: "2026-10-14", uploadedOn: "2026-10-15", uploadedBy: "Amal One" },
    totals: { original: 100, paid: 0, remaining: 100, open: 1, late: 0 },
    claims: [{
        id: "n1", claimNumber: "000101", item: "إقرار ضريبة الدخل", taxType: "دخل", registrationType: null, originalAmount: 100, paidAmount: 0, remainingAmount: 100,
        currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2026-01-01", periodEnd: "2026-03-31", dueDate: "2026-12-31", daysLate: 0,
    }],
    total: 1, totalPages: 1,
    accountant: { person: null, reach: "none" },
}
const NONE: TaxPosition = { ...POSITION, position: null, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 }
/** With a file uploaded and no open claim in it: the line and the tiles stay. */
const NOTHING_OWED: TaxPosition = { ...NONE, position: POSITION.position }
const section = (manages?: boolean) => renderToStaticMarkup(h(Section, { clientId: "noor", manages }))
/** The line under the section's title. */
const line = (html: string) => /<p class="ui-hint">(.*?)<\/p>/.exec(html)?.[1] ?? ""
/** The empty state's line, under its title. */
const emptyLine = (html: string) => /<p class="ui-empty-detail">(.*?)<\/p>/.exec(html)?.[1] ?? ""
const head = (html: string) => /<div class="ui-section-head">(.*?)<\/div>/.exec(html)?.[1] ?? ""

describe("How to get the portal's file", () => {
    it("goes to the tax portal's export button's page", () => {
        expect(TAX_EXPORT_PAGE).toBe("/dashboard/tax-export")
        expect(renderToStaticMarkup(h(ExportLink, {}))).toBe(SAME_TAB)
    })

    it("opens in a new tab where a dialog is open, and says so to screen readers", () => {
        expect(renderToStaticMarkup(h(ExportLink, { newTab: true }))).toBe(NEW_TAB)
    })

    it("fetches nothing of its page ahead: it's on a page opened often, and seldom pressed", () => {
        const source = readFileSync("components/tax/TaxExportLink.tsx", "utf8")
        expect(source.match(/<Link /g)).toHaveLength(1)
        expect(source).toContain("prefetch={false}")
    })

    it("is said in Arabic, with no command in it", () => {
        state.locale = "ar"
        expect(renderToStaticMarkup(h(ExportLink, {}))).toBe(`<a class="ui-text-link ui-tax-how" href="/dashboard/tax-export">طريقة الحصول على ملف البوابة</a>`)
        expect(renderToStaticMarkup(h(ExportLink, { newTab: true }))).toContain(`طريقة الحصول على ملف البوابة<span class="ui-visually-hidden"> (يفتح في علامة تبويب جديدة)</span>`)
    })

    it("has a heavier underline under the pointer, as every link in a line of text has", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-text-link:hover \{\s*text-decoration-thickness: 2px;\s*\}/)
    })

    it("is 44px under a finger on a phone, laid over its line so no line around it moves", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const phone = /@media \(max-width: 767px\) \{\s*\.ui-text-link\.ui-tax-how \{([^}]*)\}\s*\.ui-text-link\.ui-tax-how::after \{([^}]*)\}\s*\}/.exec(css)
        // Every link in a line of text is, since the small fixes after the client portal's step 6a
        // (lib/phone-taps.test.ts): what's tapped is laid over its line, as wide as the link, and at least 44px (PR 327).
        const every = /@media \(max-width: 767px\) \{\s*\.ui-text-link \{([^}]*)\}\s*\.ui-text-link::after \{([^}]*)\}\s*\}/.exec(css)
        expect(every?.[1]).toContain("position: relative;")
        expect(every?.[2]).toContain("position: absolute;")
        expect(every?.[2]).toContain("inset-inline: min(0px, calc(50% - 22px));")
        // Over the tiles under the section's line, which are placed too and would take its last 2px.
        expect(phone?.[1]).toContain("z-index: 1;")
        // This one 20px above its middle and 24px below, which is 44px. A little low, so that on the section's first
        // line it stops short of the upload's button over it.
        expect(phone?.[2]).toContain("inset-block: calc(50% - 20px) calc(50% - 24px);")
        // Nothing of it is in the line: no height, margin or display of its own. On a computer it's a link in a
        // line of text, and nothing more.
        expect(`${phone?.[1]}${phone?.[2]}${every?.[1]}${every?.[2]}`).not.toMatch(/block-size|height|margin|display/)
        expect(css.match(/\.ui-tax-how\b/g)).toHaveLength(2)
    })

    it("is named for the portal's file in both languages: it's read beside a file that was refused, which isn't the one to get", () => {
        expect(en.tax_export_how).toBe("How to get the portal's file")
        expect(en.tax_export_how).not.toMatch(/this file/i)
        expect(ar.tax_export_how).toBe("طريقة الحصول على ملف البوابة")
        expect(ar.tax_export_how).not.toContain("هذا الملف")
    })
})

describe("On a client's Tax position", () => {
    it("ends the line under the title, for whoever may update tax positions", () => {
        state.data = POSITION
        expect(line(section(true))).toBe(`Figures as of 14 Oct 2026, from the portal&#x27;s file uploaded by <bdi>Amal One</bdi> on 15 Oct 2026. ${SAME_TAB}`)
    })

    it("ends that line where the file had no open claim too", () => {
        state.data = NOTHING_OWED
        expect(line(section(true))).toBe(`Figures as of 14 Oct 2026, from the portal&#x27;s file uploaded by <bdi>Amal One</bdi> on 15 Oct 2026. ${SAME_TAB}`)
    })

    it("ends the empty state's line before the first file", () => {
        state.data = NONE
        expect(emptyLine(section(true))).toBe(`It comes from the tax portal&#x27;s file for this client. ${SAME_TAB}`)
    })

    it("opens in the same tab there, once", () => {
        for (const data of [POSITION, NONE]) {
            state.data = data
            const html = section(true)
            expect(html.split(TAX_EXPORT_PAGE)).toHaveLength(2)
            expect(html).not.toContain("target=")
        }
    })

    it("isn't on the section's heading, which the upload's button fills on a phone", () => {
        for (const data of [POSITION, NONE]) {
            state.data = data
            expect(head(section(true))).toMatch(/<button[^>]*>(<[^>]+>)*Upload from the tax portal/)
            expect(head(section(true))).not.toContain("<a ")
        }
    })

    it("isn't there for someone who only sees the tax position", () => {
        for (const data of [POSITION, NONE]) {
            state.data = data
            expect(section(false)).not.toContain(TAX_EXPORT_PAGE)
            expect(section()).not.toContain(TAX_EXPORT_PAGE)
        }
        state.data = POSITION
        expect(line(section(false))).toBe(`Figures as of 14 Oct 2026, from the portal&#x27;s file uploaded by <bdi>Amal One</bdi> on 15 Oct 2026.`)
        state.data = NONE
        expect(emptyLine(section(false))).toBe(`It comes from the tax portal&#x27;s file for this client.`)
    })

    it("isn't on an archived client, which hasn't the upload", () => {
        for (const data of [POSITION, NONE]) {
            state.data = { ...data, client: { ...data.client, archived: true } }
            expect(section(true)).not.toContain(TAX_EXPORT_PAGE)
        }
    })

    it("isn't there until the section has loaded", () => {
        expect(section(true)).not.toContain(TAX_EXPORT_PAGE)
    })

    it("is said in Arabic, after the line's own words", () => {
        state.locale = "ar"
        state.data = POSITION
        expect(line(section(true))).toMatch(/\. <a class="ui-text-link ui-tax-how" href="\/dashboard\/tax-export">طريقة الحصول على ملف البوابة<\/a>$/)
        state.data = NONE
        expect(emptyLine(section(true))).toBe(`يأتي من ملف بوابة الضرائب الخاص بهذا العميل. <a class="ui-text-link ui-tax-how" href="/dashboard/tax-export">طريقة الحصول على ملف البوابة</a>`)
    })
})

describe("Where the upload refuses a file whole", () => {
    // Every reason a file is refused for, and whether it's the file that's at fault. A reason added later
    // has to be put here too, or this doesn't compile.
    const REASONS: Record<TaxRefusalProblem, boolean> = {
        unreadable: true, too_big: true, empty: true, too_many: true, columns: true, companies: true,
        reader: false, unchecked: false,
    }

    it("is there where the file itself is at fault", () => {
        const atFault = (Object.keys(REASONS) as TaxRefusalProblem[]).filter(fileAtFault)
        expect(atFault.sort()).toEqual(["columns", "companies", "empty", "too_big", "too_many", "unreadable"])
    })

    it("isn't there where the file's reader didn't load, or the client's claims couldn't be read: another file wouldn't help", () => {
        expect(fileAtFault("reader")).toBe(false)
        expect(fileAtFault("unchecked")).toBe(false)
        for (const [problem, shown] of Object.entries(REASONS)) expect(fileAtFault(problem as TaxRefusalProblem), problem).toBe(shown)
    })

    const screen = readFileSync("components/tax/TaxUpload.tsx", "utf8")
    const refused = screen.slice(screen.indexOf("<Dialog open={!!refused}"), screen.indexOf("<Dialog open={stage.at === 'check'}"))

    it("is under the reason, the names and the hint, in a new tab, so the dialog stays as it is", () => {
        expect(refused).toContain("{refusal && fileAtFault(refusal.problem) && <p><TaxExportLink newTab /></p>}")
        expect(refused.indexOf("<TaxExportLink newTab />")).toBeGreaterThan(refused.indexOf("{refused.hint &&"))
        expect(refused.match(/<TaxExportLink/g)).toHaveLength(1)
    })

    it("leaves the focus on Close as the dialog opens, as before: a link in it would otherwise take it", () => {
        expect(refused).toContain("<Button autoFocus onClick={close}>{t('close')}</Button>")
    })

    it("has no link of its own on the upload's button, or in the question it asks", () => {
        expect(screen.match(/<TaxExportLink/g)).toHaveLength(1)
    })
})

describe("Where a row has a problem", () => {
    const ALEF = "شركة ألف للتجارة"
    const HEAD = [H.company, H.taxType, H.item, H.registrationType, H.claimNumber, H.original, H.paid, H.remaining, H.currency, H.status, H.periodStart, H.periodEnd, H.dueDate]
    const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
    const row = (number: unknown) => [ALEF, "دخل", "أقرار تجاري", "", number, 1000, 0, 1000, "جنيه مصري", "في انتظار السداد", day("2025-01-01"), day("2025-12-31"), day("2026-04-30")]
    const file = (...rows: unknown[][]): TaxFile => {
        const read = readTaxSheet([HEAD, ...rows].map((cells, i): TaxSheetRow => ({ line: i + 1, cells })))
        if ("problem" in read) throw new Error(`refused: ${JSON.stringify(read)}`)
        return read
    }
    const NOW: TaxClaimsNow = { client: { id: "noor", name: ALEF }, today: "2026-11-18", uploads: 0, fileCompany: null, claims: [] }
    const check = (read: TaxFile) => renderToStaticMarkup(h(Check, {
        fileName: `مطالبات - ${ALEF} - 2026-11-16.xlsx`, rows: read.rows.length + read.leftOut, check: checkTaxFile(read, NOW), asOf: "2026-11-16", today: "2026-11-18", onAsOf: () => {}, onAnother: () => {},
    }))
    /** The note that stops the save. */
    const note = (html: string) => /<div class="ui-dialog-note" data-tone="problem" role="alert">(.*?)<\/div>/.exec(html)?.[1] ?? ""

    // As a copy of the button older than step 4a wrote it: a claim's number with no zero at its start, as a number.
    const OLD_BUTTONS = () => file(row(316000001), row("000316000002"))

    it("ends the note that stops the save, in a new tab", () => {
        const html = check(OLD_BUTTONS())
        expect(note(html)).toMatch(/^<p>Rows with a problem: 1\. /)
        expect(note(html).endsWith(`</p><p>${NEW_TAB}</p>`)).toBe(true)
        expect(html.split(TAX_EXPORT_PAGE)).toHaveLength(2)
    })

    it("comes after Another file, which keeps the focus as the screen opens", () => {
        const html = check(OLD_BUTTONS())
        expect(html.indexOf("Another file")).toBeGreaterThan(-1)
        expect(html.indexOf("Another file")).toBeLessThan(html.indexOf(TAX_EXPORT_PAGE))
    })

    it("is under words that name the older copy too: a number kept as a number isn't only Excel's doing", () => {
        expect(en.tax_mistake_number_as_number).toMatch(/opened in Excel and saved, or comes from an older copy of the export button\.$/)
        expect(ar.tax_mistake_number_as_number).toMatch(/أو حين يكون من نسخة أقدم من زر التصدير\.$/)
        const html = check(OLD_BUTTONS())
        expect(html.replace(/<[^>]+>/g, " ")).toContain("or comes from an older copy of the export button.")
        expect(html.indexOf("older copy of the export button")).toBeGreaterThan(html.indexOf(TAX_EXPORT_PAGE))
    })

    it("isn't on a file with nothing wrong in it", () => {
        const html = check(file(row("000316000001"), row("000316000002")))
        expect(html).not.toContain(TAX_EXPORT_PAGE)
        expect(html).not.toContain(`data-tone="problem"`)
    })

    it("is said in Arabic", () => {
        state.locale = "ar"
        expect(note(check(OLD_BUTTONS()))).toContain(`طريقة الحصول على ملف البوابة<span class="ui-visually-hidden"> (يفتح في علامة تبويب جديدة)</span></a></p>`)
    })
})
