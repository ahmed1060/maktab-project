import { readFileSync } from "node:fs"

/**
 * What an office sets up once, in agent.json beside the agent: where the
 * server is and which terminals are on this network. The company is never
 * here — it comes with the token the agent receives when it is enrolled.
 */
export type DeviceConfig = {
    host: string
    port: number
    /** The terminal's comm password, if one is set on it (Comm. settings). */
    password: number
    /** A name for the terminal the first time it is reported, such as "Front door". */
    name: string | null
}

export type AgentConfig = {
    /** The website, e.g. https://app.example.com. */
    server: string
    devices: DeviceConfig[]
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
    const devices = c.devices.map((d: any, i: number): DeviceConfig => {
        if (!d || typeof d.host !== "string" || !d.host.trim()) throw new ConfigError(`Terminal ${i + 1} needs a "host": its address on this network.`)
        const port = d.port === undefined ? 4370 : Number(d.port)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`Terminal ${i + 1}: "port" must be a number from 1 to 65535.`)
        const password = d.password === undefined ? 0 : Number(d.password)
        if (!Number.isInteger(password) || password < 0) throw new ConfigError(`Terminal ${i + 1}: "password" must be the terminal's numeric comm password.`)
        return { host: d.host.trim(), port, password, name: typeof d.name === "string" && d.name.trim() ? d.name.trim() : null }
    })
    const keys = devices.map(d => `${d.host}:${d.port}`)
    if (new Set(keys).size !== keys.length) throw new ConfigError("The same terminal is listed twice.")
    const pollSeconds = c.pollSeconds === undefined ? 60 : Number(c.pollSeconds)
    if (!Number.isFinite(pollSeconds) || pollSeconds < 15 || pollSeconds > 3600) throw new ConfigError('"pollSeconds" must be between 15 and 3600.')
    const sendFrom = c.sendFrom === undefined || c.sendFrom === null ? null : String(c.sendFrom)
    if (sendFrom !== null && !/^\d{4}-\d{2}-\d{2}$/.test(sendFrom)) throw new ConfigError('"sendFrom" must be a date, YYYY-MM-DD.')
    const clearAtRatio = c.clearAtRatio === undefined ? 0.9 : Number(c.clearAtRatio)
    if (!(clearAtRatio >= 0.5 && clearAtRatio <= 0.99)) throw new ConfigError('"clearAtRatio" must be between 0.5 and 0.99.')
    return { server: server.origin, devices, pollSeconds, sendFrom, clearWhenFull: c.clearWhenFull === true, clearAtRatio }
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
