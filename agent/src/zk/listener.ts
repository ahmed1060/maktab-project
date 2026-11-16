import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { isIPv4, isIPv6, type AddressInfo } from "node:net"
import type { Logger } from "../sync"
import { admsRequest, take, type Taken } from "./adms"

/**
 * The agent's listener on the office network (ATTENDANCE_PLAN.md §17.12,
 * PR 304), for ZKTeco terminals that push only plain HTTP: the terminal's
 * Cloud Server Setting names the agent's PC, and it calls the same
 * `/iclock/` paths it would call on Nizmo, answered as Nizmo answers them
 * (agent/src/zk/adms.ts). Its scans go on to Nizmo over HTTPS with the
 * agent's own; plaintext never leaves the building.
 *
 * A request is a terminal's only when it comes from an address named in
 * agent.json. Anything else is refused before its body is read: 403 to
 * an address that isn't named, 404 to what isn't a terminal's request.
 *
 * As on Nizmo, a terminal counts anything but 200 as a failure, keeps
 * what it sent, and sends it again: so 200 only once what was taken is
 * kept (`PushSink.keep`, scans queued and stamps moved in one write), 503
 * while Nizmo says it is set straight to Nizmo, 500 when keeping fails.
 *
 * The service starts it when agent.json names a terminal that pushes
 * (SyncAgent.listen, PR 305).
 */

/** Where the listener keeps what it takes: the agent's state (SyncAgent, PR 305); in memory in tests. */
export type PushSink = {
    /** Where a named terminal had got to, as kept, and whether it's held: set straight to Nizmo. */
    terminal(host: string, serial: string): { cursor: string | null; held: boolean }
    /** The company's offset from UTC now, in minutes, for its options; null when it isn't known. */
    offsetMinutes(): number | null
    /** Keeps what was taken of a request, in one write. Throws when it can't: the terminal sends it again. */
    keep(host: string, serial: string, taken: Taken): void
}

export type Limits = {
    /** A request's headers must all have come by then. */
    headersMs: number
    /** And all of it, body included, by then. */
    requestMs: number
    /** Connections open at once; one more is closed as it comes. */
    connections: number
    /** The largest body read: a first upload can hold a terminal's whole memory. */
    bodyBytes: number
}

export const LIMITS: Limits = { headersMs: 10_000, requestMs: 60_000, connections: 32, bodyBytes: 16 * 1024 * 1024 }

/** An address that called and isn't named is logged this often at most. */
const STRANGER_LOGGED_EVERY_MS = 60 * 60_000

export type ListenOptions = {
    port: number
    /** The address on this PC to listen on: all of them unless set. */
    address?: string
    /** The terminals' addresses on the office network, as agent.json names them. */
    hosts: readonly string[]
    sink: PushSink
    log: Logger
    limits?: Partial<Limits>
}

export type PushListener = { port: number; close(): Promise<void> }

/**
 * An IP address in the one form both sides are compared in (Codex on PR
 * 305): an IPv6 one in its shortest form, in small letters, so
 * `0:0:0:0:0:0:0:1` is `::1`, as a request from it arrives; and an IPv4
 * one inside an IPv6 one (`::ffff:192.168.1.40`, as it arrives where the
 * PC listens on both) as the IPv4 address. Null for what isn't an IP
 * address.
 */
