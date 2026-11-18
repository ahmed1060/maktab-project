import { describe, it, expect } from "vitest"
import {
    TAX_FILE_HEADINGS as H, TAX_FILE_MAX_ROWS, TAX_FILE_MAX_BYTES, TAX_NUMBER_MAX, TAX_TEXT_MAX, UNNAMED_COMPANY,
    readTaxSheet, claimOf, claimProblems, compareClaims, remainingOf, dayFromFileName, fileNamesClient, spellingKey,
    isOpenClaim, namedCompany, sentClaim, sentUpload,
    type TaxSheetRow, type TaxFile, type ClaimDraft,
} from "./tax-file"

/**
 * The Tax Authority portal's file, read by the rules the upload's check
 * screen and the server share (CLIENT_PORTAL_PLAN.md §4.1, §15). The
 * companies and claims here are made up; the owner's own file stays out
 * of the repository.
 */

// The export button's two layouts (§10): the three amount columns where any
// claim in the file was partly paid, the one amount column where none was.
const SPLIT = [H.company, H.taxType, H.item, H.registrationType, H.claimNumber, H.original, H.paid, H.remaining, H.currency, H.status, H.periodStart, H.periodEnd, H.dueDate]
const SINGLE = [H.company, H.taxType, H.item, H.claimNumber, H.amount, H.status, H.dueDate]

const ALEF = "شركة ألف للتجارة"
// A sheet's date comes back from exceljs as midnight UTC.
const day = (iso: string) => new Date(`${iso}T00:00:00Z`)
const sheet = (headings: unknown[], ...rows: unknown[][]): TaxSheetRow[] => [headings, ...rows].map((cells, i) => ({ line: i + 1, cells }))

const partly = (over: Record<number, unknown> = {}) => Object.assign([ALEF, "دخل", "أقرار تجاري", "تسجيل عام", "000111000001", 21088.26, 7365, 13723.26, "جنيه مصري", "مسدد جزئياً", day("2025-01-01"), day("2025-12-31"), day("2026-04-30")], over)
const waiting = (over: Record<number, unknown> = {}) => Object.assign([ALEF, "دخل", "مساهمة تكافلية- تأمين صحي", "", "000111000002", 7029.42, 0, 7029.42, "جنيه مصري", "في انتظار السداد", day("2025-01-01"), day("2025-12-31"), day("2026-04-30")], over)
const single = (over: Record<number, unknown> = {}) => Object.assign([ALEF, "دخل", "مساهمه تكافليه لصندوق أسر الشهداء", "000111000009", 9.45, "في انتظار السداد", day("2025-12-15")], over)

function read(rows: TaxSheetRow[]): TaxFile {
    const file = readTaxSheet(rows)
    if ("problem" in file) throw new Error(`refused: ${JSON.stringify(file)}`)
    return file
}
const codes = (file: TaxFile, at = 0) => file.rows[at].mistakes.map(m => m.code)

