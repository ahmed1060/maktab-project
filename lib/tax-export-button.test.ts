import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { TAX_EXPORT_CODE, TAX_EXPORT_CORE, taxExportBookmark } from "./tax-export-button"
import { readTaxFile } from "./tax-file-read"
import { claimOf, dayFromFileName, namedCompany, remainingOf, TAX_FILE_HEADINGS as H, UNNAMED_COMPANY, type ClaimDraft, type TaxFile } from "./tax-file"

/**
 * The tax portal's export button, in Nizmo (CLIENT_PORTAL_PLAN.md §10, §12
 * step 4a, §15, PR 318). Three things are checked here, on every push:
 *
 * - its code as text: that it stands alone, sends nothing anywhere, and is
 *   what its bookmark holds;
 * - the part of it that needs no page, run as it is: how a cell's words are
 *   read, its file's name, and the file it writes, read with Nizmo's reader;
 * - what a browser did with it. `scripts/tax-export-browser-run.mjs` presses
 *   the bookmark on a page laid out like the portal's, and keeps the files
 *   it saves in `lib/tax-export-fixtures` with the code's fingerprint. Those
 *   files are read here with Nizmo's reader, and code changed since it was
 *   tried in a browser fails.
 *
 * Every company and claim here is made up.
 */

type Cell = { t: "s"; v: string } | { t: "n"; v: number; orig?: number } | { t: "d"; v: string }
/** What the button keeps of a page once it has read its table. */
type Gathered = { headers: string[]; rows: { key: string; company: string; cells: Record<string, Cell> }[] }
type Core = {
    NUMBER_HEADER: string
    companyOf(title: string): string
    textCell(header: string, text: string): Cell
    fileName(company: string, day: string): string
    buildXlsx(state: Gathered): Blob
}

/** The part that needs no page, run as it's written. */
const core = new Function(`${TAX_EXPORT_CORE}\nreturn { NUMBER_HEADER: NUMBER_HEADER, companyOf: companyOf, textCell: textCell, fileName: fileName, buildXlsx: buildXlsx }`)() as Core

const ALEF = "شركة ألف للتجارة"
const BAA = "شركة باء للتوريدات"
const WAITING = "في انتظار السداد"
/** As the portal spells it, which isn't how Nizmo does. */
const PARTLY = "مسدد جزئياً"
const POUND = "جنيه مصري"
const LEGAL = "أشخاص اعتبارية"
const HEALTH = "مساهمة تكافلية- تأمين صحي"

const day = (v: string): Cell => ({ t: "d", v })
const HEADERS = [H.taxType, H.item, H.registrationType, H.claimNumber, H.amount, H.currency, H.status, H.periodStart, H.periodEnd, H.dueDate]

/** A page's rows as the button keeps them: words as its own reading of a cell gives them, days and amounts paid in part as given. */
function gathered(company: string, table: (string | Cell)[][]): Gathered {
    return {
        headers: HEADERS,
        rows: table.map((cells, at) => ({
            key: `${company}|${at}`,
            company,
            cells: Object.fromEntries(HEADERS.map((header, i) => { const cell = cells[i]; return [header, typeof cell === "string" ? core.textCell(header, cell) : cell] })),
        })),
    }
}

const bytesOf = async (state: Gathered) => new Uint8Array(await core.buildXlsx(state).arrayBuffer())
/** A file as Nizmo's reader takes it: it isn't refused, and no row has a mistake. */
async function taken(bytes: Uint8Array): Promise<TaxFile> {
    const file = await readTaxFile(bytes)
    if ("problem" in file) throw new Error(`refused: ${JSON.stringify(file)}`)
    expect(file.rows.flatMap(row => row.mistakes)).toEqual([])
    return file
}
const claimsOf = (file: TaxFile) => file.rows.map(claimOf)

