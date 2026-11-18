import { costNameKey } from "./client-statement"
import type { TaxClaimRow } from "./tax-claims"

/**
 * The Tax Authority portal's file, as the export button writes it
 * (CLIENT_PORTAL_PLAN.md §4.1, §10): read into the claims a client's tax
 * position becomes, each row checked. What the upload's check screen and
 * the server share: the browser reads the file for the check screen, and
 * the server checks every claim again before saving, trusting nothing it's
 * sent. Nothing is guessed: what can't be read is a mistake that says what
 * the file had (DESIGN.md §5.5, Rows read from a file).
 */

/** An `.xlsx` file of up to 2 MB and 2,000 rows (§4.1). */
export const TAX_FILE_MAX_BYTES = 2 * 1024 * 1024
export const TAX_FILE_MAX_ROWS = 2000

/** The columns' headings, as the portal's table has them and the export button writes them. */
export const TAX_FILE_HEADINGS = {
    company: "الشركة",
    taxType: "نوع الضريبة",
    item: "نوع بند السداد",
    registrationType: "نوع التسجيل الضريبي",
    claimNumber: "رقم المطالبة",
    /** The one amount column, where no claim in the file was partly paid. */
    amount: "قيمة المطالبة",
    /** The three it becomes where any was. */
    original: "قيمة المطالبة الأصلية",
    paid: "المسدد",
    remaining: "المتبقي",
    currency: "عملة المطالبة",
    status: "حالة المطالبة",
    periodStart: "بداية الفترة الضريبية",
    periodEnd: "نهاية الفترة الضريبية",
    dueDate: "آخر موعد للسداد قبل الغرامة",
} as const
type Column = keyof typeof TAX_FILE_HEADINGS

/** What's still owed (§3.2): waiting to be paid, and partly paid. */
export const OPEN_STATUSES = ["في انتظار السداد", "مسدد جزئيًا"] as const

/** What the export button writes for a page with no company name (§10). */
export const UNNAMED_COMPANY = "غير محدد"

/** As large as the claims' table holds. */
const MAX_AMOUNT = 999_999_999_999.99

/** A sheet's row as it was opened: its line in the file, and its cells from the first column. */
export type TaxSheetRow = { line: number; cells: unknown[] }

/** A claim as a file gives it, before it's saved: what's kept of it (§3.1). */
export type ClaimDraft = Omit<TaxClaimRow, "id" | "daysLate">

export type TaxMistakeCode =
    | "number_missing" | "number_as_number" | "number_twice"
    | "item_missing"
    | "due_missing" | "due_unreadable"
    | "period_unreadable" | "period_backwards"
    | "amount_missing" | "amount_unreadable" | "amount_negative" | "amounts_dont_add_up"

/** What's wrong with a row, with what the file had where that says it. */
export type TaxMistake = { code: TaxMistakeCode; detail?: string }

/** An open claim's row as the file had it: what could be read of it, and what's wrong with it. */
export type TaxFileRow = {
    /** Its line in the file, so it can be found there. */
    line: number
    claimNumber: string
    item: string
    taxType: string | null
    registrationType: string | null
    originalAmount: number | null
    paidAmount: number | null
    remainingAmount: number | null
    currency: string | null
    status: string | null
    periodStart: string | null
    periodEnd: string | null
    dueDate: string | null
    mistakes: TaxMistake[]
}

export type TaxFile = {
    /** The one company the file names; "" where it names none. */
    company: string
    /** Its open claims, in the file's order. */
    rows: TaxFileRow[]
    /** How many rows weren't open claims, and were left out (§3.2). */
    leftOut: number
    /**
     * Of those, the ones left out for their status, by status as the file
     * spelled it first: for the check screen to name, so a status that's
     * still owed is seen before saving. The rest had nothing left to pay.
     */
    otherStatuses: { status: string; rows: number }[]
}

/** Why a file is refused whole. */
export type TaxFileProblem =
    | { problem: "empty" }
    | { problem: "too_many"; rows: number }
    | { problem: "columns"; missing: string[] }
    | { problem: "companies"; names: string[] }