describe("the file, as the export button writes it", () => {
    it("reads each claim with the three amount columns: what's kept of it, as the portal wrote it", () => {
        const file = read(sheet(SPLIT, partly(), waiting()))
        expect(file.company).toBe(ALEF)
        expect(file.leftOut).toBe(0)
        expect(file.rows.map(r => r.mistakes)).toEqual([[], []])
        expect(claimOf(file.rows[0])).toEqual({
            claimNumber: "000111000001", item: "أقرار تجاري", taxType: "دخل", registrationType: "تسجيل عام",
            originalAmount: 21088.26, paidAmount: 7365, remainingAmount: 13723.26,
            currency: "جنيه مصري", status: "مسدد جزئياً", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30",
        })
        // What may be empty is kept as nothing, not as an empty word.
        expect(claimOf(file.rows[1])).toMatchObject({ claimNumber: "000111000002", registrationType: null, paidAmount: 0, remainingAmount: 7029.42 })
        // Each row keeps its line in the file, so it can be found there.
        expect(file.rows.map(r => r.line)).toEqual([2, 3])
    })

    it("reads the one amount column as both the original and what remains", () => {
        const file = read(sheet(SINGLE, single()))
        expect(file.rows[0].mistakes).toEqual([])
        expect(claimOf(file.rows[0])).toEqual({
            claimNumber: "000111000009", item: "مساهمه تكافليه لصندوق أسر الشهداء", taxType: "دخل", registrationType: null,
            originalAmount: 9.45, paidAmount: 0, remainingAmount: 9.45,
            currency: null, status: "في انتظار السداد", periodStart: null, periodEnd: null, dueDate: "2025-12-15",
        })
    })

    it("finds the columns by their headings, in any order and among others", () => {
        const order = [12, 4, 0, 7, 6, 5, 2, 9, 1, 3, 8, 10, 11]
        const shuffled = (row: unknown[]) => ["extra", ...order.map(i => row[i]), "another"]
        const file = read(sheet(["ملاحظات", ...order.map(i => SPLIT[i]), "الإجراء"], shuffled(partly()), shuffled(waiting())))
        expect(file.rows.map(r => r.mistakes)).toEqual([[], []])
        expect(claimOf(file.rows[0])).toMatchObject({ claimNumber: "000111000001", originalAmount: 21088.26, dueDate: "2026-04-30", status: "مسدد جزئياً" })
    })

    it("matches a heading by its spelling, not its letters' forms or its spaces", () => {
        const headings = SPLIT.map(h => h === H.original ? "قيمه  المطالبه الاصليه" : h === H.dueDate ? " اخر موعد للسداد قبل الغرامة " : h)
        expect(read(sheet(headings, partly())).rows[0].mistakes).toEqual([])
    })

    it("takes the first row with anything in it as the headings, and leaves empty rows out", () => {
        const rows: TaxSheetRow[] = [
            { line: 1, cells: [] },
            { line: 2, cells: SPLIT },
            { line: 3, cells: partly() },
            { line: 4, cells: [null, "", "  ", undefined] },
            { line: 5, cells: waiting() },
            { line: 6, cells: [] },
            { line: 7, cells: ["", null] },
        ]
        const file = read(rows)
        expect(file.rows.map(r => r.line)).toEqual([3, 5])
        expect(file.leftOut).toBe(0)
    })

    it("refuses a file with a needed column missing, naming it", () => {
        const without = (heading: string) => readTaxSheet(sheet(SPLIT.map(h => h === heading ? "شيء آخر" : h), partly()))
        expect(without(H.company)).toEqual({ problem: "columns", missing: [H.company] })
        expect(without(H.claimNumber)).toEqual({ problem: "columns", missing: [H.claimNumber] })
        expect(without(H.item)).toEqual({ problem: "columns", missing: [H.item] })
        expect(without(H.dueDate)).toEqual({ problem: "columns", missing: [H.dueDate] })
        // One of the three amount columns gone, with no single one to read instead.
        expect(without(H.paid)).toEqual({ problem: "columns", missing: [H.paid] })
        // No amount at all: the one column every file has at least.
        expect(readTaxSheet(sheet([H.company, H.item, H.claimNumber, H.dueDate], [ALEF, "أقرار", "0001", day("2026-04-30")]))).toEqual({ problem: "columns", missing: [H.amount] })
        // Several, each named, in the file's own order of columns.
        expect(readTaxSheet(sheet([H.taxType, H.amount], ["دخل", 5]))).toEqual({ problem: "columns", missing: [H.company, H.claimNumber, H.item, H.dueDate] })
    })

    it("reads what's there of the columns that aren't needed", () => {
        const file = read(sheet([H.company, H.claimNumber, H.item, H.dueDate, H.amount], [ALEF, "000111000004", "أقرار تجاري", day("2026-04-30"), 100]))
        expect(claimOf(file.rows[0])).toEqual({
            claimNumber: "000111000004", item: "أقرار تجاري", taxType: null, registrationType: null,
            originalAmount: 100, paidAmount: 0, remainingAmount: 100, currency: null, status: null, periodStart: null, periodEnd: null, dueDate: "2026-04-30",
        })
    })

    it("refuses an empty file: no rows, or its headings alone", () => {
        expect(readTaxSheet([])).toEqual({ problem: "empty" })
        expect(readTaxSheet([{ line: 1, cells: [] }, { line: 2, cells: ["", null] }])).toEqual({ problem: "empty" })
        expect(readTaxSheet(sheet(SPLIT))).toEqual({ problem: "empty" })
        expect(readTaxSheet(sheet(SPLIT, [], ["", ""]))).toEqual({ problem: "empty" })
    })

    it(`refuses more than ${TAX_FILE_MAX_ROWS.toLocaleString("en-GB")} rows, and takes that many`, () => {
        const row = (i: number) => single({ 3: `0001${String(i).padStart(8, "0")}` })
        const most = Array.from({ length: TAX_FILE_MAX_ROWS }, (_, i) => row(i))
        expect(read(sheet(SINGLE, ...most)).rows).toHaveLength(TAX_FILE_MAX_ROWS)
        expect(readTaxSheet(sheet(SINGLE, ...most, row(TAX_FILE_MAX_ROWS)))).toEqual({ problem: "too_many", rows: TAX_FILE_MAX_ROWS + 1 })
        // Empty rows aren't counted.
        expect(read(sheet(SINGLE, ...most, [], [""])).rows).toHaveLength(TAX_FILE_MAX_ROWS)
    })

    it("holds a file to 2 MB", () => {
        expect(TAX_FILE_MAX_BYTES).toBe(2 * 1024 * 1024)
        expect(TAX_FILE_MAX_ROWS).toBe(2000)
    })
})

