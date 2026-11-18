import { describe, it, expect, vi, afterEach } from "vitest"
import { Workbook } from "exceljs"
import JSZip from "jszip"
import { readTaxWorkbook } from "./tax-file-read"
import { readTaxSheet, claimOf, TAX_FILE_HEADINGS as H, TAX_FILE_MAX_BYTES, TAX_FILE_MAX_ROWS } from "./tax-file"

/**
 * Opening the Tax Authority portal's file (CLIENT_PORTAL_PLAN.md §4.1,
 * §15). The export button writes its file by hand, with no library (§10):
 * text written inline in each cell, amounts as numbers, days as the sheet's
 * dates. The files here are written the same way, of made-up claims.
 */

type Cell = { t: "s"; v: string } | { t: "n"; v: number } | { t: "d"; v: string }
const s = (v: string): Cell => ({ t: "s", v })
const n = (v: number): Cell => ({ t: "n", v })
const d = (v: string): Cell => ({ t: "d", v })

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
const column = (i: number) => String.fromCharCode(65 + i)
const serial = (iso: string) => { const [y, m, dd] = iso.split("-").map(Number); return (Date.UTC(y, m - 1, dd) - Date.UTC(1899, 11, 30)) / 86400000 }

/** A file as the export button's own writer makes it: the same parts, styles and cells. */
async function buttonFile(headings: string[], rows: Cell[][]): Promise<Uint8Array> {
    const head = headings.map((h, i) => `<c r="${column(i)}1" t="inlineStr" s="1"><is><t>${esc(h)}</t></is></c>`).join("")
    const body = rows.map((row, r) => `<row r="${r + 2}">${row.map((cell, i) => {
        const ref = `${column(i)}${r + 2}`
        if (cell.t === "n") return `<c r="${ref}" s="3"><v>${cell.v}</v></c>`
        if (cell.t === "d") return `<c r="${ref}" s="2"><v>${serial(cell.v)}</v></c>`
        // An empty cell isn't written at all.
        return cell.v === "" ? "" : `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.v)}</t></is></c>`
    }).join("")}</row>`).join("")
    const last = `${column(headings.length - 1)}${rows.length + 1}`
    const zip = new JSZip()
    zip.file("[Content_Types].xml", `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)
    zip.file("_rels/.rels", `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
    zip.file("xl/workbook.xml", `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="المطالبات" sheetId="1" r:id="rId1"/></sheets></workbook>`)
    zip.file("xl/_rels/workbook.xml.rels", `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
    zip.file("xl/styles.xml", `${XML}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center" horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
    zip.file("xl/worksheets/sheet1.xml", `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData><row r="1">${head}</row>${body}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`)
    return zip.generateAsync({ type: "uint8array" })
}

const ALEF = "شركة ألف للتجارة"
const SPLIT = [H.company, H.taxType, H.item, H.claimNumber, H.original, H.paid, H.remaining, H.status, H.dueDate]
const SINGLE = [H.company, H.taxType, H.item, H.claimNumber, H.amount, H.status, H.dueDate]

async function opened(bytes: Uint8Array | ArrayBuffer) {
    const read = await readTaxWorkbook(bytes)
    if ("problem" in read) throw new Error(`not opened: ${read.problem}`)
    return read.sheet
}

describe("the export button's file, opened", () => {
    it("gives each row with its line, its text as text, its amounts as numbers and its days as dates", async () => {
        const sheet = await opened(await buttonFile(SPLIT, [
            [s(ALEF), s("دخل"), s("أقرار تجاري"), s("000111000001"), n(21088.26), n(7365), n(13723.26), s("مسدد جزئياً"), d("2026-04-30")],
            [s(ALEF), s("دخل"), s("مساهمة تكافلية- تأمين صحي"), s("000111000002"), n(7029.42), n(0), n(7029.42), s("في انتظار السداد"), d("2026-04-30")],
        ]))
        expect(sheet.map(r => r.line)).toEqual([1, 2, 3])
        expect(sheet[0].cells).toEqual(SPLIT)
        expect(sheet[1].cells).toEqual([ALEF, "دخل", "أقرار تجاري", "000111000001", 21088.26, 7365, 13723.26, "مسدد جزئياً", new Date("2026-04-30T00:00:00Z")])
    })

    it("is read into its claims: a number's zeros kept, a partly paid claim's three amounts, each day as its day", async () => {
        const file = readTaxSheet(await opened(await buttonFile(SPLIT, [
            [s(ALEF), s("دخل"), s("أقرار تجاري"), s("000111000001"), n(21088.26), n(7365), n(13723.26), s("مسدد جزئياً"), d("2026-04-30")],
            [s(ALEF), s("دخل"), s("مساهمة تكافلية- تأمين صحي"), s("000111000002"), n(7029.42), n(0), n(7029.42), s("في انتظار السداد"), d("2025-04-30")],
        ])))
        if ("problem" in file) throw new Error(file.problem)
        expect(file.company).toBe(ALEF)
        expect(file.rows.map(r => r.mistakes)).toEqual([[], []])
        expect(file.rows.map(claimOf)).toMatchObject([
            { claimNumber: "000111000001", originalAmount: 21088.26, paidAmount: 7365, remainingAmount: 13723.26, dueDate: "2026-04-30" },
            { claimNumber: "000111000002", originalAmount: 7029.42, paidAmount: 0, remainingAmount: 7029.42, dueDate: "2025-04-30" },
        ])
    })

    it("is read with the one amount column too, an empty cell being nothing", async () => {
        const file = readTaxSheet(await opened(await buttonFile(SINGLE, [[s(ALEF), s(""), s("مساهمه تكافليه لصندوق أسر الشهداء"), s("000222000009"), n(9.45), s("في انتظار السداد"), d("2025-12-15")]])))
        if ("problem" in file) throw new Error(file.problem)
        expect(file.rows.map(claimOf)).toEqual([{
            claimNumber: "000222000009", item: "مساهمه تكافليه لصندوق أسر الشهداء", taxType: null, registrationType: null,
            originalAmount: 9.45, paidAmount: 0, remainingAmount: 9.45, currency: null, status: "في انتظار السداد", periodStart: null, periodEnd: null, dueDate: "2025-12-15",
        }])
    })

    it("has a claim number the button wrote as a number refused, as one that may have lost its zeros", async () => {
        const file = readTaxSheet(await opened(await buttonFile(SINGLE, [[s(ALEF), s("دخل"), s("أقرار تجاري"), n(111000001), n(9.45), s("في انتظار السداد"), d("2025-12-15")]])))
        if ("problem" in file) throw new Error(file.problem)
        expect(file.rows[0].mistakes).toEqual([{ code: "number_as_number", detail: "111000001" }])
    })
})

describe("a file saved by a spreadsheet program", () => {
    const book = (fill: (b: Workbook) => void) => { const b = new Workbook(); fill(b); return b.xlsx.writeBuffer().then(buffer => new Uint8Array(buffer as ArrayBuffer)) }

    it("is read from its first sheet alone", async () => {
        const bytes = await book(b => {
            b.addWorksheet("المطالبات").addRows([SINGLE, [ALEF, "دخل", "أقرار تجاري", "000111000001", 100, "في انتظار السداد", new Date("2026-04-30T00:00:00Z")]])
            b.addWorksheet("أخرى").addRows([["شيء"], ["آخر"]])
        })
        const sheet = await opened(bytes)
        expect(sheet).toHaveLength(2)
        expect(sheet[1].cells).toEqual([ALEF, "دخل", "أقرار تجاري", "000111000001", 100, "في انتظار السداد", new Date("2026-04-30T00:00:00Z")])
    })

    it("gives a formula's result and styled text as what they show", async () => {
        const bytes = await book(b => {
            const sheet = b.addWorksheet("المطالبات")
            sheet.addRow(SINGLE)
            sheet.addRow([{ richText: [{ text: "شركة " }, { font: { bold: true }, text: "ألف" }] }, "دخل", "أقرار تجاري", "000111000001", { formula: "50+50", result: 100 }, "في انتظار السداد", "30/04/2026"])
        })
        const file = readTaxSheet(await opened(bytes))
        if ("problem" in file) throw new Error(file.problem)
        expect(file.company).toBe("شركة ألف")
        expect(claimOf(file.rows[0])).toMatchObject({ originalAmount: 100, remainingAmount: 100, dueDate: "2026-04-30" })
    })

    it("has no rows where its first sheet is empty, which is then refused as an empty file", async () => {
        const sheet = await opened(await book(b => { b.addWorksheet("فارغة") }))
        expect(sheet).toEqual([])
        expect(readTaxSheet(sheet)).toEqual({ problem: "empty" })
    })

    it("keeps its rows' own lines, an empty row between them left out", async () => {
        const bytes = await book(b => {
            const sheet = b.addWorksheet("المطالبات")
            sheet.getRow(1).values = SINGLE
            sheet.getRow(4).values = [ALEF, "دخل", "أقرار تجاري", "000111000001", 100, "في انتظار السداد", "30/04/2026"]
        })
        expect((await opened(bytes)).map(r => r.line)).toEqual([1, 4])
    })

    it(`doesn't hold more rows than it takes to say there are over ${TAX_FILE_MAX_ROWS.toLocaleString("en-GB")}`, async () => {
        const bytes = await book(b => {
            const sheet = b.addWorksheet("المطالبات")
            sheet.addRow(SINGLE)
            for (let i = 0; i < TAX_FILE_MAX_ROWS + 60; i++) sheet.addRow([ALEF, "دخل", "أقرار تجاري", `0001${String(i).padStart(8, "0")}`, 1, "في انتظار السداد", "30/04/2026"])
        })
        const sheet = await opened(bytes)
        // Its headings, the rows it may have, and one more.
        expect(sheet).toHaveLength(TAX_FILE_MAX_ROWS + 2)
        expect(readTaxSheet(sheet)).toEqual({ problem: "too_many", rows: TAX_FILE_MAX_ROWS + 1 })
    })
})

describe("a file that can't be opened", () => {
    it("is refused as unreadable: not an Excel file, a damaged one, or one with a password", async () => {
        const text = new TextEncoder().encode("الشركة,رقم المطالبة\nشركة ألف,000111000001\n")
        expect(await readTaxWorkbook(text)).toEqual({ problem: "unreadable" })
        expect(await readTaxWorkbook(new Uint8Array(0))).toEqual({ problem: "unreadable" })
        // Cut short on its way.
        const whole = await buttonFile(SINGLE, [[s(ALEF), s("دخل"), s("أقرار"), s("000111000001"), n(1), s("في انتظار السداد"), d("2026-04-30")]])
        expect(await readTaxWorkbook(whole.slice(0, Math.floor(whole.length / 2)))).toEqual({ problem: "unreadable" })
        // A file with a password is an older kind of container, not a zip: its first bytes.
        const locked = new Uint8Array(4096)
        locked.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
        expect(await readTaxWorkbook(locked)).toEqual({ problem: "unreadable" })
        // An old .xls is the same.
        expect(await readTaxWorkbook(locked.buffer)).toEqual({ problem: "unreadable" })
    })

    it("is refused as too big over 2 MB, without being opened", async () => {
        expect(await readTaxWorkbook(new Uint8Array(TAX_FILE_MAX_BYTES + 1))).toEqual({ problem: "too_big" })
        // At the limit it's opened, and this one isn't a file.
        expect(await readTaxWorkbook(new Uint8Array(TAX_FILE_MAX_BYTES))).toEqual({ problem: "unreadable" })
    })
})

describe("the library that opens it", () => {
    afterEach(() => { vi.doUnmock("exceljs"); vi.resetModules() })
    const file = () => buttonFile(SINGLE, [[s(ALEF), s("دخل"), s("أقرار تجاري"), s("000111000001"), n(1), s("في انتظار السداد"), d("2026-04-30")]])

    it("not loading, as after a new release, is said as that: it isn't the file's fault", async () => {
        vi.resetModules()
        vi.doMock("exceljs", () => { throw new Error("Loading chunk failed") })
        const reader = await import("./tax-file-read")
        expect(await reader.readTaxWorkbook(await file())).toEqual({ problem: "reader" })
    })

    it("is taken as a bundler gives it, or under default as Node does", async () => {
        const real = await vi.importActual<typeof import("exceljs")>("exceljs")
        vi.resetModules()
        vi.doMock("exceljs", () => ({ Workbook: undefined, default: { Workbook: real.Workbook } }))
        const reader = await import("./tax-file-read")
        const read = await reader.readTaxWorkbook(await file())
        expect("sheet" in read && read.sheet.map(r => r.line)).toEqual([1, 2])
    })
})