/**
 * What a heading, a company or a status is matched by (§3.3): its spelling
 * with capitals, spaces, dashes, Arabic's letter forms, its vowel marks and
 * the stretch line set aside. Another word is another name.
 */
export function spellingKey(text: string | null | undefined): string {
    return costNameKey(text).replace(/[\s\-‐-―−]/g, "")
}

const OPEN_KEYS: ReadonlySet<string> = new Set(OPEN_STATUSES.map(spellingKey))
const UNNAMED_KEY = spellingKey(UNNAMED_COMPANY)

const EASTERN_DIGITS = "٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹"
/** Arabic's digits, and Persian's, as Latin ones. */
const toLatin = (text: string) => text.replace(/[٠-٩۰-۹]/g, digit => String(EASTERN_DIGITS.indexOf(digit) % 10))

const blank = (cell: unknown) => cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "")
/** A cell as the words it shows, its spaces tidied. */
const words = (cell: unknown): string => {
    if (cell === null || cell === undefined) return ""
    if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? "" : cell.toISOString().slice(0, 10)
    return String(cell).replace(/\s+/g, " ").trim()
}

const piastres = (amount: number) => Math.round(amount * 100)
/**
 * No finer than a piastre. What a sum leaves behind in a sheet's number, the
 * last few of its bits, isn't a third decimal; anything more is one, however
 * large the amount (PR 314: what was let pass grew with the amount, and
 * 2,000,000,000.001 was read as 2,000,000,000).
 */
const wholePiastres = (amount: number) => Math.abs(amount - piastres(amount) / 100) <= Math.abs(amount) * Number.EPSILON * 4

/**
 * An amount written as text (§4.1): digits, with a comma only where a
 * thousands separator goes, and a point with one or two digits after it.
 * Checked as it's written, before any separator is taken out: "12,50" and
 * "1.000,00" are another way of writing, not 1,250 and 1 (PR 314).
 */
const WRITTEN_AMOUNT = /^-?(\d+|\d{1,3}([,٬]\d{3})+)([.٫]\d{1,2})?$/

/** A real calendar day as YYYY-MM-DD, or nothing. */
function dayOf(year: number, month: number, day: number): string | null {
    if (year < 1900 || year > 2200) return null
    const at = new Date(Date.UTC(year, month - 1, day))
    if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) return null
    return at.toISOString().slice(0, 10)
}
function isDay(text: string): boolean {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
    return !!parts && dayOf(Number(parts[1]), Number(parts[2]), Number(parts[3])) === text
}

/** What a cell was read as: its value, or what it had where that isn't one. Nothing for an empty cell. */
type Read<T> = { value: T } | { unread: string } | null

/** A day: the sheet's date, or dd/mm/yyyy written as text (§4.1). Any other way of writing one isn't guessed at. */
function readDay(cell: unknown): Read<string> {
    if (blank(cell)) return null
    if (cell instanceof Date) {
        // exceljs gives a date cell as that day's midnight, UTC.
        const day = Number.isNaN(cell.getTime()) ? null : dayOf(cell.getUTCFullYear(), cell.getUTCMonth() + 1, cell.getUTCDate())
        return day ? { value: day } : { unread: words(cell) }
    }
    if (typeof cell === "string") {
        const parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(toLatin(words(cell)))
        const day = parts && dayOf(Number(parts[3]), Number(parts[2]), Number(parts[1]))
        if (day) return { value: day }
    }
    return { unread: words(cell) }
}

/** An amount: a number, or text with either kind of digits and thousands separators (§4.1), to the piastre. */
function readAmount(cell: unknown): Read<number> {
    if (blank(cell)) return null
    let amount: number
    if (typeof cell === "number") amount = cell
    else if (typeof cell === "string") {
        const written = toLatin(cell.trim())
        if (!WRITTEN_AMOUNT.test(written)) return { unread: words(cell) }
        amount = Number(written.replace(/[,٬]/g, "").replace("٫", "."))
    } else return { unread: words(cell) }
    if (!Number.isFinite(amount) || Math.abs(amount) > MAX_AMOUNT || !wholePiastres(amount)) return { unread: words(cell) }
    return { value: piastres(amount) / 100 }
}