describe("days and amounts, as they may be written", () => {
    it("reads a day as the sheet's date, or as dd/mm/yyyy text in either kind of digits", () => {
        const due = (value: unknown) => read(sheet(SPLIT, partly({ 12: value }))).rows[0]
        expect(due(day("2026-04-30")).dueDate).toBe("2026-04-30")
        expect(due("30/04/2026").dueDate).toBe("2026-04-30")
        expect(due(" 5/4/2026 ").dueDate).toBe("2026-04-05")
        expect(due("٣٠/٠٤/٢٠٢٦").dueDate).toBe("2026-04-30")
        expect(due("30/04/2026").mistakes).toEqual([])
        // A date cell with a time of day in it is still its day.
        expect(due(new Date("2026-04-30T21:30:00Z")).dueDate).toBe("2026-04-30")
    })

    it("never guesses a day: an impossible one, another way of writing one, or a bare number says what the file had", () => {
        const due = (value: unknown) => read(sheet(SPLIT, partly({ 12: value }))).rows[0]
        for (const [written, detail] of [["31/02/2026", "31/02/2026"], ["2026-04-30", "2026-04-30"], ["04/30/2026", "04/30/2026"], ["قريبًا", "قريبًا"], [46142, "46142"], ["30/04/26", "30/04/26"]] as const) {
            const row = due(written)
            expect(row.dueDate, String(written)).toBeNull()
            expect(row.mistakes, String(written)).toEqual([{ code: "due_unreadable", detail }])
        }
    })

    it("reads an amount as a number, or as text with either kind of digits and thousands separators", () => {
        const amounts = (original: unknown, paid: unknown, remaining: unknown) => read(sheet(SPLIT, partly({ 5: original, 6: paid, 7: remaining }))).rows[0]
        const expected = { originalAmount: 21088.26, paidAmount: 7365, remainingAmount: 13723.26, mistakes: [] }
        expect(amounts(21088.26, 7365, 13723.26)).toMatchObject(expected)
        expect(amounts("21,088.26", "7,365", "13,723.26")).toMatchObject(expected)
        expect(amounts("٢١٬٠٨٨٫٢٦", "٧٬٣٦٥", "١٣٬٧٢٣٫٢٦")).toMatchObject(expected)
        expect(amounts(" 21088.26 ", "7365.00", "13723.26")).toMatchObject(expected)
        // What a sum leaves behind in a sheet's number isn't a third decimal.
        expect(amounts(0.1 + 0.2 + 21087.96, 7365, 13723.26)).toMatchObject(expected)
        expect(amounts(21088.26, 21088.26 - 13723.26, 13723.26)).toMatchObject(expected)
        // Several thousands separators, and one digit after the point.
        expect(amounts("12,345,678.9", "0", "12,345,678.90")).toMatchObject({ originalAmount: 12345678.9, paidAmount: 0, remainingAmount: 12345678.9, mistakes: [] })
        // As large as the database holds, to the piastre.
        expect(amounts(999999999999.99, 0, 999999999999.99)).toMatchObject({ originalAmount: 999999999999.99, remainingAmount: 999999999999.99, mistakes: [] })
    })

    it("never guesses an amount: words, another way of writing it, or one finer than a piastre", () => {
        const original = (value: unknown) => read(sheet(SPLIT, partly({ 5: value }))).rows[0]
        for (const [written, detail] of [["كثير", "كثير"], ["21.088,26", "21.088,26"], [21088.265, "21088.265"], ["12 جنيه", "12 جنيه"], [1e15, "1000000000000000"]] as const) {
            const row = original(written)
            expect(row.originalAmount, String(written)).toBeNull()
            expect(row.mistakes, String(written)).toEqual([{ code: "amount_unreadable", detail }])
        }
        expect(original("").mistakes).toEqual([{ code: "amount_missing" }])
        expect(original(null).mistakes).toEqual([{ code: "amount_missing" }])
    })

    // From Codex's review of PR 314. With the commas taken out before the
    // amount was looked at, "12,50" was read as 1,250 and "1.000,00" as 1,
    // with nothing wrong said of either: in the one amount column the
    // misread amount was both the original and what remains.
    it("takes a comma or a point only where a thousands separator or the decimal point goes, never as the other's", () => {
        const one = (value: unknown) => read(sheet(SINGLE, single({ 4: value }))).rows[0]
        for (const written of ["12,50", "1.000,00", "1,00", "1.000", "12,345,67", "1,2345", ",500", "1,,000", "1 234.50", "12.5.0", "9.", ".45"]) {
            const row = one(written)
            expect(row.remainingAmount, written).toBeNull()
            expect(row.mistakes, written).toEqual([{ code: "amount_unreadable", detail: written }])
        }
        // What is a thousands separator, and a decimal point, is still read.
        expect(one("1,250")).toMatchObject({ remainingAmount: 1250, mistakes: [] })
        expect(one("1,000.00")).toMatchObject({ remainingAmount: 1000, mistakes: [] })
        expect(one("١٬٠٠٠٫٥٠")).toMatchObject({ remainingAmount: 1000.5, mistakes: [] })
        expect(one("12.5")).toMatchObject({ remainingAmount: 12.5, mistakes: [] })
    })

    // From Codex's review of PR 314 too. What was let pass as a sum's
    // leavings grew with the amount: 2,000,000,000.001 was read as
    // 2,000,000,000, its tenth of a piastre gone unsaid.
    it("refuses a third decimal however large the amount, as text or as the sheet's number", () => {
        const one = (value: unknown) => read(sheet(SINGLE, single({ 4: value }))).rows[0]
        for (const [written, detail] of [["2000000000.001", "2000000000.001"], [2000000000.001, "2000000000.001"], ["2,000,000,000.001", "2,000,000,000.001"], [999999999.994, "999999999.994"], [0.001, "0.001"], [5e-7, "5e-7"], ["10.555", "10.555"]] as const) {
            const row = one(written)
            expect(row.remainingAmount, String(written)).toBeNull()
            expect(row.mistakes, String(written)).toEqual([{ code: "amount_unreadable", detail }])
        }
        // To the piastre, they're read whole.
        expect(one(2000000000.01)).toMatchObject({ remainingAmount: 2000000000.01, mistakes: [] })
        expect(one("2,000,000,000.01")).toMatchObject({ remainingAmount: 2000000000.01, mistakes: [] })
        expect(one(999999999999.99)).toMatchObject({ remainingAmount: 999999999999.99, mistakes: [] })
    })
})

