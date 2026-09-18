/**
 * Writing a CSV somebody will open in Excel.
 *
 * Two separate problems, and only one of them is about commas.
 *
 * The first is quoting: a field containing a comma, a quote or a newline has to
 * be quoted and its quotes doubled, or the row silently gains or loses columns.
 * A payroll export where one person's reason contained a comma and every field
 * after it shifted by one is wrong in a way that looks plausible.
 *
 * The second is that a spreadsheet treats a leading =, +, - or @ as a formula.
 * A name typed as "=cmd|' /c calc'!A0" is a real attack on whoever opens the
 * file, and a reason field beginning with a minus sign is an accidental one —
 * Excel shows an error where a number should be. Both are fixed by prefixing a
 * single quote, which Excel eats and which a plain text reader shows as an
 * unremarkable character.
 */

const NEEDS_QUOTING = /[",\n\r]/
/** The four characters a spreadsheet reads as "this is a formula". */
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(value: unknown): string {
    if (value === null || value === undefined) return ""

    let text = String(value)

    // Neutralised before quoting, so the guard survives being wrapped.
    if (FORMULA_START.test(text)) text = `'${text}`

    if (NEEDS_QUOTING.test(text)) {
        return `"${text.replace(/"/g, '""')}"`
    }
    return text
}

export function csvRow(cells: unknown[]): string {
    return cells.map(csvCell).join(",")
}

/**
 * A whole file, with CRLF line endings and a BOM.
 *
 * The BOM is what makes Excel read the file as UTF-8 rather than as the local
 * codepage. Without it every Arabic name in this export opens as mojibake,
 * which is not a subtle failure but is a very common one.
 */
export function csvFile(rows: unknown[][]): string {
    return "﻿" + rows.map(csvRow).join("\r\n") + "\r\n"
}
