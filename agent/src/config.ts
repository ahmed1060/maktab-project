import { readFileSync } from "node:fs"
import { canonicalAddress } from "./zk/listener"

/**
 * What an office sets up once, in agent.json beside the agent: where the
 * server is and which terminals are on this network. The company is never
 * here — it comes with the token the agent receives when it is enrolled.
 *
 * A terminal speaks ZKTeco's protocol unless it says `"protocol":
 * "hikvision"` (ATTENDANCE_PLAN.md §17.4, PR 302): every agent.json before
 * that names only ZKTeco's.
 *
 * One with `"push": true` isn't read: it pushes its scans to the agent,
 * which listens for it on `"listenPort"` (§17.12, PR 305). It's kept apart,
 * in `pushers`, so nothing that reads a terminal ever reaches it.
 */
export type ZkDeviceConfig = {
    protocol: "zkteco"
    host: string
    port: number
    /** The terminal's comm password, if one is set on it (Comm. settings). */
    password: number
    /** A name for the terminal the first time it is reported, such as "Front door". */
    name: string | null
}

/** A Hikvision terminal: the user made on it for the agent, read over HTTPS unless it says `"https": false`. */
export type HikDeviceConfig = {
    protocol: "hikvision"
    host: string
    /** 443 over HTTPS, 80 over HTTP, unless set. */
    port: number
    https: boolean
    user: string
    /** As typed, in quotes: a number would lose a leading zero. */
    password: string
    name: string | null
}

export type DeviceConfig = ZkDeviceConfig | HikDeviceConfig

/**
 * A ZKTeco terminal that pushes to the agent (PR 305), by its IP address on
 * the office network: a request is the terminal's only when it comes from
 * there, so a name can't stand for it.
 */
export type PushDeviceConfig = { host: string; name: string | null }

export type AgentConfig = {
    /** The website, e.g. https://app.example.com. */
    server: string
    /** The terminals the agent reads. */
    devices: DeviceConfig[]
    /** The terminals that push to the agent; it listens for them on listenPort. */
    pushers: PushDeviceConfig[]
    listenPort: number
    /** Seconds between rounds of reading the terminals and sending. */
    pollSeconds: number
    /**
     * Records older than this are never sent: a terminal can hold a year of
     * scans, and history before attendance started here is not wanted.
     * Default: the first of the month the agent was enrolled.
     */
    sendFrom: string | null
    /** Clear a terminal's memory once it is this full — only after everything in it is delivered. Off unless set. */
    clearWhenFull: boolean
    clearAtRatio: number
}

export class ConfigError extends Error {}

const isLocalHost = (h: string) => h === "localhost" || h === "127.0.0.1" || h === "::1"

