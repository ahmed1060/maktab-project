import { describe, it, expect } from "vitest"
import { Workbook } from "exceljs"
import { readRows, decodeCsv, kindOf, sha256 } from "./punch-file"
import { detectColumns, parseRows } from "./punch-import"

/** Uploaded punch files as rows (ATTENDANCE_PLAN.md Phase 0): Excel as terminals save it, and CSV in either encoding. */

describe("reading an uploaded file", () => {
    it("reads an Excel sheet's date cells as the wall clock written in it", async () => {
        const book = new Workbook()
        book.addWorksheet("Empty")
        const sheet = book.addWorksheet("Log")
        sheet.addRow(["Employee ID", "Name", "Date", "Time", "Status"])
        // Excel stores no zone: exceljs hands these back with the wall clock in the UTC fields.
        sheet.addRow([101, "Ehab", new Date(Date.UTC(2026, 9, 1)), "08:05", "Check In"])
        sheet.addRow([101, "Ehab", new Date(Date.UTC(2026, 9, 1, 17, 2)), null, "Check Out"])
        const bytes = new Uint8Array(await book.xlsx.writeBuffer())
        const rows = await readRows("XLSX", bytes)
        const found = detectColumns(rows)!
        expect(found.columns).toEqual({ code: 0, date: 2, time: 3, direction: 4 })
        expect(parseRows(rows, found.headerRow, found.columns, "DMY")).toEqual([
            { row: 2, ok: true, code: "101", local: "2026-10-01T08:05:00", direction: "IN" },
            // No time cell: the date cell's own time is not used when a time column exists.
            { row: 3, ok: false, code: "101", error: "NO_TIME" },
        ])
    })

    it("reads a CSV saved by Arabic Windows, not only UTF-8", () => {
        // "الاسم" in Windows-1256.
        const cp1256 = new Uint8Array([0xc7, 0xe1, 0xc7, 0xd3, 0xe3])
        expect(decodeCsv(cp1256)).toBe("الاسم")
        expect(decodeCsv(new TextEncoder().encode("الاسم"))).toBe("الاسم")
    })

    it("takes .xlsx and .csv by name, and fingerprints the bytes", () => {
        expect([kindOf("Oct.XLSX"), kindOf("log.csv"), kindOf("log.txt"), kindOf("log.xls"), kindOf("log.pdf")]).toEqual(["XLSX", "CSV", "CSV", null, null])
        expect(sha256(new TextEncoder().encode("a"))).toBe("ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb")
    })
})