// Company Alef's claims on the page the browser run opens, as Nizmo reads them back.
const A1: ClaimDraft = { claimNumber: "000111000001", item: "أقرار تجاري", taxType: "دخل", registrationType: LEGAL, originalAmount: 21088.26, paidAmount: 7365, remainingAmount: 13723.26, currency: POUND, status: PARTLY, periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30" }
const A2: ClaimDraft = { claimNumber: "000111000002", item: HEALTH, taxType: "دخل", registrationType: LEGAL, originalAmount: 7029.42, paidAmount: 0, remainingAmount: 7029.42, currency: POUND, status: WAITING, periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30" }
const A3: ClaimDraft = { claimNumber: "000111000003", item: HEALTH, taxType: "دخل", registrationType: LEGAL, originalAmount: 13195.5, paidAmount: 0, remainingAmount: 13195.5, currency: POUND, status: WAITING, periodStart: "2024-01-01", periodEnd: "2024-12-31", dueDate: "2025-04-30" }
// Its period is a dash on the page: an empty cell.
const A4: ClaimDraft = { claimNumber: "000111000004", item: "مساهمه تكافليه لصندوق أسر الشهداء", taxType: "دخل", registrationType: LEGAL, originalAmount: 9.45, paidAmount: 0, remainingAmount: 9.45, currency: POUND, status: WAITING, periodStart: null, periodEnd: null, dueDate: "2025-12-15" }
// Its number has no zero at its start.
const A6: ClaimDraft = { claimNumber: "111000000006", item: "إقرار شهري", taxType: "قيمة مضافة", registrationType: LEGAL, originalAmount: 1250, paidAmount: 0, remainingAmount: 1250, currency: POUND, status: WAITING, periodStart: "2025-12-01", periodEnd: "2025-12-31", dueDate: "2026-01-31" }
const B9: ClaimDraft = { claimNumber: "000222000009", item: "مساهمه تكافليه لصندوق أسر الشهداء", taxType: "دخل", registrationType: LEGAL, originalAmount: 9.45, paidAmount: 0, remainingAmount: 9.45, currency: POUND, status: WAITING, periodStart: null, periodEnd: null, dueDate: "2025-12-15" }
const N1: ClaimDraft = { claimNumber: "000333000001", item: "أقرار تجاري", taxType: "دخل", registrationType: LEGAL, originalAmount: 300, paidAmount: 0, remainingAmount: 300, currency: POUND, status: WAITING, periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30" }

describe("The tax portal's export button: its code (CLIENT_PORTAL_PLAN.md §10, PR 318)", () => {
    it("is a script that stands alone: one function, run at once", () => {
        // Read as a script, not run: there's no page here for it.
        expect(() => new Function(TAX_EXPORT_CODE)).not.toThrow()
        expect(TAX_EXPORT_CODE).toMatch(/^\/\*[^]*?\*\/\n\(function \(\) \{\n {2}'use strict';\n/)
        expect(TAX_EXPORT_CODE.endsWith("\n})();\n")).toBe(true)
        // A file from Windows has two characters at each line's end, which a bookmark would carry.
        expect(TAX_EXPORT_CODE).not.toContain("\r")
        // The part that needs no page is in it as it's tested here.
        expect(TAX_EXPORT_CODE).toContain(TAX_EXPORT_CORE)
    })

    it("sends nothing anywhere: it reads the page and saves a file on the computer (§10)", () => {
        for (const way of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "import(", "importScripts", "<script", "<img", "<iframe", "<form", ".src", "postMessage", "window.open", "location.", "navigator.", "eval(", "new Function"]) {
            expect(TAX_EXPORT_CODE, way).not.toContain(way)
        }
        // The one link it makes is to the file it built, on the computer: made, pressed and taken away.
        expect(TAX_EXPORT_CODE).toContain("a.href = URL.createObjectURL(buildXlsx(state));")
        expect(TAX_EXPORT_CODE.split(".href").length - 1).toBe(2)
        // The addresses in it are the names a sheet's parts go by, written into the file and never asked for.
        const addresses = TAX_EXPORT_CODE.match(/https?:\/\/[^"'\s<>]+/g) ?? []
        expect(addresses.length).toBeGreaterThan(0)
        expect(addresses.filter(address => !address.startsWith("http://schemas.openxmlformats.org/"))).toEqual([])
    })

    it("keeps what it gathers under its own name in the browser, and removes what the copy before it kept (§12 step 4)", () => {
        // That copy kept a claim's number as a number, so what it kept isn't read by this one.
        expect(TAX_EXPORT_CODE.match(/etaClaimsExport_v\d+/g)).toEqual(["etaClaimsExport_v2", "etaClaimsExport_v1"])
        expect(TAX_EXPORT_CODE).toContain("var STORE = 'etaClaimsExport_v2';")
        expect(TAX_EXPORT_CODE).toContain("localStorage.removeItem('etaClaimsExport_v1')")
        for (const elsewhere of ["sessionStorage", "indexedDB", "document.cookie"]) expect(TAX_EXPORT_CODE, elsewhere).not.toContain(elsewhere)
    })

    it("has the owner's words on its panel (§10)", () => {
        for (const words of ["تصدير المطالبات إلى Excel", "اسم الشركة", "سحب كل الصفحات", "تنزيل Excel", "مسح", "اتجمعت كل النتائج", "إجمالي النتائج"]) expect(TAX_EXPORT_CODE, words).toContain(words)
    })
})

describe("The tax portal's export button: its bookmark", () => {
    const START = "javascript:"

    it("is the code as a javascript: address, which reads back as the code", () => {
        const bookmark = taxExportBookmark()
        expect(bookmark.startsWith(START)).toBe(true)
        // Nothing in it that an address is cut at, or that a page's link would end at.
        expect(bookmark.slice(START.length)).toMatch(/^[A-Za-z0-9\-_.!~*'()%]+$/)
        expect(decodeURIComponent(bookmark.slice(START.length))).toBe(TAX_EXPORT_CODE)
    })

    it("is short enough to be kept as a bookmark", () => {
        // Firefox keeps no address longer than this in a bookmark; Chrome's limit is far above it.
        expect(taxExportBookmark().length).toBeLessThan(65536)
    })
})

describe("The tax portal's export button: the part that needs no page", () => {
    it("reads a claim's number as text, whatever it looks like (§12 step 4)", () => {
        expect(core.NUMBER_HEADER).toBe(H.claimNumber)
        // With zeros at its start, with none, in Arabic's digits, or short.
        for (const number of ["000111000001", "111000000006", "٠٠٠١١١٠٠٠٠٠١", "12"]) expect(core.textCell(H.claimNumber, number)).toEqual({ t: "s", v: number })
    })

    it("reads an amount as a number, in either kind of digits, and words as words", () => {
        expect(core.textCell(H.amount, "7,029.42")).toEqual({ t: "n", v: 7029.42 })
        expect(core.textCell(H.amount, "٧٬٠٢٩٫٤٢")).toEqual({ t: "n", v: 7029.42 })
        expect(core.textCell(H.amount, "500.00")).toEqual({ t: "n", v: 500 })
        // A dash is an empty cell.
        expect(core.textCell(H.periodStart, "-")).toEqual({ t: "s", v: "" })
        expect(core.textCell(H.periodStart, "—")).toEqual({ t: "s", v: "" })
        expect(core.textCell(H.status, WAITING)).toEqual({ t: "s", v: WAITING })
    })

    it("names the company from the page's title", () => {
        expect(core.companyOf(`المدفوعات - ${ALEF} | مساحة عمل الممول`)).toBe(ALEF)
        // A dash inside the name stays in it.
        expect(core.companyOf("المدفوعات - ألف - فرع المعادي | مساحة عمل الممول")).toBe("ألف - فرع المعادي")
        // No title, no name: the panel then has غير محدد, unless one is typed.
        expect(core.companyOf("")).toBe("")
    })

    it("names its file for the company and the day, which Nizmo reads the day from (§4.1)", () => {
        const name = core.fileName(ALEF, "2026-11-18")
        expect(name).toBe(`مطالبات - ${ALEF} - 2026-11-18.xlsx`)
        expect(dayFromFileName(name, "2026-11-18")).toBe("2026-11-18")
        // What a file's name can't have becomes a dash.
        expect(core.fileName('ألف / باء: "جيم"', "2026-11-18")).toBe("مطالبات - ألف - باء- -جيم- - 2026-11-18.xlsx")
    })

    it("writes a file Nizmo's reader takes, with one amount column where nothing was paid in part", async () => {
        const file = await taken(await bytesOf(gathered(ALEF, [
            ["دخل", HEALTH, LEGAL, "000111000002", "7,029.42", POUND, WAITING, day("2025-01-01"), day("2025-12-31"), day("2026-04-30")],
            ["دخل", "مساهمه تكافليه لصندوق أسر الشهداء", LEGAL, "000111000004", "9.45", POUND, WAITING, "-", "-", day("2025-12-15")],
            // Paid: its row is in the file, and Nizmo leaves it out.
            ["دخل", "أقرار تجاري", LEGAL, "000111000005", "500.00", POUND, "مسدد", day("2023-01-01"), day("2023-12-31"), day("2024-04-30")],
        ])))
        expect(file.company).toBe(ALEF)
        expect(claimsOf(file)).toEqual([A2, A4])
        expect(file.leftOut).toBe(1)
        expect(file.otherStatuses).toEqual([{ status: "مسدد", rows: 1 }])
    })

    it("writes the original, the paid and the remaining where a claim was paid in part", async () => {
        const file = await taken(await bytesOf(gathered(ALEF, [
            // As the page part reads an amount struck through with another after it.
            ["دخل", "أقرار تجاري", LEGAL, "000111000001", { t: "n", v: 13723.26, orig: 21088.26 }, POUND, PARTLY, day("2025-01-01"), day("2025-12-31"), day("2026-04-30")],
            ["دخل", HEALTH, LEGAL, "000111000002", "7,029.42", POUND, WAITING, day("2025-01-01"), day("2025-12-31"), day("2026-04-30")],
        ])))
        expect(claimsOf(file)).toEqual([A1, A2])
        expect(remainingOf(file.rows.map(row => ({ remainingAmount: row.remainingAmount ?? 0 })))).toBe(20752.68)
    })

    it("writes every claim number as text, so none is refused as a number that may have lost its zeros (§12 step 4, §15)", async () => {
        const row = (number: string | Cell): (string | Cell)[] => ["قيمة مضافة", "إقرار شهري", LEGAL, number, "1,250.00", POUND, WAITING, day("2025-12-01"), day("2025-12-31"), day("2026-01-31")]
        expect(claimsOf(await taken(await bytesOf(gathered(ALEF, [row("111000000006")]))))).toEqual([A6])

        // As the copy before this one kept it: a number, which the upload refuses.
        const before = await readTaxFile(await bytesOf(gathered(ALEF, [row({ t: "n", v: 111000000006 })])))
        expect("problem" in before ? [] : before.rows.map(found => found.mistakes)).toEqual([[{ code: "number_as_number", detail: "111000000006" }]])
    })

    it("keeps a name's marks as they are, and writes the word for a page that names no company", async () => {
        const marked = 'ألف & باء "للتجارة" <مصر>'
        const row: (string | Cell)[] = ["دخل", "أقرار تجاري", LEGAL, "000333000001", "300.00", POUND, WAITING, day("2025-01-01"), day("2025-12-31"), day("2026-04-30")]
        expect((await taken(await bytesOf(gathered(marked, [row])))).company).toBe(marked)

        const unnamed = await taken(await bytesOf(gathered(UNNAMED_COMPANY, [row])))
        expect(claimsOf(unnamed)).toEqual([N1])
        // Nizmo keeps no such name: saving asks first (§4.1).
        expect(namedCompany(unnamed.company)).toBeNull()
    })
})

describe("The tax portal's export button: tried in a browser (scripts/tax-export-browser-run.mjs)", () => {
    const FIXTURES = "lib/tax-export-fixtures"
    type Run = { code: string; page: string; script: string; clock: string; day: string; checks: string[]; files: { file: string; savedAs: string; sha256: string }[] }
    const run = JSON.parse(readFileSync(`${FIXTURES}/run.json`, "utf8")) as Run
    const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex")
    const saved = (file: string) => new Uint8Array(readFileSync(`${FIXTURES}/${file}`))

    it("was tried as it is now: the files here were saved by this very code", () => {
        // After any change to the button: `node scripts/tax-export-browser-run.mjs`, which tries it in a browser and saves them again.
        expect(run.code, "the button's code changed since it was tried in a browser").toBe(sha256(TAX_EXPORT_CODE))
        // On this page, and by this run: a change to either is tried again too. Whichever line ends they were checked out with.
        const print = (file: string) => sha256(readFileSync(file, "utf8").replace(/\r\n/g, "\n"))
        expect(run.page, "the page the button is tried on changed since").toBe(print(`${FIXTURES}/portal.html`))
        expect(run.script, "the run changed since").toBe(print("scripts/tax-export-browser-run.mjs"))
    })

    it("passed every check of the run (§15)", () => {
        expect(run.checks).toEqual([
            "bookmark-runs",
            "one-page",
            "every-page",
            "count-matches",
            "numbers-as-text",
            "days-are-cairos",
            "pressed-twice",
            "filter-first",
            "filter-changed",
            "partly-paid",
            "same-filter-again",
            "other-filter-new-visit",
            "other-company-same-tab",
            "other-company-new-visit",
            "older-copy-removed",
            "clear",
            "no-company",
            "no-table",
            "file-name-cairo-day",
            "sends-nothing",
        ])
    })

    it("kept the files it saved as they were saved", () => {
        expect(run.files.map(({ file }) => file)).toEqual(["one-page.xlsx", "every-page.xlsx", "filter-waiting.xlsx", "filter-partly-paid.xlsx", "no-company.xlsx"])
        for (const { file, sha256: print } of run.files) expect(sha256(saved(file)), file).toBe(print)
    })

    it("named each file for its company and Cairo's day, when UTC's was still the day before (§10)", () => {
        // The browser's clock was set to half past midnight in Cairo.
        expect(run.clock).toBe("2026-11-17T22:30:00.000Z")
        expect(run.day).toBe("2026-11-18")
        expect(Object.fromEntries(run.files.map(({ file, savedAs }) => [file, savedAs]))).toEqual({
            "one-page.xlsx": `مطالبات - ${BAA} - 2026-11-18.xlsx`,
            "every-page.xlsx": `مطالبات - ${ALEF} - 2026-11-18.xlsx`,
            "filter-waiting.xlsx": `مطالبات - ${ALEF} - 2026-11-18.xlsx`,
            "filter-partly-paid.xlsx": `مطالبات - ${ALEF} - 2026-11-18.xlsx`,
            "no-company.xlsx": `مطالبات - ${UNNAMED_COMPANY} - 2026-11-18.xlsx`,
        })
        // The day Nizmo takes the figures to be from (§4.1).
        for (const { savedAs } of run.files) expect(dayFromFileName(savedAs, run.day), savedAs).toBe(run.day)
    })

    it("saved one company's one page", async () => {
        const file = await taken(saved("one-page.xlsx"))
        expect(file.company).toBe(BAA)
        expect(claimsOf(file)).toEqual([B9])
        expect(file.leftOut).toBe(0)
    })

    it("saved every page of a company's claims, its paid one left out by Nizmo", async () => {
        const file = await taken(saved("every-page.xlsx"))
        expect(file.company).toBe(ALEF)
        // Three pages of two, in the portal's order. One was paid in part, so the amounts are in three columns.
        expect(claimsOf(file)).toEqual([A1, A2, A3, A4, A6])
        expect(file.leftOut).toBe(1)
        expect(file.otherStatuses).toEqual([{ status: "مسدد", rows: 1 }])
        expect(remainingOf(file.rows.map(row => ({ remainingAmount: row.remainingAmount ?? 0 })))).toBe(35207.63)
    })

    it("saved what the portal's filter showed, and no more", async () => {
        const waiting = await taken(saved("filter-waiting.xlsx"))
        expect(waiting.company).toBe(ALEF)
        expect(claimsOf(waiting)).toEqual([A2, A3, A4, A6])
        expect(waiting.leftOut).toBe(0)

        const partly = await taken(saved("filter-partly-paid.xlsx"))
        expect(claimsOf(partly)).toEqual([A1])
        expect(partly.leftOut).toBe(0)
    })

    it("saved the word for a page that names no company", async () => {
        const file = await taken(saved("no-company.xlsx"))
        expect(file.company).toBe(UNNAMED_COMPANY)
        expect(claimsOf(file)).toEqual([N1])
    })
})