/** Checks and fills in a config; throws ConfigError saying what is wrong. */
export function parseConfig(raw: unknown): AgentConfig {
    if (!raw || typeof raw !== "object") throw new ConfigError("agent.json must be a JSON object.")
    const c = raw as Record<string, unknown>
    let server: URL
    try {
        server = new URL(String(c.server ?? ""))
    } catch {
        throw new ConfigError('"server" must be the website\'s address, such as https://app.example.com.')
    }
    // The token and every punch travel over this: plain HTTP only to this machine, for testing.
    if (server.protocol !== "https:" && !(server.protocol === "http:" && isLocalHost(server.hostname))) {
        throw new ConfigError('"server" must start with https://.')
    }
    if (!Array.isArray(c.devices)) throw new ConfigError('"devices" must be a list of terminals, such as [{ "host": "192.168.1.20" }].')
    const devices: DeviceConfig[] = []
    const pushers: (PushDeviceConfig & { which: string })[] = []
    c.devices.forEach((d: any, i: number) => {
        const which = `Terminal ${i + 1}`
        if (!d || typeof d.host !== "string" || !d.host.trim()) throw new ConfigError(`${which} needs a "host": its address on this network.`)
        const protocol = d.protocol === undefined ? "zkteco" : typeof d.protocol === "string" ? d.protocol.trim().toLowerCase() : ""
        if (protocol !== "zkteco" && protocol !== "hikvision") throw new ConfigError(`${which}: "protocol" must be "zkteco" or "hikvision".`)
        const name = typeof d.name === "string" && d.name.trim() ? d.name.trim() : null
        // The server takes at most 80; a longer one would fail every heartbeat (review on #18).
        if (name && name.length > 80) throw new ConfigError(`${which}: "name" must be at most 80 characters.`)
        if (d.push !== undefined && typeof d.push !== "boolean") throw new ConfigError(`${which}: "push" must be true or false.`)
        if (d.push === true) {
            if (protocol !== "zkteco") throw new ConfigError(`${which}: "push" is for a ZKTeco terminal.`)
            // In the form a request's address is read in (agent/src/zk/listener.ts), however it's written here.
            const host = canonicalAddress(d.host)
            if (!host) throw new ConfigError(`${which}: "host" must be its IP address on this network, such as 192.168.1.40, for a terminal that pushes.`)
            if (d.port !== undefined) throw new ConfigError(`${which} pushes to the agent on "listenPort": it has no "port" of its own.`)
            pushers.push({ host, name, which })
        } else {
            devices.push(readDevice(d, which, protocol, name))
        }
    })
    const keys = devices.map(d => `${d.host}:${d.port}`)
    if (new Set(keys).size !== keys.length) throw new ConfigError("The same terminal is listed twice.")
    const pushed = pushers.map(p => p.host)
    if (new Set(pushed).size !== pushed.length) throw new ConfigError("The same terminal is listed twice.")
    for (const p of pushers) {
        if (devices.some(d => (canonicalAddress(d.host) ?? d.host.toLowerCase()) === p.host)) throw new ConfigError(`${p.which} is at ${p.host}, where a terminal the agent reads is: one terminal is read or pushes, not both.`)
    }
    const listenPort = c.listenPort === undefined ? 8081 : c.listenPort
    if (typeof listenPort !== "number" || !Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) throw new ConfigError('"listenPort" must be a number from 1 to 65535.')
    const pollSeconds = c.pollSeconds === undefined ? 60 : Number(c.pollSeconds)
    if (!Number.isFinite(pollSeconds) || pollSeconds < 15 || pollSeconds > 3600) throw new ConfigError('"pollSeconds" must be between 15 and 3600.')
    const sendFrom = c.sendFrom === undefined || c.sendFrom === null ? null : String(c.sendFrom)
    if (sendFrom !== null && !/^\d{4}-\d{2}-\d{2}$/.test(sendFrom)) throw new ConfigError('"sendFrom" must be a date, YYYY-MM-DD.')
    const clearAtRatio = c.clearAtRatio === undefined ? 0.9 : Number(c.clearAtRatio)
    if (!(clearAtRatio >= 0.5 && clearAtRatio <= 0.99)) throw new ConfigError('"clearAtRatio" must be between 0.5 and 0.99.')
    return {
        server: server.origin, devices, pollSeconds, sendFrom, clearWhenFull: c.clearWhenFull === true, clearAtRatio,
        pushers: pushers.map(({ host, name }) => ({ host, name })), listenPort,
    }
}

/** A terminal the agent reads: ZKTeco's, or Hikvision's with the user made on it for the agent. */
function readDevice(d: any, which: string, protocol: "zkteco" | "hikvision", name: string | null): DeviceConfig {
    const portOr = (fallback: number) => {
        const port = d.port === undefined ? fallback : Number(d.port)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`${which}: "port" must be a number from 1 to 65535.`)
        return port
    }
    if (protocol === "hikvision") {
        if (d.https !== undefined && typeof d.https !== "boolean") throw new ConfigError(`${which}: "https" must be true or false.`)
        const https = d.https !== false
        if (typeof d.user !== "string" || !d.user.trim()) throw new ConfigError(`${which} needs a "user": the user made on the terminal for the agent.`)
        if (d.password === undefined || d.password === "") throw new ConfigError(`${which} needs a "password": that user's password, in quotes.`)
        if (typeof d.password !== "string") throw new ConfigError(`${which}: "password" must be in quotes, such as "password": "1234".`)
        return { protocol, host: d.host.trim(), port: portOr(https ? 443 : 80), https, user: d.user.trim(), password: d.password, name }
    }
    const password = d.password === undefined ? 0 : Number(d.password)
    if (!Number.isInteger(password) || password < 0) throw new ConfigError(`${which}: "password" must be the terminal's numeric comm password.`)
    return { protocol, host: d.host.trim(), port: portOr(4370), password, name }
}

export function loadConfig(path: string): AgentConfig {
    let text: string
    try {
        text = readFileSync(path, "utf8")
    } catch {
        throw new ConfigError(`Can't read ${path}. Copy agent.example.json to agent.json and fill it in.`)
    }
    try {
        return parseConfig(JSON.parse(text))
    } catch (e) {
        if (e instanceof ConfigError) throw e
        throw new ConfigError(`${path} isn't valid JSON: ${(e as Error).message}`)
    }
}
