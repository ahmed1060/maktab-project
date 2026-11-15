/**
 * What a Hikvision terminal sends, read (ATTENDANCE_PLAN.md §17.2, §17.5,
 * PR 291). A terminal set to "HTTP listening" posts each event as it
 * happens: a scan, a door opening, a failed attempt, a heartbeat. Only a
 * scan is kept: the employee number and the time, and with them the fields
 * of its event that Nizmo knows (PR 293). No name, no picture.
 *
 * No terminal is on hand, so this follows Hikvision's documents. Where a
 * real one differs, it has to show: an event that names an employee and is
 * of a type listed nowhere here is counted on the terminal, not dropped
 * (§17.8).
 */

/** Hikvision's major type for events, as against alarms (1), exceptions (2) and operations (3). */
const MAJOR_EVENT = 5

/**
 * The minor types for an identity check that passed, from the header of
 * Hikvision's own SDK (HCNetSDK.h, MINOR_*_PASS under MAJOR_EVENT). Which
 * of them a given model sends is for the trial to say.
 */
export const PASSED_CHECKS: ReadonlySet<number> = new Set([
    0x01, // card
    0x02, // card and password
    0x26, // fingerprint
    0x28, // card and fingerprint
    0x2b, // card, fingerprint and password
    0x2e, // fingerprint and password
    0x36, // face and fingerprint
    0x39, // face and password
    0x3c, // face and card
    0x3f, // face, password and fingerprint
    0x42, // face, card and fingerprint
    0x45, // employee number and fingerprint
    0x48, // employee number, fingerprint and password
    0x4b, // face
    0x4d, // employee number and face
    0x65, // employee number and password
    0x69, // person and ID card
])

/**
 * Minor types that are known and aren't a scan, from the same header: a
 * check that failed or timed out, and doors and buttons. A failed check can
 * still name someone, whoever's card it was with another's finger, so these
 * are dropped whatever they carry.
 */
export const NOT_SCANS: ReadonlySet<number> = new Set([
    0x03, 0x04, 0x05, 0x24, 0x27, 0x29, 0x2a, 0x2c, 0x2d, 0x2f, 0x30, 0x37, 0x38, 0x3a, 0x3b, 0x3d, 0x3e,
    0x40, 0x41, 0x43, 0x44, 0x46, 0x47, 0x49, 0x4a, 0x4c, 0x4e, 0x4f, 0x50, 0x5d, 0x66, 0x67, 0x68, 0x70,
    0x75, 0x76, 0x77, 0x78, 0x89,
    // The lock, the button, and the door opening and closing.
    0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x5c,
])

/** The longest employee number Nizmo maps to a person (§2.3), as for the agent. */
export const MAX_USER_NUMBER = 32

/** An event's text is a few hundred bytes. Past this, a part isn't one and isn't opened. */
export const MAX_EVENT_BYTES = 256 * 1024

/** What a scan keeps of its event (§17.5, PR 293): the event's own shape, with only the fields listed below. */
export type KeptEvent = { [field: string]: string | number | boolean } & { AccessControllerEvent: { [field: string]: string | number | boolean } }

export type TerminalEvent =
    /**
     * A passed identity check: the employee number, at the terminal's wall
     * clock ("" when it can't be read); the offset from UTC its event
     * states, in minutes, or null when it states none; and what the scan
     * keeps of its event.
     */
    | { kind: "scan"; userNumber: string; at: string; offsetMinutes: number | null; kept: KeptEvent }
    /** Not kept, and counted on the terminal with this reason. */
    | { kind: "refused"; reason: string }
    /** Answered and dropped: a heartbeat, a door, a failed attempt. */
    | { kind: "other" }

const OTHER: TerminalEvent = { kind: "other" }

const objectOf = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null

const textOf = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value).trim() : "")

/**
 * The terminal's wall clock from an event's `dateTime`
 * ("2026-09-14T09:05:00+03:00"): its first 19 characters. The offset isn't
 * read: a scan's time is the terminal's wall clock in the company's time
 * zone, whichever way it came (§17.5).
 */
function wallClockOf(dateTime: unknown): string {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.exec(typeof dateTime === "string" ? dateTime : "")?.[0] ?? ""
}

/**
 * The offset from UTC that an event's `dateTime` states, in minutes east:
 * 180 for "+03:00", 0 for "Z". Null when it states none, or one no clock
 * has. It is kept beside the terminal (§17.5): a scan's time is its wall
 * clock whatever this says.
 */
function offsetOf(dateTime: unknown): number | null {
    const stated = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.exec(typeof dateTime === "string" ? dateTime.trim() : "")?.[1]
    if (!stated) return null
    if (stated === "Z") return 0
    const digits = stated.slice(1).replace(":", "")
    const minutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))
    // No clock is further from UTC than 14 hours, or keeps 60 minutes or more in its hour.
    if (minutes > 14 * 60 || Number(digits.slice(2)) > 59) return null
    return stated[0] === "-" ? -minutes : minutes
}

/**
 * The fields a scan keeps of its event (§17.5, PR 293), by name: when and
 * what kind of event it was, the terminal's own name and its address on
 * the office network, the event's number in the terminal's log, the
 * employee number, how the person was identified, which reader and door,
 * and the attendance status picked on the terminal (in, out, a break).
 * Kept by name, not left out by name, so a field nobody foresaw can't
 * carry a name, a card's number or a picture in. Whether the person wore
 * a mask is theirs, and nothing here needs it: it isn't kept either.
 */
