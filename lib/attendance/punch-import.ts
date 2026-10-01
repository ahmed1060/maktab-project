import { offsetMsIn } from "@/lib/time"

/**
 * Reading punches out of a spreadsheet (ATTENDANCE_PLAN.md Phase 0: XLSX/CSV
 * import). Pure: the route hands it rows of cells, already read from a CSV or
 * an Excel sheet, and it says which columns are which and what each row means.
 *
 * Terminal software exports in a handful of shapes: an employee number, then
 * either one date-and-time column or a date column and a time column, and
 * sometimes a check-in/check-out state. Headers come in English or Arabic,
 * digits sometimes in Arabic-Indic. Nothing here guesses a time it cannot
 * read: a row that does not parse is reported by its number, never stored.
 */

/** A cell as the readers produce it: text, a number, or a date from Excel. */
export type Cell = string | number | Date | null | undefined

export type ColumnMap = {
    code: number
    /** One column holding date and time, or the date alone when `time` is set. */
    date: number
    time: number | null
    direction: number | null
}

/** How to read a date written with slashes: day first (Egypt) or month first. */
export type DateOrder = "DMY" | "MDY"

export type ParsedRow =
    | { row: number; ok: true; code: string; local: string; direction: "IN" | "OUT" | null }
    | { row: number; ok: false; code: string | null; error: RowError }

export type RowError = "NO_CODE" | "NO_DATE" | "BAD_DATE" | "NO_TIME" | "BAD_TIME"

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩"
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹"

/** Text of a cell, trimmed, with Arabic-Indic digits made Western. */
export function cellText(cell: Cell): string {
    if (cell === null || cell === undefined) return ""
    if (cell instanceof Date) return isNaN(cell.getTime()) ? "" : cell.toISOString()
    return String(cell)
        .replace(/[٠-٩]/g, d => String(ARABIC_DIGITS.indexOf(d)))
        .replace(/[۰-۹]/g, d => String(PERSIAN_DIGITS.indexOf(d)))
        .replace(/‏|‎/g, "")
        .trim()
}

const norm = (s: string) => cellText(s).toLowerCase().replace(/[\s_\-./]+/g, " ").trim()

const CODE_HEADERS = ["ac no", "acno", "enroll no", "enrollno", "enroll id", "employee id", "employee no", "employee number", "emp id", "emp no", "emp code", "employee code", "user id", "userid", "badge", "badge no", "card no", "pin", "person id", "no", "id", "code", "رقم الموظف", "كود الموظف", "الكود", "الرقم", "رقم البصمة", "كود"]
const DATETIME_HEADERS = ["datetime", "date time", "time stamp", "timestamp", "check time", "checktime", "punch time", "clock time", "verify time", "log time", "التاريخ والوقت", "وقت البصمة"]
const DATE_HEADERS = ["date", "day", "punch date", "check date", "التاريخ", "اليوم"]
const TIME_HEADERS = ["time", "punch time only", "clock", "check in out time", "الوقت", "الساعة"]
const DIRECTION_HEADERS = ["state", "status", "type", "check type", "checktype", "in out", "inout", "punch type", "direction", "attendance state", "verify state", "الحالة", "النوع", "دخول خروج"]

function find(headers: string[], names: string[], taken: Set<number>): number | null {
    for (const name of names) {
        const i = headers.findIndex((h, j) => !taken.has(j) && h === name)
        if (i >= 0) return i
    }
    return null
}

/**
 * Which row is the header and which columns are which, read from the header
 * names. Null when no row in the first ten looks like a header with at least
 * an employee number and a date.
 */
