import { randomUUID } from "node:crypto"
import { request, type IncomingHttpHeaders, type RequestOptions } from "node:http"
import { connect as netConnect, isIP, type Socket } from "node:net"
import { connect as tlsConnect } from "node:tls"
import { digestAuthorization, parseChallenge, type Challenge } from "./digest"
import { MAJOR_EVENT, pickNew, type HikCursor, type HikEvent, type HikRecord } from "./events"

/**
 * A conversation with a Hikvision terminal over ISAPI, its HTTP interface
 * (ATTENDANCE_PLAN.md §17.4). Reads only: who it is, its clock, and its
 * passed checks from where the agent had got to.
 *
 * It signs in with HTTP digest authentication, so the password never
 * travels. Over HTTPS where the terminal is set to it: its certificate is
 * its own and signed by nobody, so instead of a list of authorities its
 * fingerprint is pinned. On the first contact the client says which it saw,
 * for the agent to keep; after that a terminal showing another is refused
 * before anything is sent to it. Otherwise over HTTP, on the office network
 * only, as the ZKTeco protocol is.
 */

export type HikOptions = {
    host: string
    /** 80 over HTTP, 443 over HTTPS, unless set. */
    port?: number
    https?: boolean
    /** The user made on the terminal for the agent, and its password. */
    user: string
    password: string
    /** The SHA-256 fingerprint of the certificate seen on the first contact; none yet on that contact. */
    pin?: string | null
    timeoutMs?: number
}

export type HikInfo = { serialNumber: string; model: string | null; name: string | null; firmware: string | null }

/** The terminal's wall time, and its offset from UTC in minutes when it states one. */
export type HikClock = { wall: string; offsetMinutes: number | null }

/** An error reading a Hikvision terminal. Its code starts `HIK_`, as ZKTeco's start `ZK_` (§17.4, PR 301): the setup guide names them. */
export class HikError extends Error {
    constructor(readonly code: string, readonly detail?: string) {
        super(detail ? `${code}: ${detail}` : code)
        this.name = "HikError"
    }
}

/** No reply this agent asks for is anywhere near this; past it the terminal is answering something else. */
const MAX_REPLY = 2 * 1024 * 1024
/** A page of events, the most the terminals answer. */
const PAGE = 30
/**
 * The most one read asks for, 30,000 events. A longer history is read over
 * several, each going on from where the last stopped; more than this in the
 * day a read looks back over is no office's terminal.
 */
const MAX_PAGES = 1000
const DAY = 86_400_000

type Reply = { status: number; headers: IncomingHttpHeaders; text: string }

