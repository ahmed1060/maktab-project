import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

/**
 * A stand-in for the website's agent API (/api/agent/*), behaving as the
 * real one does where the agent can tell: one code enrols once, a punch is
 * stored once by its terminal, number and time, a terminal must be reported
 * in a heartbeat before its punches are taken, and a rotated token replaces
 * the old one once used. Failures can be switched on to test the agent's
 * patience.
 */

export class FakeServer {
    private server: Server
    url = ""
    code = "K7QD-2MXP"
    tokens = new Set<string>()
    pendingToken: string | null = null
    devices = new Map<string, { state: "ACTIVE" | "RETIRED" | "CLAIMED_ELSEWHERE"; mode: string }>()
    stored = new Map<string, { serialNumber: string; userNumber: string; at: string }>()
    heartbeats: any[] = []
    batches: number[] = []
    rotateNext = false
    /** Fail the next n punch deliveries with this status. */
    failPunches: { times: number; status: number } = { times: 0, status: 503 }
    /** Refuse punches on these dates for good, as a locked payroll month would be. */
    lockedBefore: string | null = null
    private counter = 0

    constructor() {
        this.server = createServer((req, res) => this.handle(req, res))
    }

    async start() {
        await new Promise<void>(r => this.server.listen(0, "127.0.0.1", r))
        this.url = `http://127.0.0.1:${(this.server.address() as { port: number }).port}`
        return this.url
    }

    async stop() {
        this.server.closeAllConnections()
        await new Promise<void>(r => this.server.close(() => r()))
    }

    /** The time the server says it is (its Date header), when set. */
    serverDate: Date | null = null
    timeZone = "Africa/Cairo"

    private send(res: ServerResponse, status: number, body: object) {
        res.writeHead(status, { "Content-Type": "application/json", ...(this.serverDate ? { Date: this.serverDate.toUTCString() } : {}) })
        res.end(JSON.stringify(body))
    }

    private async handle(req: IncomingMessage, res: ServerResponse) {
        let text = ""
        for await (const chunk of req) text += chunk
        const body = text ? JSON.parse(text) : {}
        const fail = (status: number, code: string) => this.send(res, status, { success: false, code, error: code })
        const ok = (data: object, status = 200) => this.send(res, status, { success: true, data })

        if (req.url === "/api/agent/enrol") {
            if (body.code !== this.code) return fail(400, "ENROLMENT_CODE_INVALID")
            this.code = "used"
            const token = `mka_${++this.counter}`
            this.tokens.add(token)
            return ok({ token, agentId: "ag1", name: "Office", company: "Sweep Co", timeZone: this.timeZone }, 201)
        }
        const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? "")?.[1] ?? ""
        if (token === this.pendingToken) { this.tokens.clear(); this.tokens.add(token); this.pendingToken = null }
        if (!this.tokens.has(token)) return fail(401, "UNAUTHENTICATED")

        if (req.url === "/api/agent/heartbeat") {
            this.heartbeats.push(body)
            const devices = body.devices.map((d: any) => {
                const known = this.devices.get(d.serialNumber) ?? { state: "ACTIVE" as const, mode: "ANY" }
                this.devices.set(d.serialNumber, known)
                return { serialNumber: d.serialNumber, state: known.state, deviceId: known.state === "ACTIVE" ? `dev-${d.serialNumber}` : null, mode: known.mode }
            })
            const rotateToken = this.rotateNext
            this.rotateNext = false
            return ok({ serverTime: new Date().toISOString(), timeZone: "Africa/Cairo", devices, rotateToken })
        }
        if (req.url === "/api/agent/token") {
            this.pendingToken = `mka_${++this.counter}`
            return ok({ token: this.pendingToken })
        }
        if (req.url === "/api/agent/punches") {
            if (this.failPunches.times > 0) { this.failPunches.times--; return fail(this.failPunches.status, "SERVER_ERROR") }
            this.batches.push(body.punches.length)
            let accepted = 0, duplicates = 0
            const refused: { index: number; reason: string; retry: boolean }[] = []
            body.punches.forEach((p: any, index: number) => {
                const d = this.devices.get(p.serialNumber)
                if (!d) return refused.push({ index, reason: "UNKNOWN_DEVICE", retry: true })
                if (d.state !== "ACTIVE") return refused.push({ index, reason: "DEVICE_RETIRED", retry: false })
                if (this.lockedBefore && p.at < this.lockedBefore) return refused.push({ index, reason: "MONTH_LOCKED", retry: false })
                const key = `${p.serialNumber}:${p.userNumber}:${p.at}`
                if (this.stored.has(key)) duplicates++
                else { this.stored.set(key, p); accepted++ }
            })
            return ok({ accepted, duplicates, refused })
        }
        fail(404, "NOT_FOUND")
    }
}