export function detectColumns(rows: Cell[][]): { headerRow: number; columns: ColumnMap; headers: string[] } | null {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const headers = (rows[r] ?? []).map(c => norm(cellText(c)))
        const taken = new Set<number>()
        const code = find(headers, CODE_HEADERS, taken)
        if (code === null) continue
        taken.add(code)
        const datetime = find(headers, DATETIME_HEADERS, taken)
        if (datetime !== null) taken.add(datetime)
        const dateOnly = datetime ?? find(headers, DATE_HEADERS, taken)
        // With no date column, a lone "Time" column holds both (ZKTeco's export).
        const combined = dateOnly === null ? find(headers, TIME_HEADERS, taken) : null
        const date = dateOnly ?? combined
        if (date === null) continue
        taken.add(date)
        const time = datetime !== null || combined !== null ? null : find(headers, TIME_HEADERS, taken)
        if (time !== null) taken.add(time)
        const direction = find(headers, DIRECTION_HEADERS, taken)
        return { headerRow: r, columns: { code, date, time, direction }, headers: (rows[r] ?? []).map(cellText) }
    }
    return null
}

const pad = (n: number) => String(n).padStart(2, "0")

function validDate(y: number, m: number, d: number): boolean {
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false
    return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Excel's day count (1900 system) as calendar date and time of day. */
function fromExcelSerial(serial: number): { date: string; time: string | null } | null {
    if (!(serial > 0 && serial < 2958466)) return null
    const ms = Math.round((serial - 25569) * 86400) * 1000
    const d = new Date(ms)
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    const secs = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds()
    return { date, time: serial % 1 === 0 ? null : `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}` }
}

/**
 * A date cell's calendar date, and the time if it carries one. Excel dates
 * arrive as Date objects whose UTC fields are the wall clock written in the
 * sheet — the readers never apply a time zone to them.
 */
export function readDate(cell: Cell, order: DateOrder): { date: string; time: string | null } | null {
    if (cell instanceof Date) {
        if (isNaN(cell.getTime())) return null
        const date = `${cell.getUTCFullYear()}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())}`
        const hasTime = cell.getUTCHours() + cell.getUTCMinutes() + cell.getUTCSeconds() > 0
        return { date, time: hasTime ? `${pad(cell.getUTCHours())}:${pad(cell.getUTCMinutes())}:${pad(cell.getUTCSeconds())}` : null }
    }
    if (typeof cell === "number") return fromExcelSerial(cell)
    const text = cellText(cell)
    if (!text) return null
    if (/^\d+(\.\d+)?$/.test(text)) return fromExcelSerial(Number(text))

    let m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(.+))?$/)
    let y: number, mo: number, d: number, rest: string | undefined
    if (m) {
        ;[y, mo, d, rest] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]]
    } else {
        m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[T\s]+(.+))?$/)
        if (!m) return null
        const [a, b] = [Number(m[1]), Number(m[2])]
        ;[d, mo] = order === "DMY" ? [a, b] : [b, a]
        y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3])
        rest = m[4]
    }
    if (!validDate(y, mo, d)) return null
    const date = `${y}-${pad(mo)}-${pad(d)}`
    if (!rest) return { date, time: null }
    // An ISO string's zone is the reader's doing, not the sheet's: drop it.
    const time = readTime(rest.replace(/(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/, ""))
    return time ? { date, time } : null
}

