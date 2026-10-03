import { describe, it, expect } from "vitest"
import { cellText, detectColumns, readDate, readTime, readDirection, parseRows, parseCsv, localToInstant, type Cell } from "./punch-import"

/** Reading punches out of the spreadsheets terminal software exports (ATTENDANCE_PLAN.md Phase 0). */

describe("cells", () => {
    it("reads Arabic-Indic digits as digits", () => {
        expect(cellText("١٠٢٣")).toBe("1023")
        expect(cellText("  ٠٨:٠٥ ")).toBe("08:05")
    })
})

describe("finding the columns", () => {
    it("finds a ZKTeco-style export: number, name, one date-and-time column, state", () => {
        const rows: Cell[][] = [["AC-No.", "Name", "Time", "State"], ["1", "Ahmed", "01/10/2026 08:05", "C/In"]]
        // "Time" here holds date and time: with no date column it is read as both.
        expect(detectColumns(rows)?.columns).toEqual({ code: 0, date: 2, time: null, direction: 3 })
        expect(parseRows(rows, 0, detectColumns(rows)!.columns, "DMY")[0]).toMatchObject({ ok: true, local: "2026-10-01T08:05:00", direction: "IN" })
        const zk: Cell[][] = [["AC-No.", "Name", "Check Time", "State"], ["1", "Ahmed", "01/10/2026 08:05", "C/In"]]
        expect(detectColumns(zk)?.columns).toEqual({ code: 0, date: 2, time: null, direction: 3 })
    })

    it("finds separate date and time columns, in Arabic, below a title row", () => {
        const rows: Cell[][] = [["تقرير الحضور"], ["رقم الموظف", "الاسم", "التاريخ", "الوقت", "الحالة"], ["7", "منى", "2026-10-01", "08:00", "دخول"]]
        expect(detectColumns(rows)).toMatchObject({ headerRow: 1, columns: { code: 0, date: 2, time: 3, direction: 4 } })
    })

    it("gives up rather than guess when there is no employee number or no date", () => {
        expect(detectColumns([["Name", "Date", "Time"]])).toBeNull()
        expect(detectColumns([["Employee ID", "Name"]])).toBeNull()
    })
})

describe("dates and times", () => {
    it("reads a slashed date day-first unless told month-first", () => {
        expect(readDate("03/10/2026", "DMY")).toEqual({ date: "2026-10-03", time: null })
        expect(readDate("03/10/2026", "MDY")).toEqual({ date: "2026-03-10", time: null })
        expect(readDate("2026/10/03 17:30", "DMY")).toEqual({ date: "2026-10-03", time: "17:30:00" })
        expect(readDate("3-10-26", "DMY")).toEqual({ date: "2026-10-03", time: null })
    })

    it("refuses a date that does not exist", () => {
        expect(readDate("31/02/2026", "DMY")).toBeNull()
        expect(readDate("13/13/2026", "DMY")).toBeNull()
        expect(readDate("yesterday", "DMY")).toBeNull()
    })

    it("reads Excel's dates as the wall clock written in the sheet", () => {
        expect(readDate(new Date(Date.UTC(2026, 9, 1, 8, 5, 0)), "DMY")).toEqual({ date: "2026-10-01", time: "08:05:00" })
        expect(readDate(new Date(Date.UTC(2026, 9, 1)), "DMY")).toEqual({ date: "2026-10-01", time: null })
        // 46296 is 1 October 2026 in Excel's day count; .25 is 06:00.
        expect(readDate(46296.25, "DMY")).toEqual({ date: "2026-10-01", time: "06:00:00" })
    })

    it("reads times with seconds, twelve-hour clocks in English and Arabic, and fractions of a day", () => {
        expect(readTime("8:05")).toBe("08:05:00")
        expect(readTime("17:30:15")).toBe("17:30:15")
        expect(readTime("12:10 AM")).toBe("00:10:00")
        expect(readTime("5:00 pm")).toBe("17:00:00")
        expect(readTime("٥:٠٠ م")).toBe("17:00:00")
        expect(readTime(0.5)).toBe("12:00:00")
        expect(readTime("25:00")).toBeNull()
        expect(readTime("13:00 PM")).toBeNull()
    })

    it("reads in and out from terminal states and plain words, and nothing else", () => {
        expect(["C/In", "Check In", "IN", "دخول", "حضور", "0"].map(readDirection)).toEqual(Array(6).fill("IN"))
        expect(["C/Out", "Check Out", "out", "خروج", "انصراف", "1"].map(readDirection)).toEqual(Array(6).fill("OUT"))
        expect(["OverTime", "", "Break"].map(readDirection)).toEqual([null, null, null])
    })
})

