import { MAX_EVENT_BYTES, isPicture, type TerminalEvent } from "./hikvision-events"

/**
 * A terminal's first contacts, kept to compare what a real terminal sends
 * with what Nizmo expects (ATTENDANCE_PLAN.md §17.8, PR 294). No terminal
 * was on hand when the receiving route was built, so the first requests
 * each one sends are kept for the Super Admin to read: their headers and
 * bodies, with whatever says who somebody is taken out.
 *
 * This is what is kept of one request, and what is left out of it. What
 * a punch keeps of its event for good is narrower still, and by name
 * (lib/attendance/hikvision-events.ts): this is a look at what came, kept
 * for a week.
 */

/** How many of a terminal's requests are kept. */
export const FIRST_CONTACTS = 50
/**
 * And how many of one kind. A terminal that says it is there every few
 * seconds would fill the 50 before anyone scanned.
 */
export const FIRST_CONTACTS_OF_A_KIND = 5
/** For how long from a terminal's first request they are kept, and how long each stays. */
export const FIRST_CONTACT_DAYS = 7
/** The most that is kept of one body. An event is a few hundred characters. */
export const MAX_KEPT_BODY = 8_000

/** Of a body that is neither JSON nor XML, where nothing can be told apart for sure. */
const MAX_UNREAD_TEXT = 600
/** Past this a text isn't a name or a mode: it is a template, or a picture sent as text. */
const MAX_TEXT = 200
const MAX_HEADER = 300
const MAX_OTHER_HEADERS = 60
const MAX_KIND = 120

/** Whether a terminal's requests are still kept: from before its first, until 7 days after it. */
export function keepingFor(firstContactAt: Date | null, now: Date): boolean {
    return !firstContactAt || now.getTime() < firstContactAt.getTime() + FIRST_CONTACT_DAYS * 86_400_000
}

/** Whether there is room for one more, and for one more of its kind once that is known. */
export function roomFor(counts: readonly { kind: string; count: number }[], kind?: string): boolean {
    if (counts.reduce((sum, c) => sum + c.count, 0) >= FIRST_CONTACTS) return false
    return kind === undefined || (counts.find(c => c.kind === kind)?.count ?? 0) < FIRST_CONTACTS_OF_A_KIND
}

// --- headers -----------------------------------------------------------------

/**
 * The headers kept with their values: the ones a terminal sends that say
 * how it speaks. Every other is kept by its name alone: the hosting adds
 * its own to each request, and some of those are credentials.
 */
const KEPT_HEADERS: ReadonlySet<string> = new Set([
    "accept", "accept-encoding", "accept-language", "cache-control", "connection", "content-encoding", "content-length",
    "content-type", "expect", "host", "keep-alive", "pragma", "transfer-encoding", "user-agent",
])
/** Kept as their scheme at most: what follows it is a password, or as good as one. */
const CREDENTIALS: ReadonlySet<string> = new Set(["authorization", "proxy-authorization"])

const withoutSecret = (text: string, secret: string) => (secret ? text.split(secret).join("[secret]") : text)

export function headersOf(headers: Headers, secret: string): { headers: Record<string, string>; others: string[] } {
    const kept: Record<string, string> = {}
    const others: string[] = []
    headers.forEach((value, name) => {
        const key = name.toLowerCase()
        if (KEPT_HEADERS.has(key)) kept[key] = withoutSecret(value, secret).slice(0, MAX_HEADER)
        else if (CREDENTIALS.has(key)) {
            const scheme = /^([A-Za-z][A-Za-z0-9-]{0,19})\s+\S/.exec(value)?.[1]
            kept[key] = scheme ? `${scheme} [removed]` : "[removed]"
        } else if (key === "cookie") kept[key] = "[removed]"
        else others.push(key.slice(0, 60))
    })
    return { headers: kept, others: others.sort().slice(0, MAX_OTHER_HEADERS) }
}

// --- what is taken out of a body ---------------------------------------------

/** The terminal's own names: every other name in an event is somebody's. */
const NOT_A_PERSON: ReadonlySet<string> = new Set(["devicename", "channelname"])
const isName = (key: string) => /name/i.test(key) && !NOT_A_PERSON.has(key.toLowerCase())
/** A card's number, not what only speaks of card readers or kinds of card. */
const isCard = (key: string) => /^card(no|number|num|id)?$/i.test(key)
/** A picture, its address, or a template of a finger, a face, an eye or a palm. */
const isPictureKey = (key: string) => /pic|photo|image|img|snapshot|capture|template|finger|iris|palm|facedata|facemodel|modeldata/i.test(key)

