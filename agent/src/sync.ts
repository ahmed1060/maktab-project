import { hostname } from "node:os"
import { AgentApi, ApiError, type DeviceReport } from "./api"
import type { AgentConfig, DeviceConfig, HikDeviceConfig, ZkDeviceConfig } from "./config"
import { saveState, type AgentState, type Cursor, type Pusher, type QueuedPunch } from "./state"
import { HikClient, HikError, type HikOptions } from "./hik/client"
import { withDevice, type ZkOptions } from "./zk/client"
import type { AttendanceRecord } from "./zk/protocol"
import type { Taken } from "./zk/adms"
import { listen as listenOn, type PushListener, type PushSink } from "./zk/listener"
import { AGENT_VERSION } from "./version"

/**
 * One round of the Local Sync Agent (ATTENDANCE_PLAN.md §17):
 *
 * 1. Read each terminal: what it is, and its attendance log. New records go
 *    into the queue on disk before anything else, and the cursor moves past
 *    them in the same write.
 * 2. Tell the server how the agent and its terminals are (the heartbeat),
 *    and rotate the token when it asks.
 * 3. Deliver the queue in batches. A punch leaves the queue when it is
 *    stored, already there, or refused for good; one refused for now (its
 *    terminal not yet known) waits for the next round.
 * 4. Optionally, clear a terminal whose memory is nearly full — only when
 *    everything in it has been delivered, and with the terminal disabled so
 *    nothing is scanned between the last read and the clear.
 *
 * Nothing here deletes a punch the server has not accepted or refused.
 *
 * A terminal the server says is set to connect straight to Nizmo (`DIRECT`
 * in the heartbeat's answer, §17.6) sends its own scans. The agent sends
 * what it has already read, then reads no more of its log and never clears
 * it. It still asks which terminal it is and reports it, so that it hears
 * when the terminal is this agent's again, and reads on from where it
 * stopped.
 *
 * A Hikvision terminal (`"protocol": "hikvision"` in agent.json, PR 302) is
 * read over ISAPI (agent/src/hik/client.ts): who it is, its clock, and its
 * passed checks from where the agent had got to. Its certificate is pinned
 * the first time it is read over HTTPS, and one showing another is refused
 * until `nizmo-agent trust` is run for it. Its scans join the same queue;
 * its memory is never cleared (ATTENDANCE_PLAN.md §17.4).
 *
 * A ZKTeco terminal that pushes (`"push": true` in agent.json, §17.12,
 * PR 305) isn't read: the service listens for it (agent/src/zk/listener.ts),
 * and what it sends is queued, its stamps moved and saved in one write, put
 * back if the write fails. It's held, answered 503 so it keeps its scans,
 * until the agent is enrolled and while Nizmo has it set straight to Nizmo.
 * It's reported once it has called, reachable while heard from in the last
 * 3 minutes. Its memory is never cleared.
 */

export const BATCH_SIZE = 500

export type Logger = { info(m: string): void; warn(m: string): void; error(m: string): void }

/** How the agent reaches a terminal; replaced in tests. */
export type DeviceAccess = typeof withDevice

/** How the agent reaches a Hikvision terminal; replaced in tests. */
export type HikAccess = (options: HikOptions) => HikClient
const hikClient: HikAccess = options => new HikClient(options)

/** A terminal that pushes is reachable while it was heard from this recently: it polls every 30 seconds (PR 305). */
export const PUSH_HEARD_WITHIN_MS = 3 * 60_000

/**
 * A time zone's offset from UTC at a moment, in minutes east: for a
 * terminal's options (PR 305). Null when the zone isn't known.
 */
export function offsetMinutesIn(timeZone: string | null, at: Date): number | null {
    if (!timeZone) return null
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
            timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
        }).formatToParts(at).map(part => [part.type, part.value]))
        const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
        return Math.round((wall - Math.floor(at.getTime() / 1000) * 1000) / 60_000)
    } catch {
        return null
    }
}

type Remembered = AgentState["devices"][string]
type Report = DeviceReport & { ratio: number }