describe("rows", () => {
    const columns = { code: 0, date: 1, time: 2, direction: 3 }

    it("turns each row into an employee number, a wall-clock time and a direction, numbered as the sheet shows", () => {
        const rows: Cell[][] = [["ID", "Date", "Time", "State"], ["101", "01/10/2026", "08:05", "C/In"], [], ["101", "01/10/2026", "5:02 PM", ""]]
        expect(parseRows(rows, 0, columns, "DMY")).toEqual([
            { row: 2, ok: true, code: "101", local: "2026-10-01T08:05:00", direction: "IN" },
            { row: 4, ok: true, code: "101", local: "2026-10-01T17:02:00", direction: null },
        ])
    })

    it("reports a row it cannot read by number and reason, and never invents a time", () => {
        const rows: Cell[][] = [["ID", "Date", "Time", "State"], ["", "01/10/2026", "08:00", ""], ["5", "", "08:00", ""], ["5", "32/10/2026", "08:00", ""], ["5", "01/10/2026", "", ""], ["5", "01/10/2026", "late", ""]]
        expect(parseRows(rows, 0, columns, "DMY").map(r => (r.ok ? "ok" : r.error))).toEqual(["NO_CODE", "NO_DATE", "BAD_DATE", "NO_TIME", "BAD_TIME"])
    })

    it("reads an employee number Excel stored as a number", () => {
        expect(parseRows([["ID", "Date", "Time", "State"], [101, "01/10/2026", "08:00", null]], 0, columns, "DMY")[0]).toMatchObject({ ok: true, code: "101" })
    })

    it("needs a time when the date column has none and there is no time column", () => {
        expect(parseRows([["ID", "Check Time"], ["1", "01/10/2026"]], 0, { code: 0, date: 1, time: null, direction: null }, "DMY")[0]).toMatchObject({ ok: false, error: "NO_TIME" })
    })
})

describe("CSV", () => {
    it("reads quotes, doubled quotes, a byte-order mark and Windows line ends", () => {
        expect(parseCsv('﻿ID,Name,Time\r\n1,"Said, Ali","01/10/2026 08:00"\r\n2,"He said ""hi""",x\r\n')).toEqual([
            ["ID", "Name", "Time"], ["1", "Said, Ali", "01/10/2026 08:00"], ["2", 'He said "hi"', "x"],
        ])
    })

    it("picks the delimiter the header uses", () => {
        expect(parseCsv("ID;Date;Time\n1;01/10/2026;08:00")).toEqual([["ID", "Date", "Time"], ["1", "01/10/2026", "08:00"]])
        expect(parseCsv("ID\tDate\n1\t01/10/2026")).toEqual([["ID", "Date"], ["1", "01/10/2026"]])
    })
})

describe("wall clock to instant", () => {
    it("uses the offset in force on that date, summer and winter", () => {
        expect(localToInstant("2026-01-15T08:00:00", "Africa/Cairo").toISOString()).toBe("2026-01-15T06:00:00.000Z")
        expect(localToInstant("2026-07-15T08:00:00", "Africa/Cairo").toISOString()).toBe("2026-07-15T05:00:00.000Z")
    })

    it("takes the first of a time that happens twice when clocks go back", () => {
        // Egypt's DST ends at midnight on the last Thursday of October 2026 (the 29th):
        // 23:30 on the 29th happens at +03:00 and again at +02:00.
        expect(localToInstant("2026-10-29T23:30:00", "Africa/Cairo").toISOString()).toBe("2026-10-29T20:30:00.000Z")
    })

    it("moves a time that never happened, when clocks go forward, past the gap", () => {
        // DST starts at midnight on the last Friday of April 2026 (the 24th): 00:30 does not exist.
        const instant = localToInstant("2026-04-24T00:30:00", "Africa/Cairo")
        expect(instant.toISOString()).toBe("2026-04-23T22:30:00.000Z")
    })
})
