/**
 * What a ZKTeco terminal straight to Nizmo asks and sends, read
 * (ATTENDANCE_PLAN.md §17.3, PR 296). A terminal set to a cloud server
 * calls fixed paths under `/iclock/`: its options first, then its scans as
 * they happen, and every half minute whether there is a command for it.
 * Nizmo sends none (§19): it only listens.
 *
 * The shapes are ZKTeco's own, from its HTTP PUSH SDK 2.0.1 document
 * (§17.11), with the names later firmware gives the same things beside
 * them. No terminal is on hand, so where a real one differs it has to
 * show: a line that can't be read is counted on the terminal, not dropped
 * (§17.8).
 *
 * Nothing here needs Node or the database.
 */

/** The routes as their pattern: what a failure is recorded under. */
export const ICLOCK_ROUTE = "/iclock/[...path]"

/** A serial number as a terminal's record holds it: letters, digits and the marks one may carry. */
const SERIAL = /^[A-Za-z0-9_.-]{1,64}$/

/** A stamp is a number the terminal counts by. Anything else isn't kept. */
const STAMP = /^\d{1,20}$/

/** The longest employee number Nizmo maps to a person (§2.3), as for the agent. */
const MAX_USER_NUMBER = 32

/** No firmware names itself in more than this. */
const MAX_FIRMWARE = 50

/** A terminal holds thousands of people and at most a few hundred thousand records. */
const MAX_COUNT = 10_000_000

export type TerminalInfo = { firmware: string | null; userCount: number | null; recordCount: number | null }

export type AdmsRequest =
    /** Its first call, and again after each restart: answered with its options. */
    | { kind: "options"; serial: string }
    /** Attendance records, a line each; `stamp` is where the terminal will have got to once they are taken. */
    | { kind: "scans"; serial: string; stamp: string | null }
    /** Changes to the people it holds, which carry names: never opened. Its stamp is kept so it isn't sent again. */
    | { kind: "people"; serial: string; stamp: string | null }
    /** Whether there is a command for it: its heartbeat, with what it says of itself. */
    | { kind: "poll"; serial: string; info: TerminalInfo | null }
    /** Anything else under /iclock: answered and dropped unread. */
    | { kind: "other"; serial: string }

const stampOf = (value: string | null): string | null => (value !== null && STAMP.test(value) ? value : null)

/**
 * What a request under `/iclock/` is for, by its method, path and query.
 * Null when it names no serial number that could be one: nothing is looked
 * up for it.
 */
export function admsRequest(method: string, url: URL): AdmsRequest | null {
    const serial = url.searchParams.get("SN")
    if (serial === null || !SERIAL.test(serial)) return null
    // The one part after /iclock/, without the ending old servers gave it (cdata.aspx).
    const part = /^\/iclock\/([^/]+)$/.exec(url.pathname)?.[1].replace(/\.[A-Za-z]+$/, "").toLowerCase()
    const verb = method.toUpperCase()
    const q = url.searchParams

    if (part === "getrequest" && verb === "GET") return { kind: "poll", serial, info: infoOf(q.get("INFO")) }
    if (part === "cdata" && verb === "GET" && q.has("options")) return { kind: "options", serial }
    if (part === "cdata" && verb === "POST") {
        const table = q.get("table")?.toUpperCase() ?? null
        // The 2.0.1 document's uploads name no table: a Stamp is the attendance log's, an OpStamp the people's.
        if (table === "ATTLOG" || (table === null && q.has("Stamp"))) return { kind: "scans", serial, stamp: stampOf(q.get("Stamp")) }
        if (table === "OPERLOG" || (table === null && q.has("OpStamp"))) return { kind: "people", serial, stamp: stampOf(q.get("OpStamp") ?? q.get("Stamp")) }
    }
    return { kind: "other", serial }
}

export type AdmsCursor = { scans: string; people: string }

/**
 * Where a terminal had got to in its two logs, as kept on it
 * (`pushCursor`): "ATTLOG=120;OPERLOG=9". 0 for one never heard from, so
 * it sends its whole memory on its first call (§17.6).
 */
export function cursorOf(kept: string | null): AdmsCursor {
    const read = (name: string) => new RegExp(`(?:^|;)${name}=(\\d{1,20})(?:;|$)`).exec(kept ?? "")?.[1] ?? "0"
    return { scans: read("ATTLOG"), people: read("OPERLOG") }
}

/** The same, with one log's stamp moved on and the other's as it was. */
export function cursorWith(kept: string | null, change: Partial<AdmsCursor>): string {
    const now = { ...cursorOf(kept), ...change }
    return `ATTLOG=${now.scans};OPERLOG=${now.people}`
}

