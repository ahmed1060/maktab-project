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
/** A picture's address, or its file's name, whatever the field it is in is called. */
const isPictureAddress = (value: string) => /\.(?:jpe?g|png|bmp|gif|webp|heic)(?![A-Za-z0-9])/i.test(value)

/**
 * What a field's name says it holds. Whatever is under such a field holds
 * the same: a picture's address is under its picture, a first name under
 * a name (review on PR 294).
 */
type Holds = "name" | "card" | "picture" | null
const holds = (key: string): Holds => (isName(key) ? "name" : isCard(key) ? "card" : isPictureKey(key) ? "picture" : null)

const NAME_REMOVED = "[name removed]"
const CARD_REMOVED = "[card number removed]"
const count = (n: number) => n.toLocaleString("en-US")

/**
 * One text value under its key, and under what its key is under: what is
 * kept of it, or a note of what was there. A text that is kept may hold
 * fields of its own, an event sent as text or an address with a query, and
 * those go by the same rules.
 */
function leaf(key: string, value: string, under: Holds = null): string {
    if (!value) return value
    const own = holds(key)
    const what = own === "name" || own === "card" ? own : under ?? own
    if (what === "name") return NAME_REMOVED
    if (what === "card") return CARD_REMOVED
    if (what === "picture" || isPictureAddress(value)) return `[removed, ${count(value.length)} characters]`
    return value.length > MAX_TEXT ? `[text removed, ${count(value.length)} characters]` : loose(value)
}

const MAX_DEPTH = 8
const MAX_ITEMS = 50

