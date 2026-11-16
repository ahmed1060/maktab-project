import { MAX_KEPT_BODY, headersOf, outcomeOf, unreadableText } from "./terminal-first-contact"
import { attlogOf, type AdmsLine, type AdmsRequest } from "./zkteco-adms"

/**
 * What is kept of a ZKTeco terminal's first requests (ATTENDANCE_PLAN.md
 * §17.8, Phase 4 part 6, PR 299), as a Hikvision terminal's are
 * (lib/attendance/terminal-first-contact.ts, PR 294): its request line,
 * its headers, what of its body, its kind, and what Nizmo made of it.
 *
 * Only scans are opened. What else a terminal sends, changes to the
 * people it holds above all, carries names, pictures and fingerprints, so
 * its body is never read: a note says so in its place.
 *
 * Nothing here needs Node or the database.
 */

const MAX_KIND = 120
const MAX_LINE = 1_000
const MAX_PATH = 120
const MAX_PARAMS = 30
const MAX_NAME = 40
const MAX_VALUE = 100
/** A scan's line is a few dozen characters: past this many, the rest are only counted. */
const MAX_LINES_READ = 400

const count = (n: number) => n.toLocaleString("en-US")

// --- its kind ----------------------------------------------------------------

/** The path under /iclock/ as a kind holds it: lower case, letters, digits and the marks a path has. */
function partOf(url: URL): string {
    const rest = url.pathname.replace(/^\/iclock\/?/i, "").toLowerCase().replace(/[^a-z0-9_./-]/g, "").slice(0, 40)
    return rest || "/"
}

/**
 * What kind of request it is, known from its address before anything it
 * sent is read: its options, its scans, changes to its people, its
 * heartbeat, or anything else by its method, path and table. Five of a
 * kind are kept, so a heartbeat every half minute doesn't crowd out the
 * scans.
 */
export function admsKind(asked: AdmsRequest, method: string, url: URL): string {
    switch (asked.kind) {
        case "options": return "options"
        case "scans": return "ATTLOG"
        case "people": return "OPERLOG"
        case "poll": return "getrequest"
        default: {
            const table = (url.searchParams.get("table") ?? "").replace(/[^A-Za-z0-9_]/g, "").toUpperCase().slice(0, 20)
            const verb = method.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10)
            return `${verb} ${partOf(url)}${table ? ` table=${table}` : ""}`.slice(0, MAX_KIND)
        }
    }
}

// --- its request line --------------------------------------------------------

/**
 * The parameters the protocol names, kept with their values (§17.3,
 * §17.11). Any other is kept by its name alone: a later firmware's could
 * carry something drawn from the comm key (§18).
 */
const NAMED: ReadonlySet<string> = new Set([
    "sn", "options", "pushver", "language", "pushoptionsflag", "devicetype", "type", "table", "tablename", "count",
    "stamp", "opstamp", "photostamp", "attlogstamp", "operlogstamp", "attphotostamp", "info",
])

const ADDRESS = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7})$/i

/**
 * What the terminal says of itself: firmware, then counts, then its
 * address on the office network, which is taken out wherever it is after
 * the firmware, as it isn't kept on the terminal either (§17.3).
 */
const infoKept = (value: string) => value.split(",").map((field, i) => (i > 0 && ADDRESS.test(field.trim()) ? "[address removed]" : field)).join(",")

/** A value as it can be shown: no control characters, and cut where it's long. */
function shown(value: string): string {
    const plain = value.replace(/[\u0000-\u001f\u007f]/g, " ")
    return plain.length > MAX_VALUE ? `${plain.slice(0, MAX_VALUE)} … [cut: ${count(plain.length)} characters in all]` : plain
}

/**
 * The request's path under /iclock/ as it came, and its query a parameter
 * at a time in the order sent: the values of the ones the protocol names,
 * and the rest by name alone, with how long their value was.
 */