export type RoundResult = {
    read: number
    /** Scans terminals pushed to the agent since the last round, queued as they came (PR 305). */
    pushed: number
    queued: number
    delivered: number
    duplicates: number
    refused: number
    unreachable: string[]
    cleared: string[]
    stopped: "REENROL" | "NETWORK" | null
}

const recordKey = (r: AttendanceRecord) => `${r.userNumber}|${r.at}`

/**
 * The records past the cursor. If the log no longer starts the way the
 * cursor remembers — cleared, or rewritten, by hand at the terminal — the
 * whole log is sent again: the server stores each punch once, so a repeat
 * costs only bandwidth, and nothing new is missed.
 */
export function newRecords(records: AttendanceRecord[], cursor: Cursor): { fresh: AttendanceRecord[]; cursor: Cursor } {
    const intact = cursor.count <= records.length && (cursor.count === 0 || recordKey(records[cursor.count - 1]) === cursor.lastKey)
    const fresh = intact ? records.slice(cursor.count) : records
    const last = records.at(-1)
    return { fresh, cursor: { count: records.length, lastKey: last ? recordKey(last) : null } }
}

/**
 * The first of the current month in the company's time zone: the default
 * start for a new agent. Not the office PC's calendar, which may be in
 * another zone (review on #18).
 */
export function firstOfMonthIn(timeZone: string, now = new Date()): string {
    let date: string
    try {
        date = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
    } catch {
        date = now.toISOString().slice(0, 10)
    }
    return `${date.slice(0, 7)}-01`
}

/** A report as the server takes it: how full the memory is stays here, for clearing. */
const withoutRatio = (r: DeviceReport & { ratio: number }): DeviceReport => {
    const copy: Partial<DeviceReport & { ratio: number }> = { ...r }
    delete copy.ratio
    return copy as DeviceReport
}

const deviceKey = (d: DeviceConfig) => `${d.host}:${d.port}`
const zkOptions = (d: ZkDeviceConfig): ZkOptions => ({ host: d.host, port: d.port, password: d.password })

/** How to name a Hikvision terminal to `nizmo-agent trust`: its address, and its port where it isn't HTTPS's own. */
export const trustCommand = (d: HikDeviceConfig) => `nizmo-agent trust ${d.host}${d.port === 443 ? "" : ` ${d.port}`}`

export class SyncAgent {
    readonly api: AgentApi

    // The terminals that push (PR 305): the listener, why it isn't listening, since when it is,
    // when each was last heard from (this run only), which have been said to have never called,
    // and how many scans they pushed since the last round.
    private listener: PushListener | null = null
    private listenError: string | null = null
    private listeningSince: number | null = null
    private readonly heardAt = new Map<string, number>()
    private readonly saidNeverCalled = new Set<string>()
    private pushed = 0

    constructor(
        private readonly config: AgentConfig,
        private readonly state: AgentState,
        private readonly statePath: string,
        private readonly log: Logger,
        private readonly device: DeviceAccess = withDevice,
        private readonly hik: HikAccess = hikClient,
        /** The time, in milliseconds; replaced in tests. */
        private readonly clock: () => number = Date.now,
    ) {
        this.api = new AgentApi(config.server, () => this.state.token)
    }

    private save() {
        saveState(this.statePath, this.state)
    }

    /** Exchanges the one-time code an admin was shown for this agent's token. */
    async enrol(code: string) {
        const enrolled = await this.api.enrol(code, { hostname: hostname(), agentVersion: AGENT_VERSION })
        this.state.token = enrolled.token
        this.state.agentId = enrolled.agentId
        this.state.company = enrolled.company
        this.state.timeZone = enrolled.timeZone
        this.state.enrolledAt = new Date().toISOString()
        // The server's clock, not this PC's, which may be wrong.
        this.state.sendFrom ??= firstOfMonthIn(enrolled.timeZone, this.api.lastServerDate ?? new Date())
        this.state.needsEnrolment = false
        this.save()
        return enrolled
    }