const valueOf = <T>(read: Read<T>): T | null => read && "value" in read ? read.value : null

/**
 * Reads the file's first sheet (§4.1): its columns found by their headings,
 * each open claim's row with what's wrong with it, and how many rows had
 * nothing left to pay. Or why the file is refused whole.
 */
export function readTaxSheet(sheet: readonly TaxSheetRow[]): TaxFile | TaxFileProblem {
    const filled = sheet.filter(row => row.cells.some(cell => !blank(cell)))
    const [headings, ...rows] = filled
    if (!headings) return { problem: "empty" }

    // Found by their headings, not where they are; the first of two with the same one.
    const at = new Map<string, number>()
    headings.cells.forEach((cell, index) => {
        const key = spellingKey(words(cell))
        if (key && !at.has(key)) at.set(key, index)
    })
    const has = (column: Column) => at.has(spellingKey(TAX_FILE_HEADINGS[column]))
    const cell = (row: TaxSheetRow, column: Column): unknown => {
        const index = at.get(spellingKey(TAX_FILE_HEADINGS[column]))
        return index === undefined ? undefined : row.cells[index]
    }

    // The amounts: the three columns where any claim was partly paid, or the
    // one, which is then both the original and what remains.
    const three = (["original", "paid", "remaining"] as const)
    const split = three.every(has)
    const missing: Column[] = (["company", "claimNumber", "item", "dueDate"] as const).filter(column => !has(column))
    if (!split && !has("amount")) missing.push(...(three.some(has) ? three.filter(column => !has(column)) : ["amount" as const]))
    if (missing.length) return { problem: "columns", missing: missing.map(column => TAX_FILE_HEADINGS[column]) }

    if (!rows.length) return { problem: "empty" }
    if (rows.length > TAX_FILE_MAX_ROWS) return { problem: "too_many", rows: rows.length }

    // One company to a file. A row that names none isn't another company.
    const companies = new Map<string, string>()
    for (const row of rows) {
        const name = words(cell(row, "company"))
        const key = spellingKey(name)
        if (key && !companies.has(key)) companies.set(key, name)
    }
    if (companies.size > 1) return { problem: "companies", names: [...companies.values()] }

    const open: TaxFileRow[] = []
    // Where each claim number is in the file, the rows left out too.
    const linesOf = new Map<string, number[]>()
    let leftOut = 0
    const otherStatuses = new Map<string, { status: string; rows: number }>()
    for (const row of rows) {
        const numberCell = cell(row, "claimNumber")
        const claimNumber = toLatin(words(numberCell))
        if (claimNumber) linesOf.set(claimNumber, [...(linesOf.get(claimNumber) ?? []), row.line])

        const amounts = split
            ? { original: readAmount(cell(row, "original")), paid: readAmount(cell(row, "paid")), remaining: readAmount(cell(row, "remaining")) }
            : (() => { const one = readAmount(cell(row, "amount")); return { original: one, paid: (one && "value" in one ? { value: 0 } : one) as Read<number>, remaining: one } })()

        // Only open claims are kept (§3.2). A paid one can still show its
        // amount in the one amount column, so its status says it.
        const status = words(cell(row, "status"))
        const statusKey = spellingKey(status)
        if (statusKey && !OPEN_KEYS.has(statusKey)) {
            leftOut++
            const other = otherStatuses.get(statusKey)
            if (other) other.rows++
            else otherStatuses.set(statusKey, { status, rows: 1 })
            continue
        }
        if (valueOf(amounts.remaining) === 0) {
            leftOut++
            continue
        }

        const mistakes: TaxMistake[] = []
        if (!claimNumber) mistakes.push({ code: "number_missing" })
        // A number in a sheet has no zeros at its start: they may be lost.
        else if (typeof numberCell === "number") mistakes.push({ code: "number_as_number", detail: claimNumber })

        const item = words(cell(row, "item"))
        if (!item) mistakes.push({ code: "item_missing" })

        const due = readDay(cell(row, "dueDate"))
        if (!due) mistakes.push({ code: "due_missing" })
        else if ("unread" in due) mistakes.push({ code: "due_unreadable", detail: due.unread })

        const periodStart = readDay(cell(row, "periodStart"))
        const periodEnd = readDay(cell(row, "periodEnd"))
        const unreadPeriod = [periodStart, periodEnd].find(day => day && "unread" in day) as { unread: string } | undefined
        if (unreadPeriod) mistakes.push({ code: "period_unreadable", detail: unreadPeriod.unread })
        else if (valueOf(periodStart) && valueOf(periodEnd) && valueOf(periodStart)! > valueOf(periodEnd)!) mistakes.push({ code: "period_backwards" })

        const read = split ? [amounts.original, amounts.paid, amounts.remaining] : [amounts.remaining]
        const unreadAmount = read.find(amount => amount && "unread" in amount) as { unread: string } | undefined
        const values = read.map(valueOf)
        if (read.some(amount => !amount)) mistakes.push({ code: "amount_missing" })
        if (unreadAmount) mistakes.push({ code: "amount_unreadable", detail: unreadAmount.unread })
        if (values.some(amount => amount !== null && amount < 0)) mistakes.push({ code: "amount_negative" })
        else if (values.every(amount => amount !== null) && piastres(valueOf(amounts.paid)!) + piastres(valueOf(amounts.remaining)!) !== piastres(valueOf(amounts.original)!)) mistakes.push({ code: "amounts_dont_add_up" })

        open.push({
            line: row.line,
            claimNumber,
            item,
            taxType: words(cell(row, "taxType")) || null,
            registrationType: words(cell(row, "registrationType")) || null,
            originalAmount: valueOf(amounts.original),
            paidAmount: valueOf(amounts.paid),
            remainingAmount: valueOf(amounts.remaining),
            currency: words(cell(row, "currency")) || null,
            status: status || null,
            periodStart: valueOf(periodStart),
            periodEnd: valueOf(periodEnd),
            dueDate: valueOf(due),
            mistakes,
        })
    }

    // A claim number only once in the file: said on each of its rows, with where the other is.
    for (const row of open) {
        const other = (linesOf.get(row.claimNumber) ?? []).find(line => line !== row.line)
        if (other === undefined) continue
        const twice: TaxMistake = { code: "number_twice", detail: String(other) }
        // After what's wrong with the number itself, before the rest.
        const after = row.mistakes.findIndex(mistake => !mistake.code.startsWith("number_"))
        row.mistakes.splice(after === -1 ? row.mistakes.length : after, 0, twice)
    }

    return { company: [...companies.values()][0] ?? "", rows: open, leftOut, otherStatuses: [...otherStatuses.values()] }
}