describe("each row, checked", () => {
    it("wants paid and remaining to add up to the original, to the piastre", () => {
        expect(codes(read(sheet(SPLIT, partly({ 6: 7365.01 }))))).toEqual(["amounts_dont_add_up"])
        expect(codes(read(sheet(SPLIT, partly({ 5: 21088.27 }))))).toEqual(["amounts_dont_add_up"])
        // Adding up in piastres, where adding the numbers themselves wouldn't: 0.1 + 0.2.
        expect(codes(read(sheet(SPLIT, partly({ 5: 0.3, 6: 0.1, 7: 0.2 }))))).toEqual([])
    })

    it("refuses a negative amount", () => {
        expect(codes(read(sheet(SPLIT, partly({ 6: -7365, 5: 6358.26 }))))).toEqual(["amount_negative"])
        expect(codes(read(sheet(SINGLE, single({ 4: -9.45 }))))).toEqual(["amount_negative"])
    })

    it("wants a claim number, an item and a last day to pay", () => {
        expect(codes(read(sheet(SPLIT, partly({ 4: "" }))))).toEqual(["number_missing"])
        expect(codes(read(sheet(SPLIT, partly({ 4: null }))))).toEqual(["number_missing"])
        expect(codes(read(sheet(SPLIT, partly({ 2: "  " }))))).toEqual(["item_missing"])
        expect(codes(read(sheet(SPLIT, partly({ 12: null }))))).toEqual(["due_missing"])
        // Everything wrong with a row is said at once, in one order.
        expect(codes(read(sheet(SPLIT, partly({ 4: "", 2: "", 12: "", 5: "x" }))))).toEqual(["number_missing", "item_missing", "due_missing", "amount_unreadable"])
    })

    it("refuses a claim number stored as a number, which may have lost the zeros at its start", () => {
        const file = read(sheet(SPLIT, partly({ 4: 111000001 })))
        expect(file.rows[0].claimNumber).toBe("111000001")
        expect(file.rows[0].mistakes).toEqual([{ code: "number_as_number", detail: "111000001" }])
        expect(claimOf(file.rows[0])).toBeNull()
    })

    it("keeps a claim number as text with its zeros, its digits as Latin ones", () => {
        expect(read(sheet(SPLIT, partly({ 4: " 000111000001 " }))).rows[0].claimNumber).toBe("000111000001")
        expect(read(sheet(SPLIT, partly({ 4: "٠٠٠١١١٠٠٠٠٠١" }))).rows[0].claimNumber).toBe("000111000001")
    })

    it("refuses a claim number that's in the file twice, on each of its rows, saying where the other is", () => {
        const file = read(sheet(SPLIT, partly(), waiting(), waiting({ 4: "٠٠٠١١١٠٠٠٠٠١" })))
        expect(file.rows.map(r => r.mistakes)).toEqual([[{ code: "number_twice", detail: "4" }], [], [{ code: "number_twice", detail: "2" }]])
    })

    it("refuses a tax period that isn't days, or ends before it starts", () => {
        expect(read(sheet(SPLIT, partly({ 10: "2025" }))).rows[0].mistakes).toEqual([{ code: "period_unreadable", detail: "2025" }])
        expect(read(sheet(SPLIT, partly({ 11: "31/13/2025" }))).rows[0].mistakes).toEqual([{ code: "period_unreadable", detail: "31/13/2025" }])
        expect(codes(read(sheet(SPLIT, partly({ 10: day("2026-01-01"), 11: day("2025-12-31") }))))).toEqual(["period_backwards"])
        // A period may be left empty, or be one day.
        expect(codes(read(sheet(SPLIT, partly({ 10: null, 11: "" }))))).toEqual([])
        expect(codes(read(sheet(SPLIT, partly({ 10: day("2025-12-31"), 11: day("2025-12-31") }))))).toEqual([])
    })

    it("gives no claim for a row with something wrong", () => {
        const file = read(sheet(SPLIT, partly({ 6: 1 }), waiting()))
        expect(claimOf(file.rows[0])).toBeNull()
        expect(claimOf(file.rows[1])).not.toBeNull()
    })
})

describe("only open claims", () => {
    it("leaves a row with nothing left to pay out, and counts it", () => {
        const paid = partly({ 6: 21088.26, 7: 0, 9: "مسدد" })
        const file = read(sheet(SPLIT, partly(), paid, waiting()))
        expect(file.rows.map(r => r.claimNumber)).toEqual(["000111000001", "000111000002"])
        expect(file.leftOut).toBe(1)
        // Nothing left, whatever its status says.
        const stillOpen = read(sheet(SPLIT, partly({ 6: 21088.26, 7: 0 }), waiting()))
        expect(stillOpen.leftOut).toBe(1)
        expect(stillOpen.otherStatuses).toEqual([])
        expect(read(sheet(SINGLE, single({ 4: 0 }), single({ 3: "000111000010" }))).leftOut).toBe(1)
    })

    it("leaves a row whose status isn't an open one out too: a paid claim still shows its amount in the one amount column", () => {
        const file = read(sheet(SINGLE, single(), single({ 3: "000111000010", 5: "مسدد" }), single({ 3: "000111000011", 5: "ملغاة" })))
        expect(file.rows.map(r => r.claimNumber)).toEqual(["000111000009"])
        expect(file.leftOut).toBe(2)
    })

    it("names each status it left rows out for, with how many, so one that's still owed is seen before saving", () => {
        const file = read(sheet(SINGLE,
            single(),
            single({ 3: "000111000010", 5: "مسدد" }),
            single({ 3: "000111000011", 5: "ملغاة" }),
            single({ 3: "000111000012", 5: " مُسدَّد " }),
            single({ 3: "000111000013", 4: 0 }),
        ))
        // One status spelled two ways is one, by its first spelling; nothing left to pay isn't a status.
        expect(file.otherStatuses).toEqual([{ status: "مسدد", rows: 2 }, { status: "ملغاة", rows: 1 }])
        expect(file.leftOut).toBe(4)
        // A paid row with nothing left is under its status.
        expect(read(sheet(SPLIT, partly(), partly({ 4: "000111000007", 6: 21088.26, 7: 0, 9: "مسدد" }))).otherStatuses).toEqual([{ status: "مسدد", rows: 1 }])
        expect(read(sheet(SPLIT, partly(), waiting())).otherStatuses).toEqual([])
    })

    it("takes the two open statuses however the portal spells them", () => {
        for (const status of ["في انتظار السداد", "فى انتظار السداد", "مسدد جزئيًا", "مسدد جزئياً", "مسدد جزئيا", " مسدد  جزئياً "]) {
            expect(read(sheet(SPLIT, partly({ 9: status }))).leftOut, status).toBe(0)
        }
    })

    it("keeps a row with no status by what's left to pay", () => {
        expect(read(sheet(SPLIT, partly({ 9: "" }))).rows).toHaveLength(1)
        expect(read(sheet(SPLIT, partly({ 9: "", 6: 21088.26, 7: 0 }), waiting())).leftOut).toBe(1)
    })

    it("doesn't check a row it leaves out, and a file of paid claims alone is read, with none kept", () => {
        const file = read(sheet(SPLIT, partly({ 9: "مسدد", 4: "", 12: "soon" })))
        expect(file.rows).toEqual([])
        expect(file.leftOut).toBe(1)
        expect(file.company).toBe(ALEF)
    })

    it("counts a number that's twice in the file where one of its rows is left out", () => {
        const file = read(sheet(SPLIT, partly(), partly({ 9: "مسدد" })))
        expect(file.leftOut).toBe(1)
        expect(file.rows[0].mistakes).toEqual([{ code: "number_twice", detail: "3" }])
    })
})