/** A JSON value with names, card numbers, pictures and long text taken out. */
function walk(value: unknown, key: string, inPicture: boolean, depth: number): unknown {
    if (typeof value === "string") return leaf(key, value, inPicture ? "picture" : null)
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

/** An element's own name, without the prefix of its namespace. */
const local = (tag: string) => tag.replace(/^.*:/, "")

/** Past this an element's attributes aren't read: a terminal's own are a few dozen characters. */
const MAX_ATTRIBUTES = 400

/** An element's attributes, each by the same rules as a field: what doesn't read as one is dropped. */
function attributes(text: string, under: Holds): string {
    if (text.length > MAX_ATTRIBUTES) return ""
    let out = ""
    for (const [, name, double, single] of text.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out += ` ${name}="${leaf(local(name), double ?? single ?? "", under)}"`
    return out
}

/**
 * The older XML, element by element: the same rules by each element's
 * name, and by the names of the elements it is inside. The elements that
 * are open are followed, so a picture's address inside its picture goes
 * with it, and what comes after the picture's element is kept as ever.
 *
 * It is read from start to end once, bracket by bracket, so a body made
 * to be slow to read is no slower than any other.
 */
function redactXml(xml: string, under: Holds = null): string {
    // The elements that are open, each with what it holds: its own, or else what the one around it holds.
    const open: { tag: string; holds: Holds }[] = []
    const opened = new Map<string, number>()
    const within = (): Holds => (open.length > 0 ? open[open.length - 1].holds : under)
    let out = ""
    let at = 0
    // Where the next closing bracket is: looked for again only once it is passed.
    let closes = -2
    while (at < xml.length) {
        const bracket = xml.indexOf("<", at)
        if (bracket !== at) {
            // Text up to the next bracket: it has none in it.
            const text = xml.slice(at, bracket < 0 ? xml.length : bracket)
            out += text.trim() ? leaf(open.length > 0 ? local(open[open.length - 1].tag) : "", text, within()) : text
            if (bracket < 0) break
            at = bracket
        }
        // What a CDATA section holds can't be told apart, nor a comment: each goes whole, and so does one that never ends.
        if (xml.startsWith("<![CDATA[", at)) {
            const ends = xml.indexOf("]]>", at)
            out += "[text removed]"
            if (ends < 0) break
            at = ends + 3
            continue
        }
        if (xml.startsWith("<!--", at)) {
            const ends = xml.indexOf("-->", at)
            out += "<!--[removed]-->"
            if (ends < 0) break
            at = ends + 3
            continue
        }
        if (closes !== -1 && closes <= at) closes = xml.indexOf(">", at + 1)
        const piece = closes > at && xml.lastIndexOf("<", closes) === at ? xml.slice(at, closes + 1) : null
        const closing = piece && /^<\/([A-Za-z_][\w.:-]*)\s*>$/.exec(piece)
        const declared = piece && /^<\?([A-Za-z_][\w.:-]*)([\s\S]*)\?>$/.exec(piece)
        const opening = piece && /^<([A-Za-z_][\w.:-]*)((?:\s[\s\S]*)?)>$/.exec(piece)
        if (!piece || !(closing || declared || opening || piece.startsWith("<!"))) {
            // A bracket that opens nothing: what follows it is text.
            out += "<"
            at += 1
            continue
        }
        at = closes + 1
        if (closing) {
            // Closes its own element, and with it any left open inside it. One that was never opened closes nothing.
            while ((opened.get(closing[1]) ?? 0) > 0) {
                const last = open.pop()!
                opened.set(last.tag, opened.get(last.tag)! - 1)
                if (last.tag === closing[1]) break
            }
            out += `</${closing[1]}>`
        } else if (declared) out += `<?${declared[1]}${attributes(declared[2], null)}?>`
        else if (opening) {
            const own = holds(local(opening[1]))
            const alone = /\/\s*$/.test(opening[2])
            const inside = own ?? within()
            out += `<${opening[1]}${attributes(opening[2], inside)}${alone ? "/" : ""}>`
            if (!alone) {
                open.push({ tag: opening[1], holds: inside })
                opened.set(opening[1], (opened.get(opening[1]) ?? 0) + 1)
            }
        } else out += "<![removed]>"
    }
    return out
}

/** Pairs of a name and its value inside a text, in two spellings: each value by the same rules. Read twice, it says the same. */
function pairs(text: string): string {
    return text
        .replace(/("([\w.-]*)"\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (whole, lead: string, key: string, value: string) => {
            const kept = leaf(key, value)
            return kept === value ? whole : `${lead}"${kept}"`
        })
        // A note of what was taken out is one value, its brackets and all.
        .replace(/(^|[&?;\s])([\w.-]+)=(\[[^\]\n]*\]|[^&;\s]*)/g, (whole, lead: string, key: string, value: string) => {
            const kept = leaf(key, value)
            return kept === value ? whole : `${lead}${key}=${kept}`
        })
}

/**
 * Text where nothing can be told apart for sure: what looks like markup
 * goes element by element, and what looks like a pair of a name and its
 * value goes by the same rules.
 */
function loose(text: string): string {
    return text.includes("<") ? redactXml(text) : pairs(text)
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)} … [cut: ${count(text.length)} characters in all]` : text)

/**
 * What is kept of a body's text, and the kind of each event in it. JSON
 * is kept a field to a line, as it reads; XML as it came; anything else
 * to its first 600 characters.
 *
 * `field`: the name of the form's field it came in, if it came in one. A
 * field's own name says what it holds as much as a name inside an event
 * does: a field called `name` is somebody's name (review on PR 294).
 */
export function textOf(text: string, field = ""): { body: string; kinds: string[] } {
    const body = text.trim()
    const under = holds(field)
    if (under === "name") return { body: body ? NAME_REMOVED : body, kinds: [] }
    if (under === "card") return { body: body ? CARD_REMOVED : body, kinds: [] }
    if (body.startsWith("{") || body.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(body)
            const events = Array.isArray(parsed) ? parsed : [parsed]
            return { body: JSON.stringify(walk(parsed, field, false, 0), null, 2), kinds: events.map(kindOfEvent).filter((k): k is string => k !== null) }
        } catch {
            // Not JSON after all: kept as text that is neither, below.
        }
    }
    if (body.startsWith("<") && body.includes("<EventNotificationAlert")) {
        const type = word(element(body, "eventType")) || "event"
        const access = /<AccessControllerEvent[\s>]/.test(body)
        return { body: redactXml(body, under), kinds: [access ? `${type} ${code(element(body, "majorEventType"))}/${code(element(body, "subEventType"))}` : type] }
    }
    if (under === "picture") return { body: leaf(field, body), kinds: [] }
    // Only its start is kept, so only its start is read.
    const start = loose(body.slice(0, MAX_UNREAD_TEXT * 4))
    return { body: body.length > MAX_UNREAD_TEXT || start.length > MAX_UNREAD_TEXT ? `${start.slice(0, MAX_UNREAD_TEXT)} … [cut: ${count(body.length)} characters in all]` : start, kinds: [] }
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
    const take = (label: string, text: string, field = "") => {
        const read = textOf(text, field)
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
                else take(`${label}: text, ${count(part.length)} characters`, part, name)
            } else if (isPicture(part) || part.size > MAX_EVENT_BYTES) {
                note(`${label}: ${fileOf(part)}, not opened`)
            } else {
                const text = await part.text()
                if (isText(text)) take(`${label}: ${fileOf(part)}, ${count(text.length)} characters`, text, name)
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