    async round(): Promise<RoundResult> {
        const result: RoundResult = { read: 0, pushed: this.pushed, queued: 0, delivered: 0, duplicates: 0, refused: 0, unreachable: [], cleared: [], stopped: null }
        this.pushed = 0
        if (!this.state.token || this.state.needsEnrolment) {
            this.log.error("This agent is not enrolled. Run it with `enrol <code>` using a code from Company Settings → Attendance.")
            result.stopped = "REENROL"
            return result
        }
        const reports = await this.readDevices(result)
        try {
            const states = await this.heartbeat(reports)
            await this.deliver(result)
            if (this.config.clearWhenFull) await this.clearFull(reports, states, result)
        } catch (e) {
            if (!(e instanceof ApiError)) throw e
            if (e.reenrol) {
                this.state.needsEnrolment = true
                this.save()
                this.log.error(`The server no longer accepts this agent (${e.code}). Enrol it again with a new code.`)
                result.stopped = "REENROL"
            } else {
                // The queue is on disk; next round picks up where this one stopped.
                this.log.warn(`Could not reach the server (${e.code}); will try again next round. ${this.state.queue.length} punch(es) waiting.`)
                result.stopped = "NETWORK"
            }
        }
        return result
    }

    // --- 1. the terminals ---------------------------------------------------------

    private async readDevices(result: RoundResult): Promise<Map<string, Report>> {
        const reports = new Map<string, Report>()
        const sendFrom = this.config.sendFrom ?? this.state.sendFrom
        // The start moved earlier (sendFrom set back in agent.json): the
        // cursors passed over records it now wants, so every log is read again
        // from the start; the server stores each punch once (review on #18).
        const from = sendFrom ?? ""
        // A state file from an agent before readFrom was kept has cursors but no start to compare with: the start may
        // have been moved earlier with the upgrade, so each log is read again, once (review on #62).
        const unknown = this.state.readFrom == null && Object.values(this.state.devices).some(d => d.cursor.count > 0 || d.hikCursor != null)
        if (unknown || (this.state.readFrom != null && from < this.state.readFrom)) {
            this.log.info(unknown
                ? `Sending from ${sendFrom ?? "the beginning"}; this folder doesn't say where reading last started, so each terminal's log is read again.`
                : `Sending from ${sendFrom ?? "the beginning"} now (was ${this.state.readFrom}); reading each terminal's log again.`)
            for (const remembered of Object.values(this.state.devices)) {
                remembered.cursor = { count: 0, lastKey: null }
                remembered.hikCursor = null
            }
            // A terminal that pushes sends from the stamps it's told when it asks for its options, as it does when it restarts.
            // They stay at 0 until it does: what it sends meanwhile mustn't move them on again (Codex on PR 305).
            for (const pusher of Object.values(this.state.pushers)) {
                pusher.pushCursor = null
                pusher.resend = true
            }
            // Kept now: a round with no terminal to read saves nothing else.
            this.state.readFrom = from
            this.save()
        }
        this.state.readFrom = from
        for (const d of this.config.devices) {
            const key = deviceKey(d)
            const remembered = (this.state.devices[key] ??= { serialNumber: null, cursor: { count: 0, lastKey: null } })
            try {
                reports.set(key, d.protocol === "hikvision"
                    ? await this.readHik(d, key, remembered, sendFrom, result)
                    : await this.readZk(d, key, remembered, sendFrom, result))
            } catch (e) {
                const message = (e as Error).message
                this.log.warn(`Terminal ${d.name ?? key} could not be read: ${message}`)
                if (d.protocol === "hikvision" && e instanceof HikError && e.code === "HIK_CERTIFICATE_CHANGED") {
                    this.log.warn(`If it is the same terminal, its certificate was renewed, as after a reset or a firmware update: stop the service, run \`${trustCommand(d)}\`, and start it again.`)
                }
                result.unreachable.push(key)
                // Reported only once its serial number is known; the server knows terminals by it.
                if (remembered.serialNumber) {
                    reports.set(key, { serialNumber: remembered.serialNumber, protocol: d.protocol === "hikvision" ? "HIKVISION" : "ZKTECO", reachable: false, error: message.slice(0, 500), ratio: 0 })
                }
            }
        }
        this.pushReports(reports)
        return reports
    }