describe("one company to a file", () => {
    it("refuses a file that names several, naming them as the file does", () => {
        expect(readTaxSheet(sheet(SPLIT, partly(), waiting({ 0: "شركة باء للتوريدات" }), waiting({ 0: "شركة باء للتوريدات", 4: "000111000003" }))))
            .toEqual({ problem: "companies", names: [ALEF, "شركة باء للتوريدات"] })
        // A paid row of another company's is another company's all the same.
        expect(readTaxSheet(sheet(SPLIT, partly(), partly({ 0: "شركة جيم", 9: "مسدد", 4: "000111000005" }))))
            .toEqual({ problem: "companies", names: [ALEF, "شركة جيم"] })
    })

    it("takes one company spelled two ways as one, by the name the file has first", () => {
        const file = read(sheet(SPLIT, partly(), waiting({ 0: "شركه  الف للتجاره" })))
        expect(file.company).toBe(ALEF)
    })

    it("doesn't take rows with no company, among rows that name one, as another company", () => {
        expect(read(sheet(SPLIT, partly(), waiting({ 0: "" }))).company).toBe(ALEF)
        expect(read(sheet(SPLIT, partly({ 0: null }), waiting({ 0: " " }))).company).toBe("")
    })
})

describe("whether the file is this client's", () => {
    it("is, where it names the client, or the company its last file named", () => {
        expect(fileNamesClient(ALEF, ALEF, null)).toBe(true)
        expect(fileNamesClient("شركه الف  للتجاره", ALEF, null)).toBe(true)
        expect(fileNamesClient(ALEF, "Alef Trading", ALEF)).toBe(true)
        expect(fileNamesClient("ALEF Trading", "Alef trading", null)).toBe(true)
    })

    it("isn't, where it names another, or none: the export button writes its own word for none", () => {
        expect(fileNamesClient("شركة باء للتوريدات", ALEF, null)).toBe(false)
        expect(fileNamesClient("شركة باء للتوريدات", "Alef Trading", ALEF)).toBe(false)
        expect(fileNamesClient("", ALEF, ALEF)).toBe(false)
        expect(UNNAMED_COMPANY).toBe("غير محدد")
        expect(fileNamesClient(UNNAMED_COMPANY, UNNAMED_COMPANY, UNNAMED_COMPANY)).toBe(false)
    })

    it("matches spellings with spaces, dashes, letter forms, vowel marks and the stretch line set aside", () => {
        expect(spellingKey("مساهمة تكافلية- تأمين صحي")).toBe(spellingKey("مساهمه تكافليه - تامين صحى"))
        expect(spellingKey("أقرار")).toBe(spellingKey("إقــرار"))
        expect(spellingKey("مُسدَّد")).toBe(spellingKey("مسدد"))
        expect(spellingKey("أقرار تجاري")).not.toBe(spellingKey("أقرار صناعي"))
        expect(spellingKey(null)).toBe("")
    })
})

describe("the day the figures are from", () => {
    const TODAY = "2026-11-18"

    it("is the date the export button puts in its file's name", () => {
        expect(dayFromFileName(`مطالبات - ${ALEF} - 2026-11-17.xlsx`, TODAY)).toBe("2026-11-17")
        expect(dayFromFileName(`مطالبات - ${ALEF} - 2026-11-18.xlsx`, TODAY)).toBe("2026-11-18")
        // A copy the browser numbered, and a company with a date in its own name.
        expect(dayFromFileName(`مطالبات - ${ALEF} - 2026-11-17 (1).xlsx`, TODAY)).toBe("2026-11-17")
        expect(dayFromFileName("مطالبات - شركة 2020-01-01 - 2026-11-17.xlsx", TODAY)).toBe("2026-11-17")
    })

    it("is nothing where the name has no date, an impossible one, or one after today", () => {
        expect(dayFromFileName("claims.xlsx", TODAY)).toBeNull()
        expect(dayFromFileName("مطالبات - 2026-13-45.xlsx", TODAY)).toBeNull()
        expect(dayFromFileName("مطالبات - 2026-11-19.xlsx", TODAY)).toBeNull()
        expect(dayFromFileName("مطالبات - 120260-11-170.xlsx", TODAY)).toBeNull()
        expect(dayFromFileName("", TODAY)).toBeNull()
    })
})