/** The claim a row with nothing wrong becomes; nothing for a row with a mistake. */
export function claimOf(row: TaxFileRow): ClaimDraft | null {
    if (row.mistakes.length || row.originalAmount === null || row.paidAmount === null || row.remainingAmount === null || row.dueDate === null) return null
    return {
        claimNumber: row.claimNumber,
        item: row.item,
        taxType: row.taxType,
        registrationType: row.registrationType,
        originalAmount: row.originalAmount,
        paidAmount: row.paidAmount,
        remainingAmount: row.remainingAmount,
        currency: row.currency,
        status: row.status,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        dueDate: row.dueDate,
    }
}

const isAmount = (amount: unknown): amount is number => typeof amount === "number" && Number.isFinite(amount) && Math.abs(amount) <= MAX_AMOUNT && wholePiastres(amount)

/**
 * What's wrong with a claim sent to be saved: the rows' rules again, which
 * the server runs on every claim, trusting nothing it's sent (§4.1). Its
 * number being there twice is the list's to say, not one claim's.
 */
export function claimProblems(claim: ClaimDraft): TaxMistakeCode[] {
    const found: TaxMistakeCode[] = []
    if (!words(claim.claimNumber)) found.push("number_missing")
    if (!words(claim.item)) found.push("item_missing")
    if (!claim.dueDate) found.push("due_missing")
    else if (!isDay(claim.dueDate)) found.push("due_unreadable")
    if ([claim.periodStart, claim.periodEnd].some(day => day !== null && !isDay(day))) found.push("period_unreadable")
    else if (claim.periodStart && claim.periodEnd && claim.periodStart > claim.periodEnd) found.push("period_backwards")
    const amounts = [claim.originalAmount, claim.paidAmount, claim.remainingAmount]
    if (!amounts.every(isAmount)) found.push("amount_unreadable")
    else if (amounts.some(amount => amount < 0)) found.push("amount_negative")
    else if (piastres(claim.paidAmount) + piastres(claim.remainingAmount) !== piastres(claim.originalAmount)) found.push("amounts_dont_add_up")
    return found
}