    /**
     * Adds a terminal's new scans from sendFrom on to the queue, one by one: a
     * log of hundreds of thousands is too long to push in one call (Codex on
     * PR 302). The caller moves its cursor past them only after, and saves
     * both in one write, so a record is either queued and passed, or neither.
     */
    private enqueue(serialNumber: string, fresh: { userNumber: string; at: string }[], sendFrom: string | null): number {
        let queued = 0
        for (const r of fresh) {
            if (sendFrom && r.at.slice(0, 10) < sendFrom) continue
            this.state.queue.push({ serialNumber, userNumber: r.userNumber, at: r.at } satisfies QueuedPunch)
            queued++
        }
        return queued
    }

    private async readZk(d: ZkDeviceConfig, key: string, remembered: Remembered, sendFrom: string | null, result: RoundResult): Promise<Report> {
        const { info, records } = await this.device(zkOptions(d), async zk => {
            // Left disabled when a clear was interrupted: switched back on before anything else.
            if (remembered.mustEnable) {
                await zk.enable()
                remembered.mustEnable = false
                this.save()
                this.log.info(`Switched terminal ${d.name ?? key} back on after an interrupted clear.`)
            }
            const info = await zk.info()
            // Set to connect straight to Nizmo: its log is its own to send. Only which terminal it is
            // is asked, so that another one put at this address is read.
            const leftAlone = remembered.direct === true && remembered.serialNumber === info.serialNumber
            return { info, records: leftAlone ? null : await zk.attendance() }
        })
        // Another terminal at this address now: its log is a different log.
        if (remembered.serialNumber && remembered.serialNumber !== info.serialNumber) {
            this.log.warn(`${key} is now terminal ${info.serialNumber} (was ${remembered.serialNumber}); reading its log from the start.`)
            remembered.cursor = { count: 0, lastKey: null }
            // What the server said was of the terminal that was here.
            remembered.direct = false
        }
        remembered.serialNumber = info.serialNumber
        if (records) {
            const { fresh, cursor } = newRecords(records, remembered.cursor)
            result.queued += this.enqueue(info.serialNumber, fresh, sendFrom)
            remembered.cursor = cursor
            this.save()
            result.read += records.length
        }
        return {
            // What the terminal says about itself, cut to what the server takes.
            serialNumber: info.serialNumber, ...(d.name ? { name: d.name } : {}), ...(info.name ? { model: info.name.slice(0, 80) } : {}), ...(info.firmware ? { firmware: info.firmware.slice(0, 80) } : {}),
            protocol: "ZKTECO", reachable: true, clock: info.clock, userCount: info.users, recordCount: info.records, recordCapacity: info.recordsCapacity,
            ratio: info.recordsCapacity > 0 ? info.records / info.recordsCapacity : 0,
        }
    }

    /**
     * A Hikvision terminal (PR 302): who it is, its clock, and its passed
     * checks since the last event read. Its certificate is pinned the first
     * time it's read over HTTPS; after that the client refuses one showing
     * another before anything is sent to it.
     */
    private async readHik(d: HikDeviceConfig, key: string, remembered: Remembered, sendFrom: string | null, result: RoundResult): Promise<Report> {
        const client = this.hik({ host: d.host, port: d.port, https: d.https, user: d.user, password: d.password, pin: d.https ? remembered.certificate ?? null : null })
        const info = await client.info()
        if (d.https && !remembered.certificate && client.seenFingerprint) {
            remembered.certificate = client.seenFingerprint
            this.save()
            this.log.info(`Terminal ${d.name ?? key} (${info.serialNumber}) shows the certificate ${client.seenFingerprint}. It is pinned: a terminal showing another at this address is refused.`)
        }
        const clock = await client.clock()
        // Another terminal at this address now: its events are different events.
        if (remembered.serialNumber && remembered.serialNumber !== info.serialNumber) {
            this.log.warn(`${key} is now terminal ${info.serialNumber} (was ${remembered.serialNumber}); reading its events from the start.`)
            remembered.hikCursor = null
            remembered.direct = false
        }
        remembered.serialNumber = info.serialNumber
        // Set to connect straight to Nizmo: its events are its own to send.
        if (remembered.direct !== true) {
            const { records, cursor } = await client.passedChecks(remembered.hikCursor ?? null, sendFrom, clock)
            result.queued += this.enqueue(info.serialNumber, records, sendFrom)
            remembered.hikCursor = cursor
            this.save()
            result.read += records.length
        }
        return {
            serialNumber: info.serialNumber, ...(d.name ? { name: d.name } : {}), ...(info.model ? { model: info.model.slice(0, 80) } : {}), ...(info.firmware ? { firmware: info.firmware.slice(0, 80) } : {}),
            protocol: "HIKVISION", reachable: true, clock: clock.wall, ratio: 0,
        }
    }