describe("what a claim must be, which the server checks again", () => {
    const claim: ClaimDraft = {
        claimNumber: "000111000001", item: "أقرار تجاري", taxType: "دخل", registrationType: null,
        originalAmount: 21088.26, paidAmount: 7365, remainingAmount: 13723.26,
        currency: "جنيه مصري", status: "مسدد جزئياً", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30",
    }

    it("finds nothing wrong with a claim as the file gives it", () => {
        expect(claimProblems(claim)).toEqual([])
        expect(claimProblems({ ...claim, periodStart: null, periodEnd: null, taxType: null, currency: null, status: null })).toEqual([])
    })

    it("says each thing wrong with one sent to it", () => {
        expect(claimProblems({ ...claim, claimNumber: " " })).toEqual(["number_missing"])
        expect(claimProblems({ ...claim, item: "" })).toEqual(["item_missing"])
        expect(claimProblems({ ...claim, dueDate: "" })).toEqual(["due_missing"])
        expect(claimProblems({ ...claim, dueDate: "2026-02-31" })).toEqual(["due_unreadable"])
        expect(claimProblems({ ...claim, dueDate: "30/04/2026" })).toEqual(["due_unreadable"])
        expect(claimProblems({ ...claim, periodEnd: "2025-13-01" })).toEqual(["period_unreadable"])
        expect(claimProblems({ ...claim, periodStart: "2026-01-01" })).toEqual(["period_backwards"])
        expect(claimProblems({ ...claim, paidAmount: -1, originalAmount: 13722.26 })).toEqual(["amount_negative"])
        expect(claimProblems({ ...claim, originalAmount: 21088.265 })).toEqual(["amount_unreadable"])
        // A third decimal however large the amount (from Codex's review of PR 314).
        expect(claimProblems({ ...claim, originalAmount: 2000000000.001, paidAmount: 0, remainingAmount: 2000000000.001 })).toEqual(["amount_unreadable"])
        expect(claimProblems({ ...claim, originalAmount: 2000000000.01, paidAmount: 0, remainingAmount: 2000000000.01 })).toEqual([])
        expect(claimProblems({ ...claim, originalAmount: Number.NaN })).toEqual(["amount_unreadable"])
        expect(claimProblems({ ...claim, paidAmount: 7365.01 })).toEqual(["amounts_dont_add_up"])
    })
})

describe("what an upload changes, against the claims there now", () => {
    const a: ClaimDraft = {
        claimNumber: "000111000001", item: "أقرار تجاري", taxType: "دخل", registrationType: null,
        originalAmount: 21088.26, paidAmount: 0, remainingAmount: 21088.26,
        currency: "جنيه مصري", status: "في انتظار السداد", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30",
    }
    const b: ClaimDraft = { ...a, claimNumber: "000111000002", item: "مساهمة تكافلية- تأمين صحي", originalAmount: 7029.42, remainingAmount: 7029.42 }
    const c: ClaimDraft = { ...a, claimNumber: "000111000003", originalAmount: 500, remainingAmount: 500 }

    it("has every claim new the first time", () => {
        expect(compareClaims([], [a, b])).toEqual({ added: [a, b], changed: [], gone: [], same: 0 })
    })

    it("has nothing changed by the same file again", () => {
        expect(compareClaims([a, b], [{ ...a }, { ...b }])).toEqual({ added: [], changed: [], gone: [], same: 2 })
        // The same to the piastre, however the numbers were come by.
        expect(compareClaims([{ ...a, originalAmount: 0.3, remainingAmount: 0.3 }], [{ ...a, originalAmount: 0.1 + 0.2, remainingAmount: 0.1 + 0.2 }]).same).toBe(1)
    })

    it("has a claim now partly paid changed, with what it was and what it is", () => {
        const paid: ClaimDraft = { ...a, paidAmount: 7365, remainingAmount: 13723.26, status: "مسدد جزئياً" }
        expect(compareClaims([a, b], [paid, b])).toEqual({ added: [], changed: [{ before: a, after: paid }], gone: [], same: 1 })
    })

    it("has a claim changed when anything kept of it differs", () => {
        for (const change of [{ dueDate: "2026-05-31" }, { item: "إقرار تجاري" }, { status: "مسدد جزئياً" }, { periodEnd: null }, { taxType: "قيمة مضافة" }, { currency: null }, { registrationType: "تسجيل عام" }] as Partial<ClaimDraft>[]) {
            expect(compareClaims([a], [{ ...a, ...change }]).changed, JSON.stringify(change)).toHaveLength(1)
        }
    })

    it("has a claim that isn't in the new file gone, and one that wasn't there new", () => {
        expect(compareClaims([a, b], [b, c])).toEqual({ added: [c], changed: [], gone: [a], same: 1 })
        // Every claim going, where the file has none open.
        expect(compareClaims([a, b], [])).toEqual({ added: [], changed: [], gone: [a, b], same: 0 })
    })

    it("adds up what remains to the piastre", () => {
        expect(remainingOf([])).toBe(0)
        expect(remainingOf([a, b, c])).toBe(28617.68)
        expect(remainingOf([{ ...a, remainingAmount: 0.1 }, { ...a, remainingAmount: 0.2 }])).toBe(0.3)
    })
})

// A claim as the check screen sends it to be saved: what claimOf gave.
const SENT: ClaimDraft = {
    claimNumber: "000111000001", item: "أقرار تجاري", taxType: "دخل", registrationType: null,
    originalAmount: 21088.26, paidAmount: 7365, remainingAmount: 13723.26,
    currency: "جنيه مصري", status: "مسدد جزئياً", periodStart: "2025-01-01", periodEnd: "2025-12-31", dueDate: "2026-04-30",
}

