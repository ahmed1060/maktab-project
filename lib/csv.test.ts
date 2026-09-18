import { describe, it, expect } from "vitest"
import { csvCell, csvRow, csvFile } from "./csv"

describe("quoting", () => {
    it("leaves an ordinary value alone", () => {
        expect(csvCell("Mona Fahmy")).toBe("Mona Fahmy")
        expect(csvCell(30000)).toBe("30000")
    })

    it("quotes a field containing a comma", () => {
        // Without this the row silently gains a column, and a payroll export
        // where every field after one reason has shifted by one is wrong in a
        // way that looks entirely plausible.
        expect(csvCell("Late, twice")).toBe('"Late, twice"')
    })

    it("doubles quotes inside a quoted field", () => {
        expect(csvCell('He said "no"')).toBe('"He said ""no"""')
    })

    it("quotes newlines rather than letting them end the row", () => {
        expect(csvCell("line one\nline two")).toBe('"line one\nline two"')
        expect(csvCell("a\r\nb")).toBe('"a\r\nb"')
    })

    it("writes an empty cell for nothing", () => {
        expect(csvCell(null)).toBe("")
        expect(csvCell(undefined)).toBe("")
        expect(csvCell("")).toBe("")
    })
})

describe("a spreadsheet reads some text as code", () => {
    it("neutralises every formula lead-in", () => {
        // "=cmd|' /c calc'!A0" in a name field is a real attack on whoever
        // opens the file; a reason beginning with a minus is the accidental
        // version of the same thing.
        for (const lead of ["=", "+", "-", "@"]) {
            expect(csvCell(`${lead}SUM(A1:A9)`)).toBe(`'${lead}SUM(A1:A9)`)
        }
        expect(csvCell("=cmd|' /c calc'!A0")).toBe(`'=cmd|' /c calc'!A0`)
    })

    it("keeps the guard when the field also needs quoting", () => {
        // Both problems at once: the prefix goes on first so quoting wraps it,
        // rather than the other way round where the quote would come before the
        // apostrophe and the formula would run.
        expect(csvCell("=A1,B2")).toBe(`"'=A1,B2"`)
    })

    it("does not mangle a negative number written as one", () => {
        // A cost of this rule, stated rather than hidden: -500 exports as '-500
        // and reads as text. Every money column in this export is written
        // unsigned with its sign carried by the column, so nothing legitimate
        // hits it — but a caller adding a signed column should know.
        expect(csvCell(-500)).toBe("'-500")
    })
})

describe("a file Excel can open", () => {
    it("starts with a BOM, so Arabic names are not mojibake", () => {
        const file = csvFile([["الاسم"], ["مني فهمي"]])
        expect(file.startsWith("﻿")).toBe(true)
    })

    it("separates rows with CRLF", () => {
        expect(csvFile([["a"], ["b"]])).toBe("﻿a\r\nb\r\n")
    })

    it("round-trips a row with every hazard in it", () => {
        const row = csvRow(["Mona, Fahmy", '=2+2', 'said "hi"', null, 30000])
        expect(row).toBe(`"Mona, Fahmy",'=2+2,"said ""hi""",,30000`)
    })
})
