import { describe, it, expect } from "vitest"
import { Workbook } from "exceljs"
import { punchTemplate, PUNCH_TEMPLATE_TYPE } from "./punch-template"
import { readRows } from "./punch-file"
import { detectColumns, parseRows, type Cell } from "./punch-import"

/**
 * The import's template (ATTENDANCE_PLAN.md §13.9, PR 272): an Excel file in
 * the page's language whose first sheet the import reads straight back, with
 * nothing on it but the headings, so a template sent back unchanged imports
 * nothing. How to fill it, with examples, is on a second sheet.
 */

const LOCALES = ["en", "ar"] as const

async function workbookOf(buffer: Buffer) {
    const book = new Workbook()
    await book.xlsx.load(buffer as never)
    return book
}

async function rowsOf(book: Workbook): Promise<Cell[][]> {
    return readRows("XLSX", new Uint8Array(await book.xlsx.writeBuffer() as ArrayBuffer))
}

describe("the import's template", () => {
    for (const locale of LOCALES) {
        it(`${locale}: the import finds its three columns, and no In / out`, async () => {
            const rows = await readRows("XLSX", new Uint8Array(await punchTemplate(locale)))
            const found = detectColumns(rows)
            expect(found).not.toBeNull()
            expect(found!.headerRow).toBe(0)
            expect(found!.columns).toEqual({ code: 0, date: 1, time: 2, direction: null })
        })

        it(`${locale}: sent back unchanged, it imports nothing`, async () => {
            const rows = await readRows("XLSX", new Uint8Array(await punchTemplate(locale)))
            const found = detectColumns(rows)!
            expect(rows).toHaveLength(1)
            expect(parseRows(rows, found.headerRow, found.columns, "DMY")).toEqual([])
        })

        it(`${locale}: what is typed is what is read, an employee number's leading 0 kept`, async () => {
            const book = await workbookOf(await punchTemplate(locale))
            const sheet = book.worksheets[0]
            for (const col of [1, 2, 3]) expect(sheet.getColumn(col).numFmt).toBe("@")
            sheet.addRow(["0123", "25/11/2026", "08:55"])
            sheet.addRow(["0123", "25/11/2026", "5:05 PM"])
            const rows = await rowsOf(book)
            const found = detectColumns(rows)!
            expect(parseRows(rows, found.headerRow, found.columns, "DMY")).toEqual([
                { row: 2, ok: true, code: "0123", local: "2026-11-25T08:55:00", direction: null },
                { row: 3, ok: true, code: "0123", local: "2026-11-25T17:05:00", direction: null },
            ])
        })

        it(`${locale}: how to fill it, with examples, is on a second sheet the import never reads`, async () => {
            const book = await workbookOf(await punchTemplate(locale))
            expect(book.worksheets).toHaveLength(2)
            const help = book.worksheets[1]
            const text = help.getSheetValues().flat().filter(v => typeof v === "string").join("\n")
            expect(text).toContain("25/11/2026")
            expect(text).toContain("08:55")
            expect(book.worksheets[0].actualRowCount).toBe(1)
        })

        it(`${locale}: reads in the page's direction`, async () => {
            const book = await workbookOf(await punchTemplate(locale))
            for (const sheet of book.worksheets) expect(!!sheet.views[0]?.rightToLeft).toBe(locale === "ar")
        })
    }

    it("is an Excel workbook", () => {
        expect(PUNCH_TEMPLATE_TYPE).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    })
})