/** "8:05", "08:05:30", "8:05 PM", "٨:٠٥ م", or Excel's fraction of a day. */
export function readTime(cell: Cell): string | null {
    if (cell instanceof Date) {
        if (isNaN(cell.getTime())) return null
        return `${pad(cell.getUTCHours())}:${pad(cell.getUTCMinutes())}:${pad(cell.getUTCSeconds())}`
    }
    if (typeof cell === "number") {
        if (!(cell >= 0 && cell < 1)) return null
        const secs = Math.round(cell * 86400) % 86400
        return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)}`
    }
    const text = cellText(cell).toLowerCase()
    const m = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|ص|م)?$/)
    if (!m) return null
    let h = Number(m[1])
    const min = Number(m[2]), s = Number(m[3] ?? 0)
    const half = m[4]
    if (half) {
        if (h < 1 || h > 12) return null
        const pm = half.startsWith("p") || half === "م"
        h = (h % 12) + (pm ? 12 : 0)
    }
    if (h > 23 || min > 59 || s > 59) return null
    return `${pad(h)}:${pad(min)}:${pad(s)}`
}

/** Check-in or check-out, from the words terminals and people use. Unknown is null. */
export function readDirection(cell: Cell): "IN" | "OUT" | null {
    const t = norm(cellText(cell))
    if (!t) return null
    if (/\bout\b|^o$|خروج|انصراف|^1$/.test(t) || t.includes("check out") || t.includes("c out")) return "OUT"
    if (/\bin\b|^i$|دخول|حضور|^0$/.test(t) || t.includes("check in") || t.includes("c in")) return "IN"
    return null
}

/** Every data row under the header, read with these columns. Blank rows are skipped. */
export function parseRows(rows: Cell[][], headerRow: number, columns: ColumnMap, order: DateOrder): ParsedRow[] {
    const out: ParsedRow[] = []
    for (let r = headerRow + 1; r < rows.length; r++) {
        const cells = rows[r] ?? []
        if (cells.every(c => cellText(c) === "")) continue
        // Rows are numbered as the spreadsheet shows them: from 1, header included.
        const row = r + 1
        const code = cellText(cells[columns.code]).replace(/\.0+$/, "")
        if (!code) { out.push({ row, ok: false, code: null, error: "NO_CODE" }); continue }
        const dateCell = cells[columns.date]
        if (cellText(dateCell) === "") { out.push({ row, ok: false, code, error: "NO_DATE" }); continue }
        const date = readDate(dateCell, order)
        if (!date) { out.push({ row, ok: false, code, error: "BAD_DATE" }); continue }
        let time = date.time
        if (columns.time !== null) {
            const timeCell = cells[columns.time]
            if (cellText(timeCell) === "") { out.push({ row, ok: false, code, error: "NO_TIME" }); continue }
            time = readTime(timeCell)
            if (!time) { out.push({ row, ok: false, code, error: "BAD_TIME" }); continue }
        }
        if (!time) { out.push({ row, ok: false, code, error: "NO_TIME" }); continue }
        const direction = columns.direction === null ? null : readDirection(cells[columns.direction])
        out.push({ row, ok: true, code, local: `${date.date}T${time}`, direction })
    }
    return out
}

/**
 * A CSV file's rows. Handles quoted cells, doubled quotes, a byte-order mark,
 * and the delimiter in use — comma, semicolon or tab, whichever the first line
 * has most of.
 */
export function parseCsv(text: string): string[][] {
    const src = text.replace(/^﻿/, "")
    const firstLine = src.split(/\r?\n/, 1)[0] ?? ""
    const counts = [",", ";", "\t"].map(d => [d, firstLine.split(d).length - 1] as const)
    const delimiter = counts.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    const rows: string[][] = []
    let row: string[] = [], cell = "", quoted = false
    for (let i = 0; i < src.length; i++) {
        const ch = src[i]
        if (quoted) {
            if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
            else if (ch === '"') quoted = false
            else cell += ch
        } else if (ch === '"' && cell === "") quoted = true
        else if (ch === delimiter) { row.push(cell); cell = "" }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && src[i + 1] === "\n") i++
            row.push(cell); rows.push(row); row = []; cell = ""
        } else cell += ch
    }
    if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row) }
    return rows
}

/**
 * The instant a wall-clock time in a zone stands for. A time that does not
 * exist there (inside a spring-forward gap) resolves to the moment after the
 * gap; one that exists twice (autumn) to its first occurrence.
 */
export function localToInstant(local: string, timeZone: string): Date {
    const [d, t] = local.split("T")
    const [y, mo, day] = d.split("-").map(Number)
    const [h, mi, s] = t.split(":").map(Number)
    const guess = Date.UTC(y, mo - 1, day, h, mi, s ?? 0)
    // The two offsets around it: one each side of any transition that day.
    const candidates = [...new Set([guess - offsetMsIn(new Date(guess - 86400_000), timeZone), guess - offsetMsIn(new Date(guess + 86400_000), timeZone)])]
    const valid = candidates.filter(c => c + offsetMsIn(new Date(c), timeZone) === guess)
    return new Date(valid.length > 0 ? Math.min(...valid) : Math.max(...candidates))
}