const NAME_REMOVED = "[name removed]"
const CARD_REMOVED = "[card number removed]"
const count = (n: number) => n.toLocaleString("en-US")

/** One text value under its key: what is kept of it, or a note of what was there. */
function leaf(key: string, value: string, inPicture = false): string {
    if (!value) return value
    if (isName(key)) return NAME_REMOVED
    if (isCard(key)) return CARD_REMOVED
    if (inPicture || isPictureKey(key)) return `[removed, ${count(value.length)} characters]`
    return value.length > MAX_TEXT ? `[text removed, ${count(value.length)} characters]` : value
}

const MAX_DEPTH = 8
const MAX_ITEMS = 50

/** A JSON value with names, card numbers, pictures and long text taken out. */
function walk(value: unknown, key: string, inPicture: boolean, depth: number): unknown {
    if (typeof value === "string") return leaf(key, value, inPicture)
    if (value === null || typeof value !== "object") {
        // A number can be a card's or a name's as well as a text can.
        if (typeof value === "number" && isName(key)) return NAME_REMOVED
        if (typeof value === "number" && isCard(key)) return CARD_REMOVED
        return value
    }
    if (isName(key)) return NAME_REMOVED
    if (isCard(key)) return CARD_REMOVED
    if (depth >= MAX_DEPTH) return "[nested too deep to keep]"
    const within = inPicture || isPictureKey(key)
    if (Array.isArray(value)) {
        const items = value.slice(0, MAX_ITEMS).map(item => walk(item, key, within, depth + 1))
        return value.length > MAX_ITEMS ? [...items, `[${count(value.length - MAX_ITEMS)} more, not kept]`] : items
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_ITEMS * 4)) out[k.slice(0, 80)] = walk(v, k, within, depth + 1)
    return out
}

const objectOf = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null

/** A type as a short word, so a kind can't carry anything else. */
const word = (value: unknown) => (typeof value === "string" || typeof value === "number" ? String(value).replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) : "")
const code = (value: unknown) => ((typeof value === "number" && Number.isInteger(value)) || (typeof value === "string" && /^\d{1,6}$/.test(value.trim())) ? String(value).trim() : "?")

/** What kind of event one is: its type, and for an access event its two codes. */
function kindOfEvent(event: unknown): string | null {
    const outer = objectOf(event)
    if (!outer) return null
    const inner = objectOf(outer.AccessControllerEvent)
    const type = word(outer.eventType) || "event"
    return inner ? `${type} ${code(inner.majorEventType ?? inner.major)}/${code(inner.subEventType ?? inner.minor)}` : type
}

const element = (xml: string, name: string): string | undefined => new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml)?.[1]

/** The older XML, element by element: the same rules by each element's name. */
function redactXml(xml: string): string {
    return xml
        // What a CDATA section holds can't be told apart: it goes whole.
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "[text removed]")
        .replace(/<([A-Za-z_][\w.:-]*)((?:\s[^<>]*)?)>([^<]*)<\/\1>/g, (_whole, tag: string, attrs: string, value: string) =>
            `<${tag}${attrs.length > 100 ? "" : attrs}>${leaf(tag.replace(/^.*:/, ""), value)}</${tag}>`)
}

/**
 * Text that is neither, where nothing can be told apart for sure: what
 * looks like a pair of a name and its value, in any of three spellings,
 * goes by the same rules.
 */