describe("never longer than the claims' table should hold (PR 315)", () => {
    it("refuses a claim number over 50 characters, and takes one of 50", () => {
        expect(TAX_NUMBER_MAX).toBe(50)
        expect(codes(read(sheet(SPLIT, partly({ 4: "9".repeat(50) }))))).toEqual([])
        expect(codes(read(sheet(SPLIT, partly({ 4: "9".repeat(51) }))))).toEqual(["number_too_long"])
    })

    it("refuses an item, a tax, a registration type or a currency over 200, naming its column", () => {
        expect(TAX_TEXT_MAX).toBe(200)
        expect(codes(read(sheet(SPLIT, partly({ 2: "ب".repeat(200) }))))).toEqual([])
        const file = read(sheet(SPLIT, partly({ 1: "ت".repeat(201), 2: "ب".repeat(201), 3: "ث".repeat(201), 8: "ج".repeat(201) })))
        expect(file.rows[0].mistakes).toEqual([
            { code: "text_too_long", detail: H.item }, { code: "text_too_long", detail: H.taxType },
            { code: "text_too_long", detail: H.registrationType }, { code: "text_too_long", detail: H.currency },
        ])
        expect(claimOf(file.rows[0])).toBeNull()
    })

    it("is checked again on a claim sent to be saved", () => {
        expect(claimProblems({ ...SENT, claimNumber: "9".repeat(51) })).toEqual(["number_too_long"])
        expect(claimProblems({ ...SENT, item: "ب".repeat(201) })).toEqual(["text_too_long"])
        expect(claimProblems({ ...SENT, status: "ح".repeat(201) })).toEqual(["text_too_long"])
        expect(claimProblems({ ...SENT, claimNumber: "9".repeat(50), currency: "ج".repeat(200) })).toEqual([])
    })

    it("sets aside what can't be seen and can't be kept: control characters, and half of a character's pair", () => {
        const file = read(sheet(SPLIT, partly({ 2: "أقرار\u0000 تجاري\u0007", 8: "جنيه\uD83D مصري 😀" })))
        expect(file.rows[0].mistakes).toEqual([])
        expect(claimOf(file.rows[0])).toMatchObject({ item: "أقرار تجاري", currency: "جنيه مصري 😀" })
    })
})

describe("a claim that's kept (§3.2)", () => {
    it("has something left to pay, and no status that says otherwise", () => {
        expect(isOpenClaim(SENT)).toBe(true)
        expect(isOpenClaim({ ...SENT, status: null })).toBe(true)
        expect(isOpenClaim({ ...SENT, status: "في  انتظار السداد" })).toBe(true)
        expect(isOpenClaim({ ...SENT, remainingAmount: 0 })).toBe(false)
        expect(isOpenClaim({ ...SENT, status: "مسدد" })).toBe(false)
        expect(isOpenClaim({ ...SENT, status: "ملغي" })).toBe(false)
    })
})

describe("the company a file names", () => {
    it("is its name, tidied, or nothing: no name, the export button's word for none, or more than a name", () => {
        expect(namedCompany(`  ${ALEF}  `)).toBe(ALEF)
        expect(namedCompany("")).toBeNull()
        expect(namedCompany(null)).toBeNull()
        expect(namedCompany(UNNAMED_COMPANY)).toBeNull()
        expect(namedCompany("غير  محدد")).toBeNull()
        expect(namedCompany("ش".repeat(TAX_TEXT_MAX))).toHaveLength(TAX_TEXT_MAX)
        expect(namedCompany("ش".repeat(TAX_TEXT_MAX + 1))).toBeNull()
        // One too long to be a name is never the client's, so saving asks.
        expect(fileNamesClient("ش".repeat(TAX_TEXT_MAX + 1), "ش".repeat(TAX_TEXT_MAX + 1), null)).toBe(false)
    })
})

describe("a claim as it's sent to be saved (§4.1)", () => {
    it("is the claim it says, as the file's reader would have given it", () => {
        expect(sentClaim(SENT)).toEqual(SENT)
        expect(sentClaim(JSON.parse(JSON.stringify(SENT)))).toEqual(SENT)
        // What may be empty can be left out, or sent as nothing.
        const needed = { claimNumber: SENT.claimNumber, item: SENT.item, originalAmount: SENT.originalAmount, paidAmount: SENT.paidAmount, remainingAmount: SENT.remainingAmount, dueDate: SENT.dueDate }
        expect(sentClaim(needed)).toEqual({ ...needed, taxType: null, registrationType: null, currency: null, status: null, periodStart: null, periodEnd: null })
    })

    it("tidies its number and its words as the reader does, so one claim stays one claim", () => {
        expect(sentClaim({ ...SENT, claimNumber: " ٠٠٠١١١٠٠٠٠٠١ ", item: "  أقرار\u0000   تجاري ", taxType: " ", currency: "جنيه\uD83D  مصري" }))
            .toEqual({ ...SENT, taxType: null, currency: "جنيه مصري" })
    })

    it("is nothing where a field is another kind of thing: a number sent as a number may have lost its zeros", () => {
        expect(sentClaim({ ...SENT, claimNumber: 111000001 })).toBeNull()
        expect(sentClaim({ ...SENT, item: ["أقرار"] })).toBeNull()
        expect(sentClaim({ ...SENT, dueDate: 46142 })).toBeNull()
        expect(sentClaim({ ...SENT, dueDate: null })).toBeNull()
        expect(sentClaim({ ...SENT, periodStart: 45658 })).toBeNull()
        expect(sentClaim({ ...SENT, status: { is: "open" } })).toBeNull()
        expect(sentClaim({ ...SENT, originalAmount: "21088.26" })).toBeNull()
        expect(sentClaim({ ...SENT, paidAmount: null })).toBeNull()
        for (const not of [null, undefined, "claim", 7, [SENT]]) expect(sentClaim(not)).toBeNull()
    })

    it("leaves what's wrong with what it says to the rows' rules", () => {
        const sent = sentClaim({ ...SENT, originalAmount: 21088.265, dueDate: "30/04/2026", periodStart: "" })
        expect(sent && claimProblems(sent)).toEqual(["due_unreadable", "period_unreadable", "amount_unreadable"])
    })
})