/**
 * The options a terminal's first call is answered with, a line each, as
 * ZKTeco's document has them (§17.3): where it had got to, when to try
 * again and how often to ask, and what to send, attendance records and
 * nothing else (§17.5). Both names are given for each stamp, the
 * document's and later firmware's.
 *
 * `TimeZone` is the company's offset from UTC in whole hours, and none
 * for a zone off the hour: what a terminal does with it is the trial's to
 * answer (§18, 5). No command is among them (§19).
 */
export function optionsAnswer(serial: string, cursor: AdmsCursor, offsetMinutes: number): string {
    const lines = [
        `GET OPTION FROM: ${serial}`,
        `Stamp=${cursor.scans}`,
        `ATTLOGStamp=${cursor.scans}`,
        `OpStamp=${cursor.people}`,
        `OPERLOGStamp=${cursor.people}`,
        "ErrorDelay=60",
        "Delay=30",
        "TransTimes=00:00;14:05",
        "TransInterval=1",
        // One digit a kind of record, attendance first: the rest, changes to people and photos among them, stay on the terminal.
        "TransFlag=1000000000",
        "Realtime=1",
        "Encrypt=0",
    ]
    if (offsetMinutes % 60 === 0) lines.push(`TimeZone=${offsetMinutes / 60}`)
    return `${lines.join("\n")}\n`
}

/** What a scan keeps of its line (§17.5): its time as sent, and the short numbers beside it. No name is on a line. */
export type KeptLine = { time: string; status?: string; verify?: string; workCode?: string }

export type AdmsLine =
    /** The employee number, at the terminal's wall clock, with what the scan keeps of its line. */
    | { kind: "scan"; userNumber: string; at: string; kept: KeptLine }
    /** Not kept, and counted on the terminal with this reason. */
    | { kind: "refused"; reason: "UNREADABLE" | "INVALID_NUMBER" }

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/
const SHORT_NUMBER = /^-?\d{1,5}$/

/** A line's fields: by tabs, as the document has them, or by spaces where the tabs were lost, the date and time back together. */
function fieldsOf(line: string): string[] {
    if (line.includes("\t")) return line.split("\t").map(f => f.trim())
    const [number, date, time, ...rest] = line.trim().split(/\s+/)
    return time === undefined ? [number ?? ""] : [number, `${date} ${time}`, ...rest]
}

/**
 * The lines of an attendance upload: employee number, `YYYY-MM-DD
 * HH:MM:SS`, status, how the person was identified, and on later firmware
 * a work code and more. Each is read on its own. Whether a time is one a
 * calendar has is left to the steps every terminal's scan goes through
 * (§17.6).
 */
export function attlogOf(body: string): AdmsLine[] {
    const lines: AdmsLine[] = []
    for (const raw of body.split(/\r?\n/)) {
        if (raw.trim() === "") continue
        const [number, time, status, verify, workCode] = fieldsOf(raw)
        const at = WALL_CLOCK.exec(time ?? "")
        if (!number || !at) {
            lines.push({ kind: "refused", reason: "UNREADABLE" })
        } else if (number.length > MAX_USER_NUMBER) {
            lines.push({ kind: "refused", reason: "INVALID_NUMBER" })
        } else {
            const kept: KeptLine = { time: `${at[1]} ${at[2]}` }
            if (status !== undefined && SHORT_NUMBER.test(status)) kept.status = status
            if (verify !== undefined && SHORT_NUMBER.test(verify)) kept.verify = verify
            if (workCode !== undefined && SHORT_NUMBER.test(workCode)) kept.workCode = workCode
            lines.push({ kind: "scan", userNumber: number, at: `${at[1]}T${at[2]}`, kept })
        }
    }
    return lines
}

const countOf = (value: string | undefined): number | null => {
    if (value === undefined || !/^\d{1,9}$/.test(value.trim())) return null
    const n = Number(value.trim())
    return n <= MAX_COUNT ? n : null
}

/**
 * What a terminal says of itself when it asks for commands (`INFO`):
 * firmware, people enrolled, fingerprints, attendance records, and its
 * address on the office network. The first, second and fourth are kept
 * for its card. Its address there isn't.
 */
export function infoOf(value: string | null): TerminalInfo | null {
    if (value === null || value.trim() === "") return null
    const [firmware, users, , records] = value.split(",")
    return { firmware: firmware.trim().slice(0, MAX_FIRMWARE) || null, userCount: countOf(users), recordCount: countOf(records) }
}