export function canonicalAddress(address: string): string | null {
    const plain = address.trim()
    if (isIPv4(plain)) return plain
    if (!isIPv6(plain)) return null
    // A link-local one with its interface (fe80::1%eth0), which the URL parser doesn't take: as written.
    if (plain.includes("%")) return plain.toLowerCase()
    const shortest = new URL(`http://[${plain}]/`).hostname.slice(1, -1)
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(shortest)
    if (!mapped) return shortest
    const [high, low] = [parseInt(mapped[1], 16), parseInt(mapped[2], 16)]
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

/** Where a request came from, in the form agent.json's addresses are compared in. */
export function callerAddress(remote: string | undefined): string | null {
    if (!remote) return null
    return canonicalAddress(remote) ?? remote.toLowerCase()
}

function answer(res: ServerResponse, status: number, text: string | null, close = false) {
    if (res.headersSent || res.destroyed) return
    const headers: Record<string, string> = { "Content-Length": String(Buffer.byteLength(text ?? "")) }
    if (text) headers["Content-Type"] = "text/plain"
    // Refused before its body was read: the connection goes, and what's left of the body with it.
    if (close) headers.Connection = "close"
    res.writeHead(status, headers)
    res.end(text ?? "")
}

/** A request's body as text, or null past `limit`, whether its length was said or not. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
    const said = Number(req.headers["content-length"])
    if (Number.isFinite(said) && said > limit) return Promise.resolve(null)
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = []
        let size = 0
        const done = () => {
            req.off("data", onData)
            req.off("end", onEnd)
            req.off("error", onError)
        }
        const onData = (chunk: Buffer) => {
            size += chunk.length
            if (size > limit) {
                done()
                req.pause()
                resolve(null)
            } else chunks.push(chunk)
        }
        const onEnd = () => {
            done()
            resolve(Buffer.concat(chunks).toString("utf8"))
        }
        const onError = (e: Error) => {
            done()
            reject(e)
        }
        req.on("data", onData)
        req.on("end", onEnd)
        req.on("error", onError)
    })
}

export async function listen(options: ListenOptions): Promise<PushListener> {
    const { sink, log } = options
    const limits = { ...LIMITS, ...options.limits }
    const hosts = new Set(options.hosts.map(h => callerAddress(h) ?? h))
    const strangers = new Map<string, number>()

    const stranger = (caller: string) => {
        const now = Date.now()
        if (now - (strangers.get(caller) ?? -Infinity) < STRANGER_LOGGED_EVERY_MS) return
        // Bounded: an office network has few addresses, but nothing here grows without end.
        if (strangers.size >= 1000) strangers.clear()
        strangers.set(caller, now)
        log.warn(`${caller} called the agent, but no terminal in agent.json is at that address. Nothing it sent was read.`)
    }

    const handle = async (req: IncomingMessage, res: ServerResponse) => {
        const caller = callerAddress(req.socket.remoteAddress)
        try {
            if (!caller || !hosts.has(caller)) {
                stranger(caller ?? "An unknown address")
                return answer(res, 403, null, true)
            }
            const method = (req.method ?? "").toUpperCase()
            const url = new URL(req.url ?? "/", "http://agent.invalid")
            const asked = (method === "GET" || method === "POST") && url.pathname.startsWith("/iclock/") ? admsRequest(method, url) : null
            if (!asked) return answer(res, 404, null, true)
            const { serial } = asked
            const which = `Terminal ${serial} at ${caller}`
            if (sink.terminal(caller, serial).held) return answer(res, 503, null)
            let body: string | null = null
            if (asked.kind === "scans") {
                body = await readBody(req, limits.bodyBytes)
                if (body === null) {
                    log.warn(`${which} sent an upload too large to read, over ${Math.round(limits.bodyBytes / 1024 / 1024)} MB. It was refused, and the terminal will send it again.`)
                    return answer(res, 413, null, true)
                }
            }
            // Where it had got to, read again now its body is in: another of its requests may have moved it meanwhile.
            // From here to the answer nothing waits, so nothing else moves it.
            const now = sink.terminal(caller, serial)
            if (now.held) return answer(res, 503, null)
            const taken = take(asked, body, now.cursor, sink.offsetMinutes())
            try {
                sink.keep(caller, serial, taken)
            } catch (e) {
                log.error(`${which}: what it sent could not be kept (${(e as Error).message}). The terminal will send it again.`)
                return answer(res, 500, null)
            }
            if (taken.unreadable > 0) log.warn(`${which} sent ${taken.unreadable} line(s) that can't be read, or with an employee number over 32 characters. They are not queued.`)
            return answer(res, 200, taken.answer)
        } catch (e) {
            log.error(`A request from ${caller ?? "an unknown address"} could not be answered: ${(e as Error).message}`)
            return answer(res, 500, null, true)
        }
    }

    const server = createServer({
        headersTimeout: limits.headersMs,
        requestTimeout: limits.requestMs,
        // How often the two above are checked: often enough to hold to them.
        connectionsCheckingInterval: Math.min(1_000, limits.headersMs),
        keepAliveTimeout: 5_000,
    }, (req, res) => void handle(req, res))
    server.maxConnections = limits.connections

    await new Promise<void>((resolve, reject) => {
        const failed = (e: NodeJS.ErrnoException) => {
            reject(e.code === "EADDRINUSE" ? new Error(`Port ${options.port} is in use by another program on this PC.`) : e)
        }
        server.once("error", failed)
        server.listen(options.port, options.address, () => {
            server.off("error", failed)
            resolve()
        })
    })
    server.on("error", e => log.error(`The listener failed: ${e.message}`))

    return {
        port: (server.address() as AddressInfo).port,
        close: () => new Promise<void>(resolve => {
            server.close(() => resolve())
            server.closeAllConnections()
        }),
    }
}