export function admsRequestLine(url: URL): string {
    const path = url.pathname.replace(/[^A-Za-z0-9/._%-]/g, "?").slice(0, MAX_PATH)
    const params: string[] = []
    for (const [name, value] of url.searchParams) {
        if (params.length === MAX_PARAMS) {
            params.push("…")
            break
        }
        const key = name.replace(/[^A-Za-z0-9_.-]/g, "?").slice(0, MAX_NAME)
        const lower = name.toLowerCase()
        if (!value) params.push(`${key}=`)
        else if (!NAMED.has(lower)) params.push(`${key}=[removed, ${count(value.length)} characters]`)
        else params.push(`${key}=${shown(lower === "info" ? infoKept(value) : value)}`)
    }
    const line = params.length > 0 ? `${path}?${params.join("&")}` : path
    return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 3)} …` : line
}

// --- its body ----------------------------------------------------------------

const KEPT_ON_A_SCAN = [/^\d{4}-\d{2}-\d{2}$/, /^\d{2}:\d{2}:\d{2}$/, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, /^-?\d{1,5}$/]

/**
 * One line of an attendance upload. A line read as a scan keeps its
 * employee number, as the punch does, its date and time, and the short
 * numbers beside them, its tabs and spaces as they came; anything else on
 * it is replaced by a note of what was there. A line that isn't a scan
 * goes by the rules for unreadable text, where no name, card number or
 * long number is kept, whatever its shape: JSON or XML on a line of scans
 * is no event of a kind Nizmo reads (review on PR 299).
 */
function scanLineKept(line: string): string {
    if (attlogOf(line)[0]?.kind !== "scan") return unreadableText(line)
    let number = true
    return line.split(/(\s+)/).map(token => {
        if (token === "" || /^\s+$/.test(token)) return token
        if (number) {
            number = false
            return token
        }
        return KEPT_ON_A_SCAN.some(kept => kept.test(token)) ? token : `[removed, ${count(token.length)} characters]`
    }).join("")
}

/** An attendance upload's lines, each kept as a scan's line is, up to 8,000 characters of whole lines. */
export function scansKept(text: string): string {
    const all = text.split(/\r?\n/).filter(line => line.trim() !== "")
    const kept: string[] = []
    let length = 0
    for (const line of all.slice(0, MAX_LINES_READ)) {
        const one = scanLineKept(line)
        if (length + one.length + 1 > MAX_KEPT_BODY) break
        kept.push(one)
        length += one.length + 1
    }
    return kept.length < all.length ? `${kept.join("\n")}\n… [cut: ${count(all.length)} lines in all]` : kept.join("\n")
}

/** Whether a request may have a body: one that says it has none, or a GET that says nothing, hasn't. */
function hasBody(method: string, headers: Headers): boolean {
    const length = headers.get("content-length")
    if (length !== null) return length.trim() !== "0"
    return headers.has("transfer-encoding") || !["GET", "HEAD"].includes(method.toUpperCase())
}

/** In place of a body that isn't opened: why, or nothing where nothing was sent. */
export function notOpened(asked: AdmsRequest, method: string, headers: Headers): string {
    if (!hasBody(method, headers)) return ""
    return asked.kind === "people"
        ? "[not opened: changes to the people it holds carry their names]"
        : "[not opened: what isn't a scan can carry names, pictures or fingerprints]"
}

// --- what Nizmo made of it -----------------------------------------------------

type Stored = Parameters<typeof outcomeOf>[1]

/**
 * What became of a request: answered with its options; its scans stored,
 * already there, from before the company's terminals started, or refused
 * and why; nothing to keep, for a heartbeat or an upload with no lines;
 * or not opened.
 */
export function admsOutcome(asked: AdmsRequest, sentABody: boolean, lines: readonly AdmsLine[] | null, stored: Stored): string[] {
    switch (asked.kind) {
        case "options": return ["OPTIONS"]
        case "poll": return ["NOTHING"]
        case "scans": return lines && lines.length > 0 ? outcomeOf(lines, stored) : ["NOTHING"]
        default: return sentABody ? ["NOT_OPENED"] : ["NOTHING"]
    }
}

// --- a whole request -----------------------------------------------------------

/**
 * What is kept of one request Nizmo took. `read`: for scans, the body as
 * read, its lines, and what was stored of them. Nothing else is read.
 */
export function admsContact(req: Request, url: URL, asked: AdmsRequest, read: { text?: string; lines?: readonly AdmsLine[]; stored?: Stored }) {
    const { headers, others } = headersOf(req.headers, "")
    const scans = asked.kind === "scans"
    const body = scans ? scansKept(read.text ?? "") : notOpened(asked, req.method, req.headers)
    return {
        method: req.method,
        path: admsRequestLine(url),
        headers,
        otherHeaders: others,
        body,
        kind: admsKind(asked, req.method, url),
        outcome: admsOutcome(asked, body !== "", read.lines ?? null, read.stored ?? null),
    }
}
