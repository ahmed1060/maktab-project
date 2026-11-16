/**
 * What a ZKTeco terminal that pushes to the agent asks and sends, read
 * (ATTENDANCE_PLAN.md §17.12, PR 304): a terminal whose firmware pushes
 * with ADMS, but only over plain HTTP, sends to the agent's PC on the
 * office network instead of to Nizmo, and is answered as Nizmo answers
 * one that sends to it (§17.3).
 *
 * The reading is Nizmo's own (lib/attendance/zkteco-adms.ts), copied: the
 * agent imports nothing from Nizmo. agent/test/adms.test.ts holds the two
 * in step. What Nizmo keeps of each line beside the scan (§17.5) is left
 * out: the agent sends a scan's employee number and time, as for a
 * terminal it reads.
 *
 * Nothing here needs the network.
 */

/** A serial number as a terminal's record holds it: letters, digits and the marks one may carry. */
const SERIAL = /^[A-Za-z0-9_.-]{1,64}$/

/** A stamp is a number the terminal counts by. Anything else isn't kept. */
const STAMP = /^\d{1,20}$/

/** The longest employee number Nizmo maps to a person (§2.3): a longer one would be refused with the whole batch. */
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
 * Null when it names no serial number that could be one.
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
 * Where a terminal had got to in its two logs, as kept for it:
 * "ATTLOG=120;OPERLOG=9". 0 for one never heard from, so it sends its
 * whole memory on its first call.
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
 * Nizmo answers them (§17.3): where it had got to, when to try again and
 * how often to ask, and what to send, attendance records and nothing
 * else. `TimeZone` is the company's offset from UTC in whole hours, and
 * none for a zone off the hour, or when the company's zone isn't known:
 * 0 would be UTC's (PR 305). No command is among them (§19).
 */
export function optionsAnswer(serial: string, cursor: AdmsCursor, offsetMinutes: number | null): string {
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
    if (offsetMinutes !== null && offsetMinutes % 60 === 0) lines.push(`TimeZone=${offsetMinutes / 60}`)
    return `${lines.join("\n")}\n`
}

export type AdmsLine =
    /** The employee number, at the terminal's wall clock. */
    | { kind: "scan"; userNumber: string; at: string }
    /** Not queued: a line that can't be read, or a number Nizmo would refuse. */
    | { kind: "refused"; reason: "UNREADABLE" | "INVALID_NUMBER" }

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/

/** A line's fields: by tabs, as the document has them, or by spaces where the tabs were lost, the date and time back together. */
function fieldsOf(line: string): string[] {
    if (line.includes("\t")) return line.split("\t").map(f => f.trim())
    const [number, date, time, ...rest] = line.trim().split(/\s+/)
    return time === undefined ? [number ?? ""] : [number, `${date} ${time}`, ...rest]
}

/**
 * The lines of an attendance upload: employee number, `YYYY-MM-DD
 * HH:MM:SS`, and more the agent doesn't send. Each is read on its own.
 * Whether a time is one a calendar has is Nizmo's to say, for each scan.
 */
export function attlogOf(body: string): AdmsLine[] {
    const lines: AdmsLine[] = []
    for (const raw of body.split(/\r?\n/)) {
        if (raw.trim() === "") continue
        const [number, time] = fieldsOf(raw)
        const at = WALL_CLOCK.exec(time ?? "")
        if (!number || !at) lines.push({ kind: "refused", reason: "UNREADABLE" })
        else if (number.length > MAX_USER_NUMBER) lines.push({ kind: "refused", reason: "INVALID_NUMBER" })
        else lines.push({ kind: "scan", userNumber: number, at: `${at[1]}T${at[2]}` })
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
 * address on the office network. The first, second and fourth are kept.
 */
export function infoOf(value: string | null): TerminalInfo | null {
    if (value === null || value.trim() === "") return null
    const [firmware, users, , records] = value.split(",")
    return { firmware: firmware.trim().slice(0, MAX_FIRMWARE) || null, userCount: countOf(users), recordCount: countOf(records) }
}

/** What the agent takes of one request that is a named terminal's, and answers it. */
export type Taken = {
    /** The answer's text, sent with 200 once what's below is kept. */
    answer: string
    /** Its scans, for the queue. */
    scans: { userNumber: string; at: string }[]
    /** Its lines that aren't queued: unreadable, or a number Nizmo would refuse. */
    unreadable: number
    /** Its stamps once this is taken, or null where they don't move. */
    cursor: string | null
    /** What it said of itself, on a poll. */
    info: TerminalInfo | null
}

/**
 * What a request is answered and what is kept of it, as Nizmo's
 * `/iclock/` handler takes one (lib/attendance/zkteco-handler.ts):
 * `kept` is where the terminal had got to, read just before. Only an
 * attendance upload's body is read; changes to people carry names and
 * are never opened, their stamp moved all the same so they aren't sent
 * again.
 */
export function take(asked: AdmsRequest, body: string | null, kept: string | null, offsetMinutes: number | null): Taken {
    const nothing: Taken = { answer: "OK\n", scans: [], unreadable: 0, cursor: null, info: null }
    switch (asked.kind) {
        case "options":
            return { ...nothing, answer: optionsAnswer(asked.serial, cursorOf(kept), offsetMinutes) }
        case "scans": {
            const lines = attlogOf(body ?? "")
            const scans = lines.flatMap(line => (line.kind === "scan" ? [{ userNumber: line.userNumber, at: line.at }] : []))
            // Every line counted in the answer, read or not, as Nizmo counts them.
            return { ...nothing, answer: `OK: ${lines.length}\n`, scans, unreadable: lines.length - scans.length, cursor: asked.stamp ? cursorWith(kept, { scans: asked.stamp }) : null }
        }
        case "people":
            return { ...nothing, cursor: asked.stamp ? cursorWith(kept, { people: asked.stamp }) : null }
        case "poll":
            // No command is ever sent (§19): this is its heartbeat.
            return { ...nothing, info: asked.info }
        default:
            return nothing
    }
}
