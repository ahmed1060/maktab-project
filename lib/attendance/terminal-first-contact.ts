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
 * What a value holds, by its own field's name and by what its field is
 * under: a name's or a card's own field says so first, then what is
 * around it, then a picture's own field.
 */
function context(key: string, under: Holds): Holds {
    const own = holds(key)
    return own === "name" || own === "card" ? own : under ?? own
}

/**
 * One text value under its key, and under what its key is under: what is
 * kept of it, or a note of what was there. A text that is kept may hold
 * fields of its own, an event sent as text or an address with a query, and
 * those go by the same rules.
 */
function leaf(key: string, value: string, under: Holds = null): string {
    if (!value) return value
    const what = context(key, under)
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

const ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }
/** XML's text as it reads once its escapes are undone, so markup or fields sent inside it are read as what they are. */
function unescapedXml(text: string): string {
    if (!text.includes("&")) return text
    return text.replace(/&(?:(lt|gt|amp|quot|apos)|#(\d{1,7})|#x([0-9a-fA-F]{1,6}));/g, (whole, named?: string, decimal?: string, hex?: string) => {
        if (named) return ENTITIES[named]
        const code = decimal ? parseInt(decimal, 10) : parseInt(hex ?? "", 16)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    })
}
const escapedXml = (text: string) => text.replace(/[&<>"]/g, ch => (ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : "&quot;"))
/** One piece of XML's text under its element: as it came if all of it is kept, or what is kept of it, escaped again. */
function xmlText(key: string, text: string, under: Holds): string {
    const value = unescapedXml(text)
    const kept = leaf(key, value, under)
    return kept === value ? text : escapedXml(kept)
}

/** Past this an element's attributes aren't read: a terminal's own are a few dozen characters. */
const MAX_ATTRIBUTES = 400

/** An element's attributes, each by the same rules as a field: what doesn't read as one is dropped. */
function attributes(text: string, under: Holds, source: boolean): string {
    if (text.length > MAX_ATTRIBUTES) return ""
    let out = ""
    for (const [, name, double, single] of text.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        const value = double ?? single ?? ""
        out += ` ${name}="${(source ? xmlText(local(name), value, under) : leaf(local(name), value, under)).replace(/"/g, "&quot;")}"`
    }
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
 *
 * `source`: it is XML as it came, its text escaped. Markup found inside
 * a text that was already read isn't: its escapes were undone with the
 * text's.
 */
function redactXml(xml: string, under: Holds = null, source = true): string {
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
            const key = open.length > 0 ? local(open[open.length - 1].tag) : ""
            out += !text.trim() ? text : source ? xmlText(key, text, within()) : leaf(key, text, within())
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
        } else if (declared) out += `<?${declared[1]}${attributes(declared[2], null, source)}?>`
        else if (opening) {
            const own = holds(local(opening[1]))
            const alone = /\/\s*$/.test(opening[2])
            const inside = own ?? within()
            out += `<${opening[1]}${attributes(opening[2], inside, source)}${alone ? "/" : ""}>`
            if (!alone) {
                open.push({ tag: opening[1], holds: inside })
                opened.set(opening[1], (opened.get(opening[1]) ?? 0) + 1)
            }
        } else out += "<![removed]>"
    }
    return out
}

/** A value as JSON writes it without quotes: kept as it is, unless its field is a name's or a card's. */
const LITERAL = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)$/

/**
 * Text written as fields that can't be read as JSON, such as an event cut
 * short: read once from start to end with the fields that are open
 * followed, as the XML is. A value goes by its own field's name and by
 * what its field is under, whether it is text or a number, in quotes of
 * either kind or in none (second review on PR 294).
 */
