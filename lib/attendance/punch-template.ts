import { Workbook, type Row } from "exceljs"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"
import type { Locale, TranslationKey } from "@/lib/translations"
import { TEMPLATE_HEADINGS } from "./punch-import"

/**
 * The import's template (ATTENDANCE_PLAN.md §13.9, PR 272): an Excel file in
 * the page's language. Its first sheet holds nothing but the headings the
 * import reads, in text cells, so what is typed is what is read and a
 * template sent back unchanged imports nothing. How to fill it, with
 * examples, is on a second sheet, which the import never reads: it reads the
 * first sheet that has anything on it. Server-side only (exceljs).
 */

export const PUNCH_TEMPLATE_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

const EXAMPLE_CODE = "0123"
const EXAMPLE_DATE = "25/11/2026"
const EXAMPLE_TIMES = ["08:55", "17:05"]

// Excel's own number format for text: a number starting with 0 keeps it,
// and a date or a time is never turned into Excel's by the computer's own
// date order.
const TEXT = "@"

export async function punchTemplate(locale: Locale): Promise<Buffer> {
    const dict = (locale === "ar" ? ar : en) as Record<string, string>
    const t = (key: TranslationKey) => dict[key] ?? key
    const headings = TEMPLATE_HEADINGS[locale]
    const rightToLeft = locale === "ar"
    const book = new Workbook()

    const punches = book.addWorksheet(t("punch_template_sheet"), { views: [{ rightToLeft, state: "frozen", ySplit: 1 }] })
    punches.columns = [{ width: 20 }, { width: 14 }, { width: 10 }]
    for (const col of [1, 2, 3]) punches.getColumn(col).numFmt = TEXT
    headingRow(punches.addRow([...headings]))

    const help = book.addWorksheet(t("punch_template_help_sheet"), { views: [{ rightToLeft }] })
    help.columns = [{ width: 20 }, { width: 64 }, { width: 14 }]
    help.addRow([t("punch_template_help_title")]).font = { bold: true, size: 14 }
    help.addRow([t("punch_template_help_rows")])
    help.addRow([t("punch_template_help_upload")])
    help.addRow([])
    headingRow(help.addRow([t("punch_template_help_column"), t("punch_template_help_takes"), t("punch_template_help_example")]))
    help.addRow([headings[0], t("punch_template_help_code"), EXAMPLE_CODE])
    help.addRow([headings[1], t("punch_template_help_date"), EXAMPLE_DATE])
    help.addRow([headings[2], t("punch_template_help_time"), EXAMPLE_TIMES[0]])
    help.addRow([])
    help.addRow([t("punch_template_help_examples")]).font = { bold: true }
    headingRow(help.addRow([...headings]))
    for (const time of EXAMPLE_TIMES) help.addRow([EXAMPLE_CODE, EXAMPLE_DATE, time])
    help.eachRow(row => row.eachCell(cell => {
        cell.numFmt = TEXT
        cell.alignment = { vertical: "top", wrapText: true }
    }))

    return Buffer.from(await book.xlsx.writeBuffer())
}

function headingRow(row: Row) {
    row.font = { bold: true }
}
