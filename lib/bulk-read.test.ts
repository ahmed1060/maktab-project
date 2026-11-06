import { afterEach, describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Reading the bulk upload's file (DESIGN.md §5.5, "Rows read from a file"):
 * its rows from row 3, each with its row's number in the file, the people,
 * client and location it names, its deadline from its date and time cells,
 * and its difficulty. It was read in Create task itself, untested: a date
 * cell was taken at the day before west of UTC, a time that isn't one was
 * taken as midnight, a difficulty in words as 0, and a row with no title
 * was dropped with nothing said.
 */

const PAGE = () => readFileSync("app/(dashboard)/dashboard/tasks/new/page.tsx", "utf8")
const TZ = process.env.TZ
afterEach(() => { process.env.TZ = TZ })

const places = [
    { id: "hq", name: "Nasr City", clientId: "k1", isHq: true, needsPin: false },
    { id: "port", name: "Port gate", clientId: null, isHq: false, needsPin: false },
]
const ctx = {
    people: [{ id: "e1", username: "ali.h" }, { id: "e2", username: "Sara" }],
    clients: [{ id: "k1", name: "Acme" }],
    sheet: new Map([["Port gate", ["port"]], ["Acme - Nasr City", ["hq"]]]),
    places,
}
/** A row in the template's columns: title, description, client, people, date, time, points, location. */
const cells = (over: Partial<Record<number, unknown>> = {}) => {
    const base: unknown[] = ["Fix the door", "The side door sticks when it rains", "Acme", "Ali Hassan (ali.h)", "11/11/2026", "10:30 AM", 2, ""]
    for (const [i, v] of Object.entries(over)) base[Number(i)] = v
    return base
}
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString()

describe("a deadline from its date and time cells", () => {
    it("reads a date as the template's d/m/yyyy, or as written yyyy-mm-dd, at the time given", async () => {
        const { readDeadline } = await import("@/lib/bulk-tasks")
        expect(readDeadline("11/11/2026", "10:30 AM")).toEqual({ deadline: local(2026, 11, 11, 10, 30), unread: "" })
        expect(readDeadline("5-1-2027", "")).toEqual({ deadline: local(2027, 1, 5), unread: "" })
        expect(readDeadline("2026-11-11", "4:05 PM")).toEqual({ deadline: local(2026, 11, 11, 16, 5), unread: "" })
        expect(readDeadline("11/11/2026", "12:00 AM").deadline).toBe(local(2026, 11, 11, 0, 0))
        expect(readDeadline("11/11/2026", "12:15 PM").deadline).toBe(local(2026, 11, 11, 12, 15))
        expect(readDeadline("11/11/2026", "17:45").deadline).toBe(local(2026, 11, 11, 17, 45))
        expect(readDeadline("11/11/2026", "17:45:30").deadline).toBe(local(2026, 11, 11, 17, 45))
        // Day first, as the template has it, with dots too; and the year first with slashes.
        expect(readDeadline("5.1.2027", "").deadline).toBe(local(2027, 1, 5))
        expect(readDeadline("2026/11/11", "").deadline).toBe(local(2026, 11, 11))
    })

    // Codex review on PR 213: a fraction of a day with 30 seconds or more
    // was rounded to the next minute, and 23:59:45 up to midnight, unread.
    it("drops the seconds of a time given as a fraction of a day, as it does a typed time's", async () => {
        const { readDeadline } = await import("@/lib/bulk-tasks")
        expect(readDeadline("11/11/2026", 63930 / 86400).deadline).toBe(local(2026, 11, 11, 17, 45))
        expect(readDeadline("11/11/2026", 86385 / 86400).deadline).toBe(local(2026, 11, 11, 23, 59))
        expect(readDeadline("11/11/2026", 0.9999999).deadline).toBe(local(2026, 11, 11, 23, 59))
        // A third of a day is 8:00, not a hair before it.
        expect(readDeadline("11/11/2026", 1 / 3).deadline).toBe(local(2026, 11, 11, 8, 0))
    })

    it("reads Arabic digits, and the time of day as ص or م", async () => {
        const { readDeadline } = await import("@/lib/bulk-tasks")
        expect(readDeadline("١١/١١/٢٠٢٦", "١٠:٣٠ م")).toEqual({ deadline: local(2026, 11, 11, 22, 30), unread: "" })
        expect(readDeadline("۱۱/۱۱/۲۰۲۶", "10:30 ص").deadline).toBe(local(2026, 11, 11, 10, 30))
        expect(readDeadline("11/11/2026", "12:05 ص").deadline).toBe(local(2026, 11, 11, 0, 5))
        expect(readDeadline("11/11/2026", "12:05 م").deadline).toBe(local(2026, 11, 11, 12, 5))
    })

    // A date cell comes back from exceljs as midnight UTC, and its serial
    // number counts days in UTC too: on the browser's clock west of UTC,
    // that's the day before, and setting its hours kept that day.
    it("reads a date cell, or its serial number, as the day it shows, wherever the browser is", async () => {
        const { readDeadline } = await import("@/lib/bulk-tasks")
        for (const zone of ["Africa/Cairo", "America/New_York", "Pacific/Auckland", "UTC"]) {
            process.env.TZ = zone
            const cell = new Date(Date.UTC(2026, 10, 11))
            const time = new Date(Date.UTC(1899, 11, 30, 9, 15))
            expect(readDeadline(cell, time).deadline, zone).toBe(local(2026, 11, 11, 9, 15))
            // 46337 is 11 Nov 2026 in Excel's count of days; 0.75 is 6 pm.
            expect(readDeadline(46337, 0.75).deadline, zone).toBe(local(2026, 11, 11, 18, 0))
        }
    })

    it("says what the file had when it isn't a date or a time, rather than guess", async () => {
        const { readDeadline } = await import("@/lib/bulk-tasks")
        expect(readDeadline("next Tuesday", "10:00 AM")).toEqual({ deadline: "", unread: "next Tuesday" })
        // The 31st of February isn't the 3rd of March.
        expect(readDeadline("31/02/2026", "")).toEqual({ deadline: "", unread: "31/02/2026" })
        expect(readDeadline("11/13/2026", "")).toEqual({ deadline: "", unread: "11/13/2026" })
        // The browser's own reading guesses: "1" is 1 January 2001, "Fix 12"
        // the 1st of December, and "2026" the day before west of UTC.
        for (const guess of ["1", "Fix 12", "2026", "11/11/26", "11 Nov 2026"]) {
            expect(readDeadline(guess, ""), guess).toEqual({ deadline: "", unread: guess })
        }
        // A time that isn't one was taken as midnight.
        expect(readDeadline("11/11/2026", "25:99")).toEqual({ deadline: "", unread: "25:99" })
        expect(readDeadline("11/11/2026", "13:00 PM")).toEqual({ deadline: "", unread: "13:00 PM" })
        expect(readDeadline("11/11/2026", "noon")).toEqual({ deadline: "", unread: "noon" })
        expect(readDeadline("11/11/2026", "10:5")).toEqual({ deadline: "", unread: "10:5" })
        expect(readDeadline("11/11/2026", 1.5)).toEqual({ deadline: "", unread: "1.5" })
        expect(readDeadline("", "")).toEqual({ deadline: "", unread: "" })
        expect(readDeadline(null, undefined)).toEqual({ deadline: "", unread: "" })
    })
})

describe("the file's rows", () => {
    it("are read from row 3, each with its row's number in the file", async () => {
        const { readRows } = await import("@/lib/bulk-tasks")
        const result = readRows([
            { line: 1, cells: ["Title", "Description"] },
            { line: 2, cells: ["Required", "Required"] },
            { line: 3, cells: cells() },
            { line: 4, cells: [] },
            { line: 5, cells: cells({ 0: "Paint the gate" }) },
        ], ctx)
        if (!("rows" in result)) throw new Error("no rows")
        expect(result.rows.map(r => [r.line, r.title])).toEqual([[3, "Fix the door"], [5, "Paint the gate"]])
        expect(result.rows[0]).toEqual({
            line: 3, title: "Fix the door", description: "The side door sticks when it rains", clientId: "k1", unknownClient: "",
            locationId: "hq", locationText: "", assigneeIds: ["e1"], unknownPeople: [], deadline: local(2026, 11, 11, 10, 30), unreadDeadline: "", difficulty: 2,
        })
    })

    // A row with no title was dropped with nothing said.
    it("reads a row with no title, for the review to say so, and leaves out one with nothing in it", async () => {
        const { readRows, rowMistakes } = await import("@/lib/bulk-tasks")
        const result = readRows([{ line: 3, cells: cells({ 0: "" }) }, { line: 4, cells: ["", "", "", "", "", "", "", ""] }], ctx)
        if (!("rows" in result)) throw new Error("no rows")
        expect(result.rows.map(r => r.line)).toEqual([3])
        expect(rowMistakes(result.rows[0], places, Date.UTC(2026, 10, 1))).toMatchObject({ title: { key: "bulk_title_short" } })
    })

    it("finds its people by username, from the template's list or typed, and keeps the ones no one has", async () => {
        const { readRows } = await import("@/lib/bulk-tasks")
        const result = readRows([{ line: 3, cells: cells({ 3: "Ali Hassan (ali.h), sara , nobody.here" }) }], ctx)
        if (!("rows" in result)) throw new Error("no rows")
        expect(result.rows[0]).toMatchObject({ assigneeIds: ["e1", "e2"], unknownPeople: ["nobody.here"] })
    })

    it("finds its client by name, case aside, and keeps one the company hasn't", async () => {
        const { readRows } = await import("@/lib/bulk-tasks")
        const result = readRows([{ line: 3, cells: cells({ 2: " acme " }) }, { line: 4, cells: cells({ 2: "Acme Ltd", 7: "Port gate" }) }, { line: 5, cells: cells({ 2: "" , 7: "Port gate" }) }], ctx)
        if (!("rows" in result)) throw new Error("no rows")
        expect(result.rows.map(r => [r.clientId, r.unknownClient, r.locationId, r.locationText])).toEqual([
            ["k1", "", "hq", ""], [null, "Acme Ltd", "port", "Port gate"], [null, "", "port", "Port gate"],
        ])
    })

    // A difficulty in words was taken as 0.
    it("reads its difficulty as a number, empty as 0, and one in words as a mistake", async () => {
        const { readRows } = await import("@/lib/bulk-tasks")
        const result = readRows([3, "4", "", "high", " 7 ", "٣"].map((points, i) => ({ line: 3 + i, cells: cells({ 6: points }) })), ctx)
        if (!("rows" in result)) throw new Error("no rows")
        expect(result.rows.map(r => r.difficulty)).toEqual([3, 4, 0, Number.NaN, 7, 3])
    })

    it("are said to be too many over 50, or none, rather than read", async () => {
        const { readRows, BULK_MAX_ROWS } = await import("@/lib/bulk-tasks")
        expect(BULK_MAX_ROWS).toBe(50)
        const many = Array.from({ length: 51 }, (_, i) => ({ line: 3 + i, cells: cells() }))
        expect(readRows(many, ctx)).toEqual({ problem: "too_many" })
        expect("rows" in readRows(many.slice(0, 50), ctx)).toBe(true)
        expect(readRows([{ line: 1, cells: ["Title"] }, { line: 2, cells: ["Required"] }], ctx)).toEqual({ problem: "none" })
    })

    it("trim what each cell has around it", async () => {
        const { readRows } = await import("@/lib/bulk-tasks")
        const result = readRows([{ line: 3, cells: cells({ 0: "  Fix the door ", 1: " The side door sticks when it rains\n" }) }], ctx)
        if (!("rows" in result)) throw new Error("no rows")
        expect([result.rows[0].title, result.rows[0].description]).toEqual(["Fix the door", "The side door sticks when it rains"])
    })
})

describe("Create task, reading the file", () => {
    it("reads it in lib/bulk-tasks.ts, not in the page", () => {
        const page = PAGE()
        expect(page).toContain("readRows(")
        for (const gone of ["deadlineDateStr", "dropdownMatch", "25569", "parseInt(row[6])"]) expect(page, gone).not.toContain(gone)
    })

    // The browser flows of PR 212: a file picked as the page opens was read
    // before its people and clients had loaded, and matched no one.
    it("waits for the people and clients the rows name before reading them", () => {
        const page = PAGE()
        expect(page).toContain("const peopleNow = usersResult ? users : peopleIn(await retryUsers().catch(() => undefined))")
        expect(page).toContain("const clientsNow = !clientsKey ? NO_CLIENTS : clientsIn(clientsResult ?? await retryClients().catch(() => undefined))")
        expect(page).toContain("if (!peopleNow) return showToast(t('bulk_people_load_failed'), 'error')")
        expect(page).toContain("if (!clientsNow) return showToast(t('bulk_clients_load_failed'), 'error')")
    })

    it("says a file it can't read, and takes Excel workbooks alone", () => {
        const page = PAGE()
        expect(page).toContain("showToast(t('bulk_file_unreadable'), 'error')")
        // Its library not loading isn't the file's fault.
        expect(page).toContain("if (!exceljs) return showToast(t('bulk_reader_failed'), 'error')")
        expect(page).toContain('accept=".xlsx"')
        expect(page).not.toContain(".xls,")
        expect(page).not.toContain("'.xlsx, .xls'")
    })
})

describe("Create task, while the file is read", () => {
    it("has its Upload button busy, so it isn't picked twice", () => {
        const page = PAGE()
        expect(page).toContain("busy={readingFile} onClick={() => fileInput.current?.click()}")
        expect(page).toContain("void handleBulkUpload(file).finally(() => setReadingFile(false))")
    })
})

describe("its words", () => {
    const KEYS = ["bulk_limit_exceeded", "bulk_no_rows", "bulk_file_unreadable", "bulk_reader_failed", "bulk_people_load_failed", "bulk_clients_load_failed", "bulk_deadline_unread"] as const

    it("are in both languages, in sentence case, its numbers in Arabic digits, and the Arabic commands nothing in the masculine", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/[0-9]/)
            expect(ar[key], key).not.toMatch(/(^|\s)(اختر|ارفع|حمّل|حمل|أدخل|حدد|قسّم|قسم)(\s|$)/)
        }
        expect(en.bulk_limit_exceeded).toContain("50")
        expect(ar.bulk_limit_exceeded).toContain("٥٠")
        expect(en.bulk_deadline_unread).toBe("The file's deadline can't be read")
        // Each says what to do next (the web interface audit).
        expect(en.bulk_no_rows).toBe("The file has no tasks. Add them from row 3, under the headings.")
        expect(en.bulk_reader_failed).toBe("The file couldn't be opened. Reload the page, then upload it again.")
    })

    // A file's extension ending a sentence in Arabic shows as "..xlsx", its
    // own dot and the sentence's side by side, as Create task's templates
    // window had it too. Written بصيغة xlsx, the sentence's dot is the one
    // that shows before it.
    it("end no Arabic sentence with a file's extension", () => {
        for (const [key, text] of Object.entries(ar)) expect(text, key).not.toMatch(/\.(xlsx|xls|csv)\.(\s|$)/)
        expect(ar.bulk_file_unreadable).toBe("تعذّرت قراءة الملف. يُرجى رفع النموذج كملف Excel بصيغة xlsx.")
        expect(ar.template_not_xlsx).toBe("يُرجى اختيار ملف Excel بصيغة xlsx.")
    })
})