function fields(text: string, under: Holds = null): string {
    // The objects and lists that are open, each with its field's name and what it holds. A list's values share its field.
    const open: { list: boolean; key: string; holds: Holds }[] = [{ list: false, key: "", holds: under }]
    const top = () => open[open.length - 1]
    /** After a value, an object's next value waits for its own field's name. */
    const valued = () => {
        if (!top().list) top().key = ""
    }
    const colon = /\s*:/y
    const run = /[^\s"'{}[\]:,]+/y
    const rest = /[^,}\]\n"']*/y
    const named = (at: number) => {
        colon.lastIndex = at
        return !top().list && colon.test(text)
    }
    let out = ""
    let at = 0
    while (at < text.length) {
        const ch = text[at]
        if (ch === "{" || ch === "[") {
            const around = top()
            open.push({ list: ch === "[", key: ch === "[" ? around.key : "", holds: context(around.key, around.holds) })
            out += ch
            at += 1
        } else if (ch === "}" || ch === "]") {
            if (open.length > 1) open.pop()
            valued()
            out += ch
            at += 1
        } else if (ch === '"' || ch === "'") {
            // A text, to its closing quote or to the end.
            const from = at
            let end = at + 1
            while (end < text.length && text[end] !== ch) end += text[end] === "\\" ? 2 : 1
            const closed = end < text.length
            const raw = text.slice(from + 1, Math.min(end, text.length))
            at = closed ? end + 1 : text.length
            // As it reads once its escapes are undone: a field's name written with one is still its name, and an event sent inside a text is read as one.
            let value = raw
            if (ch === '"' && raw.includes("\\")) {
                try {
                    const read: unknown = JSON.parse(`"${raw}"`)
                    if (typeof read === "string") value = read
                } catch {
                    // Its escapes can't be read: it goes as it came.
                }
            }
            if (closed && named(at)) {
                top().key = value.slice(0, 80)
                out += text.slice(from, at)
                continue
            }
            const kept = leaf(top().key, value, top().holds)
            out += kept === value ? text.slice(from, at) : closed ? JSON.stringify(kept) : JSON.stringify(kept).slice(0, -1)
            valued()
        } else if (ch === ":" || ch === "," || /\s/.test(ch)) {
            out += ch
            at += 1
        } else {
            run.lastIndex = at
            const word = run.exec(text)?.[0] ?? ch
            at += word.length
            if (named(at)) {
                top().key = word.slice(0, 80)
                out += word
                continue
            }
            const what = context(top().key, top().holds)
            if (what === "name" || what === "card") {
                // The rest of the value goes with it: a name has spaces in it.
                rest.lastIndex = at
                at += rest.exec(text)?.[0].length ?? 0
                out += JSON.stringify(what === "name" ? NAME_REMOVED : CARD_REMOVED)
            } else out += LITERAL.test(word) ? word : leaf(top().key, word, top().holds)
            valued()
        }
    }
    return out
}

/**
 * Pairs of a name and its value joined by an equals sign, as a form or an
 * address writes them: each value by the same rules. A name's or a card's
 * value runs to the end of its pair, spaces and all. Read twice, it says
 * the same: a note of what was taken out is one value, its brackets and all.
 */
function pairs(text: string): string {
    const pair = /(^|[&?;\s])([\w.-]+)=/g
    const note = /\[[^\]\n]*\]/y
    const whole = /[^&;\n]*/y
    const token = /[^&;\s]*/y
    let out = ""
    let at = 0
    for (let found = pair.exec(text); found; found = pair.exec(text)) {
        const from = found.index + found[0].length
        const own = holds(found[2])
        let value: string | undefined
        if (text[from] === "[") {
            note.lastIndex = from
            value = note.exec(text)?.[0]
        }
        if (value === undefined) {
            const until = own === "name" || own === "card" ? whole : token
            until.lastIndex = from
            value = until.exec(text)?.[0] ?? ""
        }
        out += text.slice(at, from) + leaf(found[2], value)
        at = from + value.length
        pair.lastIndex = at
    }
    return out + text.slice(at)
}

/**
 * Text where nothing can be told apart for sure: what looks like markup
 * goes element by element, what looks like fields goes field by field,
 * and what looks like a pair of a name and its value goes by the same
 * rules. Each reads only text shorter than what it was given, so it ends.
 */
function loose(text: string): string {
    // Markup or fields sent with their brackets and quotes escaped are read as what they are. What is taken out
    // of them is said with that escaping undone: it is shorter each time, so this ends.
    const plain = unescapedXml(text)
    if (plain !== text) {
        const kept = loose(plain)
        if (kept !== plain) return kept
    }
    if (text.includes("<")) return redactXml(text, null, false)
    return /["'{}[\]]/.test(text) ? fields(text) : pairs(text)
}

/**
 * In text that can't be read, a field's name can't always be relied on: a
 * number of 6 digits or more is taken out wherever it is, since there it
 * can't be told from a card's.
 */
const withoutLongNumbers = (text: string) => text.replace(/\d{6,}/g, "[number removed]")

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
    const start = withoutLongNumbers(loose(body.slice(0, MAX_UNREAD_TEXT * 4)))
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