describe("an upload as it's sent to be saved (§4.1)", () => {
    const upload = {
        clientId: "noor", uploads: 2, asOf: "2026-11-17", fileName: `مطالبات - ${ALEF} - 2026-11-17.xlsx`, fileCompany: ALEF, confirmed: false,
        claims: [SENT, { ...SENT, claimNumber: "000111000002" }],
    }
    const taken = (body: unknown) => {
        const sent = sentUpload(body)
        if ("problem" in sent) throw new Error(`refused: ${sent.problem}`)
        return sent.upload
    }
    const refused = (body: unknown) => {
        const sent = sentUpload(body)
        return "problem" in sent ? sent.problem : null
    }

    it("is read whole: whose it is, how many files there were, the day, the file and each claim", () => {
        expect(taken(upload)).toEqual(upload)
        expect(taken(JSON.parse(JSON.stringify(upload)))).toEqual(upload)
    })

    it("takes a file with no open claim, and a client's first file", () => {
        expect(taken({ ...upload, claims: [] }).claims).toEqual([])
        expect(taken({ ...upload, uploads: 0 }).uploads).toBe(0)
    })

    it("is confirmed only where it says so, and tidies the file's names", () => {
        expect(taken({ ...upload, confirmed: true }).confirmed).toBe(true)
        for (const confirmed of ["true", 1, null, undefined]) expect(taken({ ...upload, confirmed }).confirmed).toBe(false)
        expect(taken({ ...upload, fileName: "  claims\u0000   2026.xlsx ", fileCompany: undefined })).toMatchObject({ fileName: "claims 2026.xlsx", fileCompany: "" })
        expect(taken({ ...upload, fileName: 7, fileCompany: ["x"] })).toMatchObject({ fileName: "", fileCompany: "" })
        // As much of a long name as the audit log keeps, and never half of a character's pair.
        expect(taken({ ...upload, fileName: "ملف".repeat(200) }).fileName).toHaveLength(255)
        expect(taken({ ...upload, fileName: "😀".repeat(200) }).fileName).toBe("😀".repeat(127))
    })

    it("gives each claim's amounts to the piastre, and its number as the reader would", () => {
        const sent = taken({ ...upload, claims: [{ ...SENT, claimNumber: "٠٠٠١١١٠٠٠٠٠١", originalAmount: 0.1 + 0.2, paidAmount: 0, remainingAmount: 0.1 + 0.2 }] })
        expect(sent.claims[0]).toMatchObject({ claimNumber: "000111000001", originalAmount: 0.3, paidAmount: 0, remainingAmount: 0.3 })
    })

    it("is refused where it can't be read: no client, no count of files, no day, or claims that aren't a list", () => {
        for (const body of [
            null, undefined, "upload", 7, [upload],
            { ...upload, clientId: "" }, { ...upload, clientId: " " }, { ...upload, clientId: 7 }, { ...upload, clientId: undefined },
            { ...upload, uploads: -1 }, { ...upload, uploads: 1.5 }, { ...upload, uploads: "2" }, { ...upload, uploads: undefined },
            { ...upload, asOf: "17/11/2026" }, { ...upload, asOf: "2026-02-30" }, { ...upload, asOf: null },
            { ...upload, claims: undefined }, { ...upload, claims: { 0: SENT } },
        ]) expect(refused(body), String(JSON.stringify(body)).slice(0, 80)).toBe("unreadable")
    })

    it("is refused for one claim that isn't right, whichever it is", () => {
        const other = { ...SENT, claimNumber: "000111000002" }
        const withOne = (claim: unknown) => refused({ ...upload, claims: [SENT, claim] })
        expect(withOne(other)).toBeNull()
        for (const wrong of [
            { claimNumber: 111000002 }, { claimNumber: " " }, { item: "" }, { dueDate: "2026-02-31" },
            { paidAmount: 7365.01 }, { paidAmount: -1, originalAmount: 13722.26 }, { originalAmount: 21088.265 },
            { periodStart: "2026-01-01" }, { claimNumber: "9".repeat(51) }, { item: "ب".repeat(201) },
        ]) expect(withOne({ ...other, ...wrong }), JSON.stringify(wrong).slice(0, 60)).toBe("unreadable")
        expect(withOne(null)).toBe("unreadable")
        expect(withOne("000111000002")).toBe("unreadable")
    })

    it("is refused for a claim that isn't open: nothing left to pay, or a status that says it's paid", () => {
        const other = { ...SENT, claimNumber: "000111000002" }
        expect(refused({ ...upload, claims: [SENT, { ...other, paidAmount: 21088.26, remainingAmount: 0 }] })).toBe("unreadable")
        expect(refused({ ...upload, claims: [SENT, { ...other, status: "مسدد" }] })).toBe("unreadable")
        expect(refused({ ...upload, claims: [SENT, { ...other, status: null }] })).toBeNull()
    })

    it("is refused for a claim number that's there twice, however it's written", () => {
        expect(refused({ ...upload, claims: [SENT, { ...SENT }] })).toBe("unreadable")
        expect(refused({ ...upload, claims: [SENT, { ...SENT, claimNumber: "٠٠٠١١١٠٠٠٠٠١" }] })).toBe("unreadable")
        expect(refused({ ...upload, claims: [SENT, { ...SENT, claimNumber: " 000111000001 " }] })).toBe("unreadable")
    })

    it(`is refused over ${TAX_FILE_MAX_ROWS.toLocaleString("en-GB")} claims, and takes that many`, () => {
        const many = (count: number) => Array.from({ length: count }, (_, i) => ({ ...SENT, claimNumber: String(i).padStart(12, "0") }))
        expect(refused({ ...upload, claims: many(TAX_FILE_MAX_ROWS) })).toBeNull()
        expect(refused({ ...upload, claims: many(TAX_FILE_MAX_ROWS + 1) })).toBe("too_many")
        // Counted before any claim is read.
        expect(refused({ ...upload, claims: Array.from({ length: TAX_FILE_MAX_ROWS + 1 }, () => null) })).toBe("too_many")
    })
})