/**
 * The day the figures are from (§4.1): the date the export button puts in
 * its file's name, Cairo's that day (§10). The last one in the name, so a
 * copy the browser numbered still has it. Nothing where the name has none,
 * an impossible one, or one after today.
 */
export function dayFromFileName(name: string, today: string): string | null {
    const dates = /(^|\D)(\d{4})-(\d{2})-(\d{2})(?!\d)/g
    const text = toLatin(name)
    let last: RegExpExecArray | null = null
    for (let found = dates.exec(text); found; found = dates.exec(text)) last = found
    if (!last) return null
    const day = dayOf(Number(last[2]), Number(last[3]), Number(last[4]))
    return day && day <= today ? day : null
}

/**
 * Whether the file is plainly this client's (§4.1): its company is the
 * client's own name, or the one the client's last file named. A file that
 * names no company, as the export button's does for a page without one,
 * never is, so saving asks first.
 */
export function fileNamesClient(fileCompany: string, clientName: string, lastFileCompany: string | null): boolean {
    const key = spellingKey(fileCompany)
    if (!key || key === UNNAMED_KEY) return false
    return key === spellingKey(clientName) || (!!lastFileCompany && key === spellingKey(lastFileCompany))
}

const KEPT = ["item", "taxType", "registrationType", "currency", "status", "periodStart", "periodEnd", "dueDate"] as const
const AMOUNTS = ["originalAmount", "paidAmount", "remainingAmount"] as const
const sameClaim = (a: ClaimDraft, b: ClaimDraft) => KEPT.every(field => a[field] === b[field]) && AMOUNTS.every(field => piastres(a[field]) === piastres(b[field]))

/**
 * What an upload changes (§4.1), each upload replacing the last: the claims
 * that are new, those with anything kept of them changed, and those the new
 * file hasn't, which go. Told by claim number.
 */
export function compareClaims(current: readonly ClaimDraft[], next: readonly ClaimDraft[]): { added: ClaimDraft[]; changed: { before: ClaimDraft; after: ClaimDraft }[]; gone: ClaimDraft[]; same: number } {
    const before = new Map(current.map(claim => [claim.claimNumber, claim] as const))
    const after = new Set(next.map(claim => claim.claimNumber))
    const added: ClaimDraft[] = []
    const changed: { before: ClaimDraft; after: ClaimDraft }[] = []
    let same = 0
    for (const claim of next) {
        const was = before.get(claim.claimNumber)
        if (!was) added.push(claim)
        else if (sameClaim(was, claim)) same++
        else changed.push({ before: was, after: claim })
    }
    return { added, changed, gone: current.filter(claim => !after.has(claim.claimNumber)), same }
}

/** What remains to pay of these claims in all, to the piastre. */
export function remainingOf(claims: readonly Pick<ClaimDraft, "remainingAmount">[]): number {
    return claims.reduce((sum, claim) => sum + piastres(claim.remainingAmount), 0) / 100
}