    // --- 2. the heartbeat -----------------------------------------------------------

    /** Sends the heartbeat; answers each terminal's state as the server sees it, by serial number. */
    private async heartbeat(reports: Map<string, Report>): Promise<Map<string, string>> {
        const reply = await this.api.heartbeat({
            agentVersion: AGENT_VERSION, hostname: hostname(), queueDepth: this.state.queue.length, clock: new Date().toISOString(),
            devices: [...reports.values()].map(withoutRatio),
        })
        let changed = false
        for (const d of reply.devices) {
            if (d.state === "CLAIMED_ELSEWHERE") this.log.warn(`Terminal ${d.serialNumber} is in use by another company; retire it there first. Its punches are not accepted here.`)
            if (d.state === "RETIRED") this.log.warn(`Terminal ${d.serialNumber} is retired in Company Settings; its punches are not accepted.`)
            // Which way the terminal connects, remembered across rounds and restarts. Only `ACTIVE` gives its
            // log back to this agent: retired meanwhile, it is still not this agent's to read.
            for (const remembered of Object.values(this.state.devices).filter(r => r.serialNumber === d.serialNumber)) {
                if (d.state === "DIRECT" && !remembered.direct) {
                    remembered.direct = true
                    changed = true
                    this.log.info(`Terminal ${d.serialNumber} is set to connect straight to Nizmo. What is already read is sent; its log is not read from now on, and never cleared.`)
                } else if (d.state === "ACTIVE" && remembered.direct) {
                    remembered.direct = false
                    changed = true
                    this.log.info(`Terminal ${d.serialNumber} is set back to this agent. Its log is read from where it stopped.`)
                }
            }
            // One that pushes is held while it's set straight to Nizmo, so it keeps its scans for Nizmo (PR 305).
            for (const pusher of Object.values(this.state.pushers).filter(p => p.serialNumber === d.serialNumber)) {
                if (d.state === "DIRECT" && !pusher.direct) {
                    pusher.direct = true
                    changed = true
                    this.log.info(`Terminal ${d.serialNumber} is set to connect straight to Nizmo. What it pushes to this agent is refused, so it keeps its scans, until it's set back here or sends them to Nizmo.`)
                } else if (d.state === "ACTIVE" && pusher.direct) {
                    pusher.direct = false
                    changed = true
                    this.log.info(`Terminal ${d.serialNumber} is set back to this agent. What it pushes is taken again.`)
                }
            }
        }
        if (changed) this.save()
        if (reply.rotateToken) {
            const { token } = await this.api.rotate()
            this.state.token = token
            this.save()
            this.log.info("Token rotated.")
        }
        return new Map(reply.devices.map(d => [d.serialNumber, d.state]))
    }

    // --- 3. delivery ------------------------------------------------------------------

    private async deliver(result: RoundResult) {
        // One pass over what is queued now. Punches kept to retry stay at the
        // front, in order, and wait for the next round.
        const pending = this.state.queue.length
        let start = 0
        let attempted = 0
        while (attempted < pending && start < this.state.queue.length) {
            const batch = this.state.queue.slice(start, start + BATCH_SIZE)
            const reply = await this.api.punches(batch)
            const retry = new Set(reply.refused.filter(r => r.retry).map(r => r.index))
            for (const r of reply.refused.filter(r => !r.retry)) {
                const p = batch[r.index]
                this.log.warn(`Punch refused for good (${r.reason}): number ${p.userNumber} at ${p.at} on ${p.serialNumber}.`)
            }
            const kept = batch.filter((_, i) => retry.has(i))
            this.state.queue = [...this.state.queue.slice(0, start), ...kept, ...this.state.queue.slice(start + batch.length)]
            this.save()
            start += kept.length
            attempted += batch.length
            result.delivered += reply.accepted
            result.duplicates += reply.duplicates
            result.refused += reply.refused.length - retry.size
        }
    }

