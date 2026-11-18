import { describe, it, expect } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { TAX_EXPORT_CODE, TAX_EXPORT_CORE, TAX_EXPORT_VERSION, taxExportBookmark } from "./tax-export-button"
import { readTaxFile } from "./tax-file-read"
import { claimOf, dayFromFileName, namedCompany, remainingOf, TAX_FILE_HEADINGS as H, UNNAMED_COMPANY, type ClaimDraft, type TaxFile } from "./tax-file"

/**
 * The tax portal's export button, in Nizmo (CLIENT_PORTAL_PLAN.md §10, §12
 * step 4a, §15, PR 318). Three things are checked here, on every push:
 *
 * - its code as text: that it stands alone, sends nothing anywhere, and is
 *   what its bookmark holds;
 * - the part of it that needs no page, run as it is: how a cell's words are
 *   read, its file's name, the file it writes, read with Nizmo's reader, and
 *   what it holds of the portal's table from one reading of it to the next;
 * - what a browser did with it. `scripts/tax-export-browser-run.mjs` presses
 *   the bookmark on a page laid out like the portal's, and keeps the files
 *   it saves in `lib/tax-export-fixtures` with the code's fingerprint. Those
 *   files are read here with Nizmo's reader, and code changed since it was
 *   tried in a browser fails.
 *
 * Every company and claim here is made up.
 */

type Cell = { t: "s"; v: string } | { t: "n"; v: number; orig?: number } | { t: "d"; v: string }
/** What the button holds of the portal's table: its rows, the portal's count, and whether they're one whole gathering, and from when. */
type Gathered = { headers: string[]; rows: { key: string; company: string; cells: Record<string, Cell> }[]; total?: number; whole?: boolean; at?: number }
/** The portal's table as it's on the screen: one page of it. */
type Shown = { company: string; headers: string[]; total: number | null; rows: { key: string; cells: Record<string, Cell> }[] }
type Core = {
    NUMBER_HEADER: string
    companyOf(title: string): string
    textCell(header: string, text: string): Cell
    fileName(company: string, day: string): string
    buildXlsx(state: Gathered): Blob
    takeIn(state: Gathered, shown: Shown): { state: Gathered; added: number; alone: boolean }
    seal(state: Gathered, total: number | null, now: number): void
    ready(state: Gathered, now: number): boolean
}

/** The part that needs no page, run as it's written. */
const core = new Function(`${TAX_EXPORT_CORE}\nreturn { NUMBER_HEADER: NUMBER_HEADER, companyOf: companyOf, textCell: textCell, fileName: fileName, buildXlsx: buildXlsx, takeIn: takeIn, seal: seal, ready: ready }`)() as Core

