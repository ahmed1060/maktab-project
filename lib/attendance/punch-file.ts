import { Workbook } from "exceljs"
import { createHash } from "node:crypto"
import { cellToPrimitive } from "@/lib/xlsx-cell"
import { parseCsv, type Cell } from "./punch-import"

/**
 * An uploaded punch file as rows of cells: the first worksheet that has any
 * data for Excel, the whole file for CSV. Server-side only (exceljs, crypto).
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ROWS = 20_000

export type FileKind = "CSV" | "XLSX"

export function kindOf(fileName: string): FileKind | null {
    const lower = fileName.toLowerCase()
    if (lower.endsWith(".xlsx")) return "XLSX"
    if (lower.endsWith(".csv") || lower.endsWith(".txt")) return "CSV"
    return null
}

export function sha256(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex")
}

/**
 * CSV text. UTF-8 first; a file that does not decode as UTF-8 is read as
 * Windows Arabic (1256), which is what older Egyptian terminal software and
 * Excel's "CSV" on an Arabic Windows write.
 */
export function decodeCsv(bytes: Uint8Array): string {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
        return new TextDecoder("windows-1256").decode(bytes)
    }
}

export async function readRows(kind: FileKind, bytes: Uint8Array): Promise<Cell[][]> {
    if (kind === "CSV") return parseCsv(decodeCsv(bytes))
    const book = new Workbook()
    await book.xlsx.load(bytes as any)
    const sheet = book.worksheets.find(ws => ws.actualRowCount > 0)
    if (!sheet) return []
    const rows: Cell[][] = []
    sheet.eachRow({ includeEmpty: true }, (row, number) => {
        const cells: Cell[] = []
        row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellToPrimitive(cell.value) })
        rows[number - 1] = cells
    })
    return Array.from(rows, r => r ?? [])
}