function redactLoose(text: string): string {
    return redactXml(text)
        .replace(/("([\w.-]*)"\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (whole, lead: string, key: string, value: string) => {
            const kept = leaf(key, value)
            return kept === value ? whole : `${lead}"${kept}"`
        })
        .replace(/(^|[&?;\s])([\w.-]+)=([^&;\s]*)/g, (whole, lead: string, key: string, value: string) => {
            const kept = leaf(key, value)
            return kept === value ? whole : `${lead}${key}=${kept}`
        })
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)} … [cut: ${count(text.length)} characters in all]` : text)

/**
 * What is kept of a body's text, and the kind of each event in it. JSON
 * is kept a field to a line, as it reads; XML as it came; anything else
 * to its first 600 characters.
 */
export function textOf(text: string): { body: string; kinds: string[] } {
    const body = text.trim()
    if (body.startsWith("{") || body.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(body)
            const events = Array.isArray(parsed) ? parsed : [parsed]
            return { body: JSON.stringify(walk(parsed, "", false, 0), null, 2), kinds: events.map(kindOfEvent).filter((k): k is string => k !== null) }
        } catch {
            // Not JSON after all: kept as text that is neither, below.
        }
    }
    if (body.startsWith("<") && body.includes("<EventNotificationAlert")) {
        const type = word(element(body, "eventType")) || "event"
        const access = /<AccessControllerEvent[\s>]/.test(body)
        return { body: redactXml(body), kinds: [access ? `${type} ${code(element(body, "majorEventType"))}/${code(element(body, "subEventType"))}` : type] }
    }
    return { body: cut(redactLoose(body), MAX_UNREAD_TEXT), kinds: [] }
}

/** What kind of file a part is, without its own name: a file's name can be a person's. */
function fileOf(file: File): string {
    const extension = /\.[A-Za-z0-9]{1,5}$/.exec(file.name)?.[0].toLowerCase() ?? "no extension"
    const type = /^[a-z0-9.+-]+\/[a-z0-9.+-]+/i.exec(file.type)?.[0].toLowerCase() ?? "no type"
    return `a file (${type}, ${extension}, ${count(file.size)} bytes)`
}

/** Text has no control characters but tabs and line ends: a picture or a template read as text has. */
const isText = (text: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)

/**
 * What is kept of a request's body, in whichever shape it came, and its
 * kind: each event's kind once, or `empty`, or `unreadable`. A form's
 * pictures are never opened: their part's name, type and size are kept.
 * The secret goes wherever it is.
 *
 * It reads the body, so it is given a copy of the request.
 */
export async function bodyOf(req: Request, secret: string): Promise<{ body: string; kind: string }> {
    const pieces: string[] = []
    const kinds = new Set<string>()
    let any = false
    const note = (piece: string) => {
        pieces.push(piece)
        any = true
    }
    const take = (label: string, text: string) => {
        const read = textOf(text)
        note(label ? `${label}\n${read.body}` : read.body)
        for (const kind of read.kinds) kinds.add(kind)
    }
    // Past the size Nizmo reads an event from, a text isn't opened here either: only how long it was is kept.
    const tooLong = (text: string) => text.length > MAX_EVENT_BYTES
    if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/")) {
        let form: FormData
        try {
            form = await req.formData()
        } catch {
            return { body: "[a form that couldn't be read]", kind: "unreadable" }
        }
        for (const [name, part] of form.entries()) {
            const label = `part "${word(name) || "?"}"`
            if (typeof part === "string") {
                if (tooLong(part)) note(`${label}: text, ${count(part.length)} characters, more than is read, not kept`)
                else take(`${label}: text, ${count(part.length)} characters`, part)
            } else if (isPicture(part) || part.size > MAX_EVENT_BYTES) {
                note(`${label}: ${fileOf(part)}, not opened`)
            } else {
                const text = await part.text()
                if (isText(text)) take(`${label}: ${fileOf(part)}, ${count(text.length)} characters`, text)
                else note(`${label}: ${fileOf(part)}, not kept: it isn't text`)
            }
        }
    } else {
        const text = await req.text()
        if (text.trim()) {
            if (tooLong(text)) note(`[${count(text.length)} characters, more than is read, not kept]`)
            else if (isText(text)) take("", text)
            else note(`[${count(text.length)} characters that aren't text, not kept]`)
        }
    }
    if (!any) return { body: "", kind: "empty" }
    const kind = kinds.size > 0 ? [...kinds].sort().join(" + ").slice(0, MAX_KIND) : "unreadable"
    return { body: cut(withoutSecret(pieces.join("\n\n"), secret), MAX_KEPT_BODY), kind }
}

// --- what Nizmo made of it ---------------------------------------------------

/**
 * What became of a request, each outcome once, a scan's first: stored,
 * already there, from before the company's terminals started, refused
 * and why, nothing to keep, unreadable, or empty.
 */
export function outcomeOf(
    events: readonly TerminalEvent[] | null,
    stored: { accepted: number; duplicates: number; skipped: number; refused: readonly { reason: string }[] } | null,
): string[] {
    if (events === null) return ["UNREADABLE"]
    if (events.length === 0) return ["EMPTY"]
    const out: string[] = []
    if (stored) {
        if (stored.accepted > 0) out.push("STORED")
        if (stored.duplicates > 0) out.push("ALREADY")
        if (stored.skipped > 0) out.push("SKIPPED")
        for (const refused of stored.refused) out.push(`REFUSED:${refused.reason}`)
    }
    for (const event of events) if (event.kind === "refused") out.push(`REFUSED:${event.reason}`)
    if (events.some(event => event.kind === "other")) out.push("NOTHING")
    return [...new Set(out)].slice(0, 8)
}
