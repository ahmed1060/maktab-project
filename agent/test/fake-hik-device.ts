import { createHash, randomBytes } from "node:crypto"
import { createServer as createHttp, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import { createServer as createHttps, type Server as HttpsServer } from "node:https"
import type { AddressInfo } from "node:net"

/**
 * A simulated Hikvision terminal, for tests: the part of ISAPI the agent
 * reads (ATTENDANCE_PLAN.md §17.4), answered the way the terminals answer
 * it. Every request is checked for HTTP digest authentication as RFC 7616
 * computes it, from the password the terminal holds, so a client that signs
 * differently from a real terminal fails here too. Over HTTPS when given a
 * certificate.
 */

export type FakeHikEvent = {
    major: number
    minor: number
    /** As the terminal writes it: its wall time with its offset. */
    time: string
    serialNo: number
    employeeNoString?: string
    name?: string
    cardNo?: string
}

export type FakeHikState = {
    serialNumber: string
    model: string
    deviceName: string
    firmware: string
    user: string
    password: string
    realm: string
    /** As the terminal names it in its challenge; MD5 is also what one that names none means. */
    algorithm: "MD5" | "SHA-256" | null
    localTime: string
    events: FakeHikEvent[]
    /** The most a page holds, whatever is asked for. */
    pageLimit: number
    /** A nonce answers this many requests, then the terminal calls it stale. */
    nonceUses: number
    /** Answer every request to this path with this status instead. */
    failing: { path: string; status: number; body?: string } | null
    /** Once a request to this path is answered with 200, show this certificate instead: another machine taking over the address (PR 302). */
    renewAfter: { path: string; cert: string; key: string } | null
}

export type SeenRequest = { method: string; path: string; authorization: string | null; body: string; status: number }

const md = (algorithm: "MD5" | "SHA-256", s: string) => createHash(algorithm === "MD5" ? "md5" : "sha256").update(s).digest("hex")

/** The fields of a `Digest` Authorization header, quoted or not. */
function fields(header: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const m of header.replace(/^Digest\s+/i, "").matchAll(/([a-z]+)=(?:"([^"]*)"|([^,\s]*))/gi)) out[m[1].toLowerCase()] = m[2] ?? m[3]
    return out
}

export class FakeHikDevice {
    readonly state: FakeHikState
    readonly seen: SeenRequest[] = []
    private server: Server | null = null
    private nonces = new Map<string, number>()

    constructor(state: Partial<FakeHikState> = {}) {
        this.state = {
            serialNumber: "DS-K1T341AM0020201234", model: "DS-K1T341AM", deviceName: "Lobby", firmware: "V3.2.30 build 220727",
            user: "agent", password: "Correct Horse 9", realm: "DS-K1T341AM", algorithm: null, localTime: "2026-11-16T13:00:00+02:00",
            events: [], pageLimit: 30, nonceUses: 1000, failing: null, renewAfter: null, ...state,
        }
    }

    /**
     * Starts listening on this machine, on a free port or the one given (another terminal at the address the agent
     * knows, PR 302); over HTTPS with a certificate and its key.
     */
    async start(tls?: { cert: string; key: string }, port = 0): Promise<number> {
        const handler = (req: IncomingMessage, res: ServerResponse) => {
            void this.answer(req, res).then(() => {
                const renew = this.state.renewAfter
                // After the answer itself, not the challenge that comes before it.
                if (!renew || res.statusCode !== 200 || (req.url ?? "").split("?")[0] !== renew.path) return
                this.state.renewAfter = null
                ;(this.server as HttpsServer).setSecureContext({ cert: renew.cert, key: renew.key })
            })
        }
        this.server = tls ? createHttps({ cert: tls.cert, key: tls.key }, handler) : createHttp(handler)
        await new Promise<void>(resolve => this.server!.listen(port, "127.0.0.1", resolve))
        return (this.server.address() as AddressInfo).port
    }

    async stop() {
        if (!this.server) return
        await new Promise<void>(resolve => this.server!.close(() => resolve()))
        this.server = null
    }

    private challenge(res: ServerResponse, stale = false) {
        const nonce = randomBytes(16).toString("hex")
        this.nonces.set(nonce, 0)
        const algorithm = this.state.algorithm ? `, algorithm=${this.state.algorithm}` : ""
        res.writeHead(401, { "WWW-Authenticate": `Digest realm="${this.state.realm}", qop="auth", nonce="${nonce}", opaque="0a1b2c"${algorithm}${stale ? ", stale=TRUE" : ""}` })
        res.end()
    }

    /** Whether the request is signed as RFC 7616 has it, with a nonce this terminal gave and not yet worn out. */
    private signed(req: IncomingMessage): "ok" | "stale" | "no" {
        const header = req.headers.authorization
        if (!header || !/^Digest\s/i.test(header)) return "no"
        const f = fields(header)
        const algorithm = this.state.algorithm ?? "MD5"
        const uses = this.nonces.get(f.nonce ?? "")
        if (uses === undefined) return "no"
        if (f.username !== this.state.user || f.realm !== this.state.realm || f.uri !== req.url || f.qop !== "auth" || !f.cnonce || !/^[0-9a-f]{8}$/.test(f.nc ?? "")) return "no"
        const ha1 = md(algorithm, `${this.state.user}:${this.state.realm}:${this.state.password}`)
        const ha2 = md(algorithm, `${req.method}:${req.url}`)
        if (f.response !== md(algorithm, `${ha1}:${f.nonce}:${f.nc}:${f.cnonce}:auth:${ha2}`)) return "no"
        if (uses >= this.state.nonceUses) return "stale"
        this.nonces.set(f.nonce!, uses + 1)
        return "ok"
    }

    private async answer(req: IncomingMessage, res: ServerResponse) {
        let body = ""
        for await (const chunk of req) body += chunk
        const path = (req.url ?? "").split("?")[0]
        const record = (status: number) => this.seen.push({ method: req.method ?? "", path: req.url ?? "", authorization: req.headers.authorization ?? null, body, status })
        const signed = this.signed(req)
        if (signed !== "ok") {
            record(401)
            return this.challenge(res, signed === "stale")
        }
        const failing = this.state.failing
        if (failing && failing.path === path) {
            record(failing.status)
            res.writeHead(failing.status, { "Content-Type": "text/plain" })
            return res.end(failing.body ?? "")
        }
        const xml = (status: number, text: string) => {
            record(status)
            res.writeHead(status, { "Content-Type": "application/xml" })
            res.end(text)
        }
        if (req.method === "GET" && path === "/ISAPI/System/deviceInfo") {
            const s = this.state
            return xml(200, `<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<deviceName>${s.deviceName}</deviceName>
<deviceID>88</deviceID>
<model>${s.model}</model>
<serialNumber>${s.serialNumber}</serialNumber>
<macAddress>00:00:5e:00:53:01</macAddress>
<firmwareVersion>${s.firmware}</firmwareVersion>
<deviceType>ACS</deviceType>
</DeviceInfo>`)
        }
        if (req.method === "GET" && path === "/ISAPI/System/time") {
            return xml(200, `<?xml version="1.0" encoding="UTF-8"?>
<Time version="2.0" xmlns="http://www.isapi.org/ver20/XMLSchema">
<timeMode>NTP</timeMode>
<localTime>${this.state.localTime}</localTime>
<timeZone>CST-2:00:00</timeZone>
</Time>`)
        }
        if (req.method === "POST" && path === "/ISAPI/AccessControl/AcsEvent" && /(^|&)format=json(&|$)/.test((req.url ?? "").split("?")[1] ?? "")) {
            const cond = (JSON.parse(body) as { AcsEventCond: { searchID: string; searchResultPosition: number; maxResults: number; major: number; minor: number; startTime: string; endTime: string } }).AcsEventCond
            const from = Date.parse(cond.startTime)
            const to = Date.parse(cond.endTime)
            const matches = this.state.events
                .filter(e => e.major === cond.major && (cond.minor === 0 || e.minor === cond.minor))
                .filter(e => Date.parse(e.time) >= from && Date.parse(e.time) <= to)
                .sort((a, b) => a.serialNo - b.serialNo)
            const page = matches.slice(cond.searchResultPosition, cond.searchResultPosition + Math.min(cond.maxResults, this.state.pageLimit))
            const more = cond.searchResultPosition + page.length < matches.length
            record(200)
            res.writeHead(200, { "Content-Type": "application/json" })
            return res.end(JSON.stringify({
                AcsEvent: {
                    searchID: cond.searchID, responseStatusStrg: page.length === 0 ? "NO MATCH" : more ? "MORE" : "OK",
                    numOfMatches: page.length, totalMatches: matches.length,
                    ...(page.length > 0 && { InfoList: page.map(e => ({ ...e, cardType: 1, currentVerifyMode: "cardOrFaceOrFp" })) }),
                },
            }))
        }
        record(404)
        res.writeHead(404, { "Content-Type": "application/xml" })
        res.end(`<ResponseStatus><statusCode>4</statusCode><statusString>Invalid Operation</statusString></ResponseStatus>`)
    }
}