/** An XML element's text, whatever namespace prefix it carries, with the five entities undone. */
function tag(xml: string, name: string): string | null {
    const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${name}>`).exec(xml)
    if (!m) return null
    const text = m[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim()
    return text || null
}

const pad = (n: number) => String(n).padStart(2, "0")

/** An instant as the terminal writes one: its wall time at this offset, and the offset. */
function atOffset(ms: number, offsetMinutes: number): string {
    const wall = new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 19)
    const sign = offsetMinutes < 0 ? "-" : "+"
    const abs = Math.abs(offsetMinutes)
    return `${wall}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

export class HikClient {
    /** The certificate's fingerprint, once a connection over HTTPS has shown one. */
    seenFingerprint: string | null = null
    private challenge: Challenge | null = null
    private nc = 0

    constructor(private readonly options: HikOptions) {}

    private get port() {
        return this.options.port ?? (this.options.https ? 443 : 80)
    }

    /** One request and its whole reply. Over HTTPS, the certificate is checked before anything is written. */
    private send(method: string, path: string, headers: Record<string, string>, body?: string): Promise<Reply> {
        const { host, https, pin } = this.options
        const timeoutMs = this.options.timeoutMs ?? 10_000
        return new Promise<Reply>((resolve, reject) => {
            /** The socket being opened: until it is handed over, the request can't close it. */
            let opening: Socket | null = null
            // One deadline for all of it: opening the connection, the handshake over HTTPS, and the reply. A request
            // that never got its socket never says it failed, so it is refused here, and the socket being opened closed.
            const deadline = setTimeout(() => {
                const late = new HikError("HIK_TIMEOUT", `no answer in ${timeoutMs / 1000} seconds`)
                fail(late)
                opening?.destroy()
                req.destroy(late)
            }, timeoutMs)
            const fail = (e: unknown) => {
                clearTimeout(deadline)
                reject(e instanceof HikError ? e : new HikError("HIK_UNREACHABLE", (e as Error).message))
            }
            // The socket is handed over only once it is open and, over HTTPS, its certificate checked: nothing is written before.
            const createConnection = (_options: unknown, ready: (err: Error | null, socket?: Socket) => void) => {
                let done = false
                const once = (err: Error | null, socket?: Socket) => {
                    if (done) return
                    done = true
                    ready(err, socket)
                }
                if (!https) {
                    const socket = netConnect({ host, port: this.port })
                    opening = socket
                    socket.once("connect", () => once(null, socket))
                    socket.once("error", e => once(e))
                    return undefined
                }
                const socket = tlsConnect({ host, port: this.port, servername: isIP(host) ? undefined : host, rejectUnauthorized: false })
                opening = socket
                socket.once("secureConnect", () => {
                    const seen = socket.getPeerCertificate().fingerprint256 ?? null
                    this.seenFingerprint = seen
                    if (pin && seen !== pin) {
                        socket.destroy()
                        return once(new HikError("HIK_CERTIFICATE_CHANGED", "the terminal shows another certificate than the one it showed first: another machine may be answering at its address"))
                    }
                    once(null, socket)
                })
                socket.once("error", e => once(e))
                return undefined
            }
            const options: RequestOptions = { host, port: this.port, method, path, headers, createConnection: createConnection as unknown as RequestOptions["createConnection"] }
            const req = request(options, res => {
                const chunks: Buffer[] = []
                let size = 0
                res.on("data", (chunk: Buffer) => {
                    size += chunk.length
                    if (size > MAX_REPLY) return req.destroy(new HikError("HIK_BAD_REPLY", "the terminal's reply is far longer than asked for"))
                    chunks.push(chunk)
                })
                res.on("end", () => {
                    clearTimeout(deadline)
                    resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") })
                })
                res.on("error", fail)
            })
            req.on("error", fail)
            req.end(body)
        })
    }

    /**
     * A request, signed. The terminal's challenge is answered again for each
     * request, counted on. One it calls stale, or refuses, is asked for anew
     * once; a refusal of a challenge just given is the wrong user or password.
     */
    private async call(method: string, path: string, body?: string): Promise<Reply> {
        let fresh = false
        for (let tries = 0; tries < 4; tries++) {
            const headers: Record<string, string> = { Accept: "*/*", Connection: "close" }
            if (body !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) })
            const signed = this.challenge !== null
            if (this.challenge) headers.Authorization = digestAuthorization({ challenge: this.challenge, user: this.options.user, password: this.options.password, method, uri: path, nc: ++this.nc })
            const reply = await this.send(method, path, headers, body)
            if (reply.status !== 401) return reply
            const next = parseChallenge(reply.headers["www-authenticate"])
            if (!next) throw new HikError("HIK_AUTH_UNSUPPORTED", "the terminal asks for a sign-in other than digest authentication")
            if (signed && fresh && !next.stale) break
            this.challenge = next
            this.nc = 0
            fresh = true
        }
        this.challenge = null
        throw new HikError("HIK_AUTH_FAILED", "the terminal refused the user or the password")
    }

    private async ok(method: string, path: string, body?: string): Promise<string> {
        const reply = await this.call(method, path, body)
        if (reply.status !== 200) throw new HikError(`HIK_HTTP_${reply.status}`, `the terminal answered ${path.split("?")[0]} with ${reply.status}`)
        return reply.text
    }

    /** Who the terminal is: its serial number, model, firmware, and the name set on it. */
    async info(): Promise<HikInfo> {
        const xml = await this.ok("GET", "/ISAPI/System/deviceInfo")
        const serialNumber = tag(xml, "serialNumber")
        if (!serialNumber) throw new HikError("HIK_BAD_REPLY", "the terminal didn't say its serial number")
        return { serialNumber, model: tag(xml, "model"), name: tag(xml, "deviceName"), firmware: tag(xml, "firmwareVersion") }
    }

    /** The terminal's clock: its wall time, and its offset from UTC where it states one. */
    async clock(): Promise<HikClock> {
        const local = tag(await this.ok("GET", "/ISAPI/System/time"), "localTime")
        const m = local ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(local) : null
        if (!m) throw new HikError("HIK_BAD_REPLY", "the terminal didn't say its time")
        const zone = m[2]
        const offsetMinutes = zone === undefined ? null : zone === "Z" ? 0
            : (zone[0] === "-" ? -1 : 1) * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(-2)))
        return { wall: m[1], offsetMinutes }
    }

    /**
     * The passed checks since the cursor, and where it is after them; from the
     * start of `from` (YYYY-MM-DD, the terminal's day) when there is none yet.
     * Searched from a day before: before the cursor's time, so a clock set
     * back by hours still shows, or before the first day, so a clock that
     * doesn't say its offset, read here as UTC, still has all of that day
     * searched. Which are new is the events' own numbering
     * (agent/src/hik/events.ts), and on the first read their wall date. A
     * history longer than one read takes is read over several. The clock is
     * read here unless the round has just read it (PR 302).
     */
    async passedChecks(cursor: HikCursor, from: string | null, read?: HikClock): Promise<{ records: HikRecord[]; cursor: HikCursor }> {
        const clock = read ?? await this.clock()
        const offset = clock.offsetMinutes ?? 0
        const cursorAt = cursor ? Date.parse(cursor.time) : NaN
        const startMs = (!Number.isNaN(cursorAt) ? cursorAt : Date.parse(`${from ?? "2000-01-01"}T00:00:00Z`) - offset * 60_000) - DAY
        const endMs = Date.parse(`${clock.wall}Z`) - offset * 60_000 + DAY
        const searchID = randomUUID()
        const events: HikEvent[] = []
        let stopped = false
        for (let position = 0, pages = 0; ; pages++) {
            // The terminal answers in time order, so what is read stops at a moment, and the next read goes on from it.
            if (pages === MAX_PAGES) {
                stopped = true
                break
            }
            const body = JSON.stringify({
                AcsEventCond: { searchID, searchResultPosition: position, maxResults: PAGE, major: MAJOR_EVENT, minor: 0, startTime: atOffset(startMs, offset), endTime: atOffset(endMs, offset) },
            })
            const text = await this.ok("POST", "/ISAPI/AccessControl/AcsEvent?format=json", body)
            let reply: unknown
            try {
                reply = JSON.parse(text)
            } catch {
                throw new HikError("HIK_BAD_REPLY", "the terminal's events aren't JSON")
            }
            const found = (reply as { AcsEvent?: { responseStatusStrg?: unknown; InfoList?: unknown } } | null)?.AcsEvent
            if (!found || typeof found !== "object") throw new HikError("HIK_BAD_REPLY", "the terminal's reply holds no events")
            const list = found.InfoList === undefined ? [] : found.InfoList
            if (!Array.isArray(list)) throw new HikError("HIK_BAD_REPLY", "the terminal's events aren't a list")
            for (const e of list as Record<string, unknown>[]) {
                if (typeof e?.major !== "number" || typeof e.minor !== "number" || typeof e.time !== "string" || typeof e.serialNo !== "number") {
                    throw new HikError("HIK_BAD_REPLY", "an event without its type, time or serial number")
                }
                events.push({ major: e.major, minor: e.minor, time: e.time, serialNo: e.serialNo, employeeNoString: typeof e.employeeNoString === "string" ? e.employeeNoString : undefined, employeeNo: typeof e.employeeNo === "number" || typeof e.employeeNo === "string" ? e.employeeNo : undefined })
            }
            position += list.length
            if (found.responseStatusStrg !== "MORE" || list.length === 0) break
        }
        const picked = pickNew(events, cursor)
        // Stopped short, a read must get past where it had got to, or every read after it would stop at the same place.
        if (stopped && cursor && !(picked.cursor && picked.cursor.serialNo > cursor.serialNo)) {
            throw new HikError("HIK_TOO_MANY", "more events in a day than one read can take")
        }
        if (cursor || !from) return picked
        return { records: picked.records.filter(r => r.at.slice(0, 10) >= from), cursor: picked.cursor }
    }
}