    // --- 4. clearing a full terminal -------------------------------------------------

    private async clearFull(reports: Map<string, Report>, states: Map<string, string>, result: RoundResult) {
        for (const d of this.config.devices) {
            // ZKTeco's alone: a Hikvision terminal's memory stays as it is until a model needs it (§17.4, PR 302).
            if (d.protocol !== "zkteco") continue
            const key = deviceKey(d)
            const report = reports.get(key)
            const remembered = this.state.devices[key]
            if (!report?.reachable || report.ratio < this.config.clearAtRatio || !remembered?.serialNumber) continue
            if (this.state.queue.some(p => p.serialNumber === remembered.serialNumber)) continue
            // Only a terminal in use by this company through this agent: one
            // retired here, now another company's, or set to connect straight
            // to Nizmo holds scans that are not ours to erase (review on #18).
            if (states.get(remembered.serialNumber) !== "ACTIVE") continue
            await this.device(zkOptions(d), async zk => {
                // Recorded before disabling: if this connection is lost before the
                // terminal is enabled again, every later round enables it first (review on #18).
                remembered.mustEnable = true
                this.save()
                await zk.disable()
                try {
                    const records = await zk.attendance()
                    const { fresh } = newRecords(records, remembered.cursor)
                    // Scanned since the round's read: deliver those first, clear another time.
                    if (fresh.length > 0) return
                    await zk.clearAttendance()
                    remembered.cursor = { count: 0, lastKey: null }
                    this.save()
                    result.cleared.push(key)
                    this.log.info(`Cleared ${records.length} delivered record(s) from terminal ${d.name ?? key}, which was ${Math.round(report.ratio * 100)}% full.`)
                } finally {
                    await zk.enable()
                    remembered.mustEnable = false
                    this.save()
                }
            }).catch(e => this.log.warn(`Could not clear terminal ${d.name ?? key}: ${(e as Error).message}`))
        }
    }

    // --- 5. terminals that push (PR 305) --------------------------------------------

    /** The port the agent listens on for terminals that push, or null when it isn't. */
    get listeningPort(): number | null {
        return this.listener?.port ?? null
    }

    /**
     * Starts listening for the terminals that push, if agent.json names any
     * and it isn't already: the service calls it before each round, so one
     * that couldn't start, as when another program holds the port, is tried
     * again. Why it couldn't is logged once, and reported on each terminal.
     */
    async listen(port = this.config.listenPort, address?: string): Promise<void> {
        if (this.listener || this.config.pushers.length === 0) return
        const hosts = this.config.pushers.map(p => p.host)
        try {
            this.listener = await listenOn({ port, address, hosts, sink: this.sink(), log: this.log })
        } catch (e) {
            const message = (e as Error).message
            if (message !== this.listenError) this.log.error(`Can't listen for terminals that push: ${message} Trying again each round.`)
            this.listenError = message
            return
        }
        this.listenError = null
        this.listeningSince = this.clock()
        this.log.info(`Listening on port ${this.listener.port} for ${hosts.length} terminal(s) that push: ${hosts.join(", ")}.`)
    }

    async stopListening(): Promise<void> {
        await this.listener?.close()
        this.listener = null
    }

    /** What the listener keeps what it takes through: this agent's state. */
    private sink(): PushSink {
        return {
            terminal: (host, serial) => {
                // A request from it, whatever it's answered: it's heard from.
                this.heardAt.set(host, this.clock())
                const pusher = this.state.pushers[host] as Pusher | undefined
                const same = pusher?.serialNumber === serial
                // Until the agent is enrolled its scans have nowhere to go, and nothing says from when to send.
                const enrolled = Boolean(this.state.token) && !this.state.needsEnrolment
                return { cursor: same ? pusher.pushCursor : null, held: !enrolled || (same && pusher.direct === true) }
            },
            offsetMinutes: () => offsetMinutesIn(this.state.timeZone, new Date(this.clock())),
            keep: (host, serial, taken) => this.keepPushed(host, serial, taken),
        }
    }