const KEPT_OF_EVENT = ["dateTime", "eventType", "eventState", "ipAddress", "macAddress", "channelID", "activePostCount"] as const
const KEPT_OF_ACCESS = [
    "deviceName", "majorEventType", "subEventType", "employeeNoString", "employeeNo", "serialNo", "verifyNo", "userType",
    "currentVerifyMode", "cardReaderNo", "doorNo", "attendanceStatus", "statusValue", "picturesNumber",
] as const
/** No field kept is longer than this: a name or a mode, never a document. */
const MAX_KEPT_TEXT = 100

/** The listed fields of one object that are a text, a number or a yes or no; anything nested is left. */
function keep(source: Record<string, unknown>, names: readonly string[]): { [field: string]: string | number | boolean } {
    const kept: { [field: string]: string | number | boolean } = {}
    for (const name of names) {
        const value = source[name]
        if (typeof value === "string") kept[name] = value.slice(0, MAX_KEPT_TEXT)
        else if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean") kept[name] = value
    }
    return kept
}

/** One event, from its JSON. */
export function readEvent(event: unknown): TerminalEvent {
    const outer = objectOf(event)
    const inner = objectOf(outer?.AccessControllerEvent)
    if (!outer || !inner) return OTHER
    if (outer.eventType !== undefined && textOf(outer.eventType) !== "AccessControllerEvent") return OTHER
    if (Number(inner.majorEventType ?? inner.major) !== MAJOR_EVENT) return OTHER
    // Older firmware sends the number alone, without the text beside it.
    const userNumber = textOf(inner.employeeNoString) || textOf(inner.employeeNo)
    if (!userNumber) return OTHER
    const minor = Number(inner.subEventType ?? inner.minor)
    if (PASSED_CHECKS.has(minor)) {
        if (userNumber.length > MAX_USER_NUMBER) return { kind: "refused", reason: "INVALID_NUMBER" }
        return {
            kind: "scan", userNumber, at: wallClockOf(outer.dateTime), offsetMinutes: offsetOf(outer.dateTime),
            kept: { ...keep(outer, KEPT_OF_EVENT), AccessControllerEvent: keep(inner, KEPT_OF_ACCESS) } as KeptEvent,
        }
    }
    if (NOT_SCANS.has(minor)) return OTHER
    return { kind: "refused", reason: `EVENT_NOT_KNOWN:${Number.isInteger(minor) ? minor : "?"}` }
}

/** The text of the first such element in the older XML, or nothing. */
const element = (xml: string, name: string): string | undefined => new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`).exec(xml)?.[1]

/** One event, from the older XML `EventNotificationAlert`: the same fields, as elements. */
function readEventXml(xml: string): TerminalEvent {
    const access = /<AccessControllerEvent[\s>]/.test(xml)
    // Each field by its name, the ones a scan keeps among them: an element that isn't there is left out.
    const read = (names: readonly string[]) => Object.fromEntries(names.map(name => [name, element(xml, name)]).filter(([, value]) => value !== undefined))
    return readEvent({ ...read(KEPT_OF_EVENT), ...(access && { AccessControllerEvent: read(KEPT_OF_ACCESS) }) })
}

/** The events in a body's text, JSON or XML. Null when it is neither. */
export function readEventText(text: string): TerminalEvent[] | null {
    const body = text.trim()
    if (body.startsWith("<")) return body.includes("<EventNotificationAlert") ? [readEventXml(body)] : null
    if (!body.startsWith("{") && !body.startsWith("[")) return null
    try {
        const parsed: unknown = JSON.parse(body)
        return Array.isArray(parsed) ? parsed.map(readEvent) : [readEvent(parsed)]
    } catch {
        return null
    }
}

/** A picture by what it says it is, or by its name: never opened (§17.5). */
export const isPicture = (file: File) => file.type.startsWith("image/") || /\.(jpe?g|png|bmp|gif|webp)$/i.test(file.name)

/**
 * A request's events, in whichever of the three shapes its body comes: a
 * multipart form with the event in one part and pictures in others, JSON
 * alone, or XML alone. An empty body is no event: the terminal's own test
 * of its setting. Null when the body can't be read as any of them.
 */
export async function eventsOf(req: Request): Promise<TerminalEvent[] | null> {
    if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/")) {
        let form: FormData
        try {
            form = await req.formData()
        } catch {
            return null
        }
        const events: TerminalEvent[] = []
        let read = false
        // Whatever the event's part is called: `event_log` on most, the event's own name on some.
        for (const [, part] of form.entries()) {
            if (typeof part !== "string" && (isPicture(part) || part.size > MAX_EVENT_BYTES)) continue
            const text = typeof part === "string" ? part : await part.text()
            if (text.length > MAX_EVENT_BYTES) continue
            const found = readEventText(text)
            if (!found) continue
            read = true
            events.push(...found)
        }
        return read ? events : null
    }
    let text: string
    try {
        text = await req.text()
    } catch {
        return null
    }
    if (!text.trim()) return []
    return text.length > MAX_EVENT_BYTES ? null : readEventText(text)
}
