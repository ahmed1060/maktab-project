import type { Workbook } from "exceljs"
import { cellToPrimitive } from "./xlsx-cell"
import { TAX_FILE_MAX_BYTES, TAX_FILE_MAX_ROWS, type TaxSheetRow } from "./tax-file"

/**
 * Opens the Tax Authority portal's file (CLIENT_PORTAL_PLAN.md §4.1): its
 * first sheet, row by row, for lib/tax-file.ts to read. The browser opens
 * it, for the check screen; the server is sent the claims read, never the
 * file.
 *
 * - `too_big`: over 2 MB, refused before it's opened.
 * - `unreadable`: not an Excel file, a damaged one, or one with a password.
 * - `reader`: the library that opens files didn't load, as after a new
 *   release. That isn't the file's fault, and trying again can pass.
 */
export async function readTaxWorkbook(bytes: ArrayBuffer | Uint8Array): Promise<{ sheet: TaxSheetRow[] } | { problem: "too_big" | "unreadable" | "reader" }> {
    if (bytes.byteLength > TAX_FILE_MAX_BYTES) return { problem: "too_big" }

    // Loaded when a file is: it's large, and most visits upload nothing.
    const exceljs = await import("exceljs").catch(() => null)
    // As a bundler gives it, or under `default` as Node does.
    const Book: (new () => Workbook) | undefined = exceljs?.Workbook ?? (exceljs as { default?: { Workbook?: new () => Workbook } } | null)?.default?.Workbook
    if (!Book) return { problem: "reader" }

    const sheet: TaxSheetRow[] = []
    try {
        const book = new Book()
        await book.xlsx.load(bytes as ArrayBuffer)
        book.worksheets[0]?.eachRow({ includeEmpty: false }, row => {
            // Its headings, the rows a file may have, and one more: enough to say it has too many.
            if (sheet.length >= TAX_FILE_MAX_ROWS + 2) return
            // exceljs's row.values starts at index 1.
            const cells = Array.isArray(row.values) ? row.values.slice(1).map(cellToPrimitive) : []
            if (cells.some(cell => cell !== null && cell !== undefined && !(typeof cell === "string" && cell.trim() === ""))) sheet.push({ line: row.number, cells })
        })
    } catch {
        return { problem: "unreadable" }
    }
    return { sheet }
}