const ALEF = "شركة ألف للتجارة"
const BAA = "شركة باء للتوريدات"
const JEEM = "شركة جيم للمقاولات"
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
// Company Jeem's claims that wait, among as many that were paid.
const C1: ClaimDraft = { claimNumber: "000444000001", item: HEALTH, taxType: "دخل", registrationType: LEGAL, originalAmount: 1000, paidAmount: 0, remainingAmount: 1000, currency: POUND, status: WAITING, periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30" }
const C3: ClaimDraft = { claimNumber: "000444000003", item: "مساهمه تكافليه لصندوق أسر الشهداء", taxType: "دخل", registrationType: LEGAL, originalAmount: 30, paidAmount: 0, remainingAmount: 30, currency: POUND, status: WAITING, periodStart: null, periodEnd: null, dueDate: "2025-12-15" }
const C5: ClaimDraft = { claimNumber: "000444000005", item: "إقرار شهري", taxType: "قيمة مضافة", registrationType: LEGAL, originalAmount: 500, paidAmount: 0, remainingAmount: 500, currency: POUND, status: WAITING, periodStart: "2025-11-01", periodEnd: "2025-11-30", dueDate: "2025-12-31" }
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

    it("keeps nothing in the browser, and removes what an older copy kept there (§10, §12 step 4)", () => {
        // An older copy kept its rows from one visit to the next, a claim's number among them as a number.
        expect(TAX_EXPORT_CODE.match(/etaClaimsExport_v\d+/g)).toEqual(["etaClaimsExport_v1"])
        expect(TAX_EXPORT_CODE).toContain("localStorage.removeItem('etaClaimsExport_v1')")
        // Removing that is all it does with what the browser keeps: a visit starts from nothing.
        expect(TAX_EXPORT_CODE.split("localStorage").length - 1).toBe(1)
        for (const elsewhere of ["setItem", "getItem", "sessionStorage", "indexedDB", "document.cookie"]) expect(TAX_EXPORT_CODE, elsewhere).not.toContain(elsewhere)
    })

    it("knows which copy it is: its version is its own code's fingerprint, so a change of any kind makes another copy (§10)", () => {
        expect(TAX_EXPORT_VERSION).toMatch(/^[0-9a-f]{8}$/)
        expect(TAX_EXPORT_CODE.split(`var VERSION = '${TAX_EXPORT_VERSION}';`).length - 1).toBe(1)
        // It's the fingerprint of the code with the version's place left open, so every other character of it counts.
        const fingerprint = (text: string) => {
            let hash = 0x811c9dc5
            for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
            return (hash >>> 0).toString(16).padStart(8, "0")
        }
        const open = TAX_EXPORT_CODE.replace(`'${TAX_EXPORT_VERSION}'`, "'{version}'")
        expect(open).not.toContain(TAX_EXPORT_VERSION)
        expect(fingerprint(open)).toBe(TAX_EXPORT_VERSION)
        expect(fingerprint(`${open} `)).not.toBe(TAX_EXPORT_VERSION)
    })

    it("answers a press only where the copy that's up is the same one, and can be stopped by another (§10)", () => {
        // An older copy kept claim numbers as numbers: pressed where one is up, this one takes its place.
        expect(TAX_EXPORT_CODE).toContain("if (window.__etaX && window.__etaX.v === VERSION && document.getElementById('etax-panel')) {")
        expect(TAX_EXPORT_CODE).toContain("window.__etaX = { v: VERSION, stop: stop, ")
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

describe("The tax portal's export button: what it holds of the portal's table (§10, PR 318)", () => {
    const text = (v: string): Cell => ({ t: "s", v })
    /** A page of the portal's table as the part on the page reads it: each claim's number, what's left of it, and its status. */
    const screen = (company: string, total: number | null, claims: [number: string, left: number, status?: string][]): Shown => ({
        company,
        headers: [H.claimNumber, H.amount, H.status],
        total,
        rows: claims.map(([number, left, status = WAITING]) => ({ key: `${company}|${number}`, cells: { [H.claimNumber]: text(number), [H.amount]: { t: "n", v: left }, [H.status]: text(status) } })),
    })
    const nothing = (): Gathered => ({ headers: [], rows: [] })
    const numbers = (state: Gathered) => state.rows.map(row => row.cells[H.claimNumber].v)
    const amounts = (state: Gathered) => state.rows.map(row => row.cells[H.amount].v)
    /** What it holds once it has read these pages, one after another. */
    const read = (...pages: Shown[]) => pages.reduce((state, page) => core.takeIn(state, page).state, nothing())

    it("takes in a page of the portal's table: its rows, their company and columns, and the portal's count", () => {
        const took = core.takeIn(nothing(), screen(ALEF, 3, [["001", 100], ["002", 70]]))
        expect(took.added).toBe(2)
        expect(took.state).toEqual({
            headers: [H.claimNumber, H.amount, H.status],
            total: 3,
            rows: [
                { key: `${ALEF}|001`, company: ALEF, cells: { [H.claimNumber]: text("001"), [H.amount]: { t: "n", v: 100 }, [H.status]: text(WAITING) } },
                { key: `${ALEF}|002`, company: ALEF, cells: { [H.claimNumber]: text("002"), [H.amount]: { t: "n", v: 70 }, [H.status]: text(WAITING) } },
            ],
        })
        // And the next page's rows after them, in the portal's order.
        const next = core.takeIn(took.state, screen(ALEF, 3, [["003", 5]]))
        expect(next.added).toBe(1)
        expect(numbers(next.state)).toEqual(["001", "002", "003"])
    })

    it("gives a claim seen again what the portal shows now, and doesn't hold it twice", () => {
        // What's left of a claim paid in part went from 100 to 50, and it was paid in full after that.
        const before = read(screen(ALEF, 2, [["001", 100, PARTLY], ["002", 70]]))
        const took = core.takeIn(before, screen(ALEF, 2, [["001", 50, PARTLY], ["002", 70]]))
        expect(took.added).toBe(0)
        expect(numbers(took.state)).toEqual(["001", "002"])
        expect(amounts(took.state)).toEqual([50, 70])

        const paid = core.takeIn(took.state, screen(ALEF, 2, [["001", 0, "مسدد"], ["002", 70]])).state
        expect(paid.rows.map(row => row.cells[H.status].v)).toEqual(["مسدد", WAITING])
        expect(amounts(paid)).toEqual([0, 70])
        // A row that's twice on one screen is held once, as it's last shown.
        expect(amounts(read(screen(ALEF, 1, [["001", 100], ["001", 90]])))).toEqual([90])
    })

    it("starts again by itself where the rows it holds are another company's (§10)", () => {
        const took = core.takeIn(read(screen(ALEF, 2, [["001", 100], ["002", 70]])), screen(BAA, 1, [["009", 9]]))
        expect(numbers(took.state)).toEqual(["009"])
        expect(took.state.rows[0].company).toBe(BAA)
        expect(took.state.total).toBe(1)
        expect(took.added).toBe(1)
    })

    it("starts again where the portal's count has changed: another filter (§10)", () => {
        const took = core.takeIn(read(screen(ALEF, 4, [["002", 70], ["003", 13]]), screen(ALEF, 4, [["004", 9], ["006", 12]])), screen(ALEF, 1, [["001", 137, PARTLY]]))
        expect(numbers(took.state)).toEqual(["001"])
        expect(took.state.total).toBe(1)
    })

    it("starts again from the screen where it would hold more rows than the portal's count: another filter that shows as many", () => {
        // One claim paid in part, then the filter is changed to the one claim that was paid: the count is 1 both times.
        const one = core.takeIn(read(screen(ALEF, 1, [["001", 137, PARTLY]])), screen(ALEF, 1, [["005", 500, "مسدد"]]))
        expect(numbers(one.state)).toEqual(["005"])
        expect(one.added).toBe(1)
        expect(one.alone).toBe(true)

        // Three paid claims on two pages, then the filter is changed to three that wait: its first page is on the screen.
        const paid = read(screen(JEEM, 3, [["002", 2000, "مسدد"], ["004", 400, "مسدد"]]), screen(JEEM, 3, [["006", 600, "مسدد"]]))
        const pages = core.takeIn(paid, screen(JEEM, 3, [["001", 1000], ["003", 30]]))
        expect(numbers(pages.state)).toEqual(["001", "003"])
        expect(pages.added).toBe(2)
        expect(pages.state.total).toBe(3)
    })

    it("lets no row go for a count that can't be the table's: one with fewer rows than a single screen has", () => {
        const state = read(screen(ALEF, 1, [["001", 100], ["002", 70]]), screen(ALEF, 1, [["003", 13], ["004", 9]]))
        expect(numbers(state)).toEqual(["001", "002", "003", "004"])
        // And none where the page has no count on it at all.
        expect(numbers(read(screen(ALEF, null, [["001", 100]]), screen(ALEF, null, [["005", 500]])))).toEqual(["001", "005"])
    })

    it("says whether the screen is all it holds", () => {
        const first = core.takeIn(nothing(), screen(ALEF, 3, [["001", 100], ["002", 70]]))
        expect(first.alone).toBe(true)
        expect(core.takeIn(first.state, screen(ALEF, 3, [["001", 100], ["002", 70]])).alone).toBe(true)
        // With the next page's row, there's a page of it that isn't on the screen.
        expect(core.takeIn(first.state, screen(ALEF, 3, [["003", 5]])).alone).toBe(false)
    })

    it("takes a gathering as whole only with the portal's count, and as fit for a file for five minutes", () => {
        const NOW = Date.UTC(2026, 10, 17, 22, 30)
        const MINUTE = 60 * 1000
        const state = read(screen(ALEF, 2, [["001", 100], ["002", 70]]))
        // Never taken as whole until it's said to be.
        expect(core.ready(state, NOW)).toBe(false)

        core.seal(state, 2, NOW)
        expect(state.whole).toBe(true)
        expect(core.ready(state, NOW)).toBe(true)
        expect(core.ready(state, NOW + 5 * MINUTE - 1)).toBe(true)
        expect(core.ready(state, NOW + 5 * MINUTE)).toBe(false)

        // Fewer rows than the portal counts, or more: not whole.
        core.seal(state, 3, NOW)
        expect(state.whole).toBe(false)
        expect(core.ready(state, NOW)).toBe(false)
        core.seal(state, 1, NOW)
        expect(core.ready(state, NOW)).toBe(false)
        // A page with no count on it: there's nothing to hold its rows against.
        core.seal(state, null, NOW)
        expect(core.ready(state, NOW)).toBe(true)

        // Whatever marks it as no longer whole, it isn't fit for a file.
        state.whole = false
        expect(core.ready(state, NOW)).toBe(false)
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
            "download-at-once",
            "seen-again-takes-now",
            "drawn-again-gathers-again",
            "left-open-gathers-again",
            "download-waits-for-pages",
            "page-never-comes",
            "new-visit-starts-again",
            "nothing-kept",
            "filter-first",
            "filter-changed",
            "partly-paid",
            "changed-a-moment-ago",
            "same-count-filter",
            "same-count-filter-pages",
            "by-hand-never-saved",
            "count-not-the-tables",
            "short-of-the-count",
            "other-company-same-tab",
            "older-copy-removed",
            "older-copy-replaced",
            "clear",
            "no-company",
            "no-table",
            "file-name-cairo-day",
            "sends-nothing",
        ])
    })

    it("kept the files it saved as they were saved", () => {
        expect(run.files.map(({ file }) => file)).toEqual(["one-page.xlsx", "every-page.xlsx", "gathered-again.xlsx", "filter-waiting.xlsx", "filter-partly-paid.xlsx", "same-count-pages.xlsx", "no-company.xlsx"])
        for (const { file, sha256: print } of run.files) expect(sha256(saved(file)), file).toBe(print)
    })

    it("named each file for its company and Cairo's day, when UTC's was still the day before (§10)", () => {
        // The browser's clock was set to half past midnight in Cairo.
        expect(run.clock).toBe("2026-11-17T22:30:00.000Z")
        expect(run.day).toBe("2026-11-18")
        expect(Object.fromEntries(run.files.map(({ file, savedAs }) => [file, savedAs]))).toEqual({
            "one-page.xlsx": `مطالبات - ${BAA} - 2026-11-18.xlsx`,
            "every-page.xlsx": `مطالبات - ${ALEF} - 2026-11-18.xlsx`,
            "gathered-again.xlsx": `مطالبات - ${ALEF} - 2026-11-18.xlsx`,
            "filter-waiting.xlsx": `مطالبات - ${ALEF} - 2026-11-18.xlsx`,
            "filter-partly-paid.xlsx": `مطالبات - ${ALEF} - 2026-11-18.xlsx`,
            "same-count-pages.xlsx": `مطالبات - ${JEEM} - 2026-11-18.xlsx`,
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

    it("saved what the portal showed when Download was pressed, gathered again, where its table had been drawn again since", async () => {
        // What was left of the first claim, on another page, went down to 5,000, and the last one's amount to 900.
        const file = await taken(saved("gathered-again.xlsx"))
        expect(file.company).toBe(ALEF)
        expect(claimsOf(file)).toEqual([{ ...A1, paidAmount: 16088.26, remainingAmount: 5000 }, A2, A3, A4, { ...A6, originalAmount: 900, remainingAmount: 900 }])
        expect(file.leftOut).toBe(1)
        expect(remainingOf(file.rows.map(row => ({ remainingAmount: row.remainingAmount ?? 0 })))).toBe(26134.37)
    })

    it("saved the claims of the filter chosen, where the one before it showed as many", async () => {
        // Three paid claims were gathered first, then the filter was changed to the three that wait.
        const file = await taken(saved("same-count-pages.xlsx"))
        expect(file.company).toBe(JEEM)
        expect(claimsOf(file)).toEqual([C1, C3, C5])
        expect(file.leftOut).toBe(0)
        expect(file.otherStatuses).toEqual([])
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