    /**
     * Keeps what was taken of a terminal's request: its scans queued from
     * sendFrom on, its stamps moved, and the state saved, in one write. Its
     * stamps started again from 0 stay there until it has asked for its
     * options and been told so (`resend`). If
     * the write fails, the queue and the terminal are put back as they were
     * and the error passes on, so the terminal is answered 500 and sends it
     * again.
     */
    private keepPushed(host: string, serial: string, taken: Taken): void {
        const before = this.state.pushers[host] as Pusher | undefined
        const queueLength = this.state.queue.length
        const pusher: Pusher = before?.serialNumber === serial
            ? { ...before }
            : { serialNumber: serial, pushCursor: null, direct: false, info: null }
        if (taken.info) pusher.info = taken.info
        const queued = this.enqueue(serial, taken.scans, this.config.sendFrom ?? this.state.sendFrom)
        if (taken.kind === "options") delete pusher.resend
        else if (taken.cursor && !pusher.resend) pusher.pushCursor = taken.cursor
        if (taken.scans.length === 0 && JSON.stringify(pusher) === JSON.stringify(before ?? null)) return
        this.state.pushers[host] = pusher
        try {
            this.save()
        } catch (e) {
            this.state.queue.length = queueLength
            if (before) this.state.pushers[host] = before
            else delete this.state.pushers[host]
            throw e
        }
        this.pushed += queued
        if (before?.serialNumber && before.serialNumber !== serial) this.log.warn(`${host} is now terminal ${serial} (was ${before.serialNumber}); it sends its memory from the start.`)
        else if (!before?.serialNumber) this.log.info(`Terminal ${serial} at ${host} called for the first time.`)
    }

    /**
     * Each terminal that pushes, for the heartbeat, once it has called:
     * reachable while heard from in the last 3 minutes; unreachable, with
     * why, when the agent can't listen, or after 3 minutes of listening
     * without a word. In the first 3 minutes of listening, one not yet heard
     * from isn't reported either way, nor any when the agent isn't
     * listening, as for `check`.
     */
    private pushReports(reports: Map<string, Report>): void {
        const now = this.clock()
        for (const d of this.config.pushers) {
            const pusher = this.state.pushers[d.host] as Pusher | undefined
            if (!pusher?.serialNumber) {
                if (!this.saidNeverCalled.has(d.host)) {
                    this.saidNeverCalled.add(d.host)
                    this.log.info(`Terminal at ${d.host} pushes to this agent and hasn't called yet. On it, Cloud Server Setting names this PC's address and port ${this.config.listenPort}, with HTTPS off.`)
                }
                continue
            }
            const info = pusher.info ?? null
            const report: Report = {
                serialNumber: pusher.serialNumber, ...(d.name ? { name: d.name } : {}), ...(info?.firmware ? { firmware: info.firmware } : {}),
                ...(info?.userCount != null ? { userCount: info.userCount } : {}), ...(info?.recordCount != null ? { recordCount: info.recordCount } : {}),
                protocol: "ZKTECO", reachable: true, ratio: 0,
            }
            const heard = this.heardAt.get(d.host)
            if (heard !== undefined && now - heard <= PUSH_HEARD_WITHIN_MS) {
                reports.set(`push:${d.host}`, report)
            } else if (this.listenError) {
                reports.set(`push:${d.host}`, { ...report, reachable: false, error: `The agent can't listen for it: ${this.listenError}`.slice(0, 500) })
            } else if (this.listeningSince !== null && now - this.listeningSince > PUSH_HEARD_WITHIN_MS) {
                const since = heard === undefined ? "the agent started" : new Date(heard).toISOString()
                reports.set(`push:${d.host}`, { ...report, reachable: false, error: `Not heard from since ${since}.` })
            }
        }
    }
}
