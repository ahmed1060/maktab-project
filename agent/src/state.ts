import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeSync } from "node:fs"
import { dirname } from "node:path"
import type { HikCursor } from "./hik/events"
import type { TerminalInfo } from "./zk/adms"

/**
 * What the agent remembers between rounds and restarts, in one file written
 * atomically (a temporary file, flushed, then renamed over the old one), so
 * a power cut leaves either the old state or the new, never half of each.
 *
 * Punches read from a terminal go into the queue here before anything else
 * happens to them, and leave it only when the server has stored them or
 * said that it never will. The token is here too: the file is the agent's
 * identity, and belongs where only the service account can read it.
 */

export type QueuedPunch = { serialNumber: string; userNumber: string; at: string }

/**
 * A terminal that pushes to the agent (ATTENDANCE_PLAN.md §17.12, PR 305),
 * by its address: which terminal called from there; where it had got to,
 * as Nizmo keeps it for one straight to Nizmo ("ATTLOG=120;OPERLOG=9");
 * `direct` when Nizmo has it set straight to Nizmo, so it's held; and what
 * its polls say of it.
 */
export type Pusher = { serialNumber: string | null; pushCursor: string | null; direct?: boolean; info?: TerminalInfo | null }

/** How far into a terminal's log the agent has read: its position, and the last record there to be sure. */
export type Cursor = { count: number; lastKey: string | null }

export type AgentState = {
    version: 1
    token: string | null
    agentId: string | null
    company: string | null
    timeZone: string | null
    enrolledAt: string | null
    /** Records older than this date are not sent (see config.sendFrom). */
    sendFrom: string | null
    /** The start the cursors were last moved under ("" for none): moved earlier, the logs are read again. */
    readFrom?: string | null
    /**
     * By "host:port", as configured. `direct`: the server said the terminal
     * is set to connect straight to Nizmo, so its log is left alone until
     * the server says it is this agent's again.
     *
     * A Hikvision terminal's place in its events is `hikCursor`, the last
     * event read (agent/src/hik/events.ts), and `certificate` is the
     * fingerprint pinned on the first read over HTTPS (PR 302).
     */
    devices: Record<string, { serialNumber: string | null; cursor: Cursor; mustEnable?: boolean; direct?: boolean; hikCursor?: HikCursor; certificate?: string | null }>
    /** The terminals that push to the agent, by their address (PR 305); none in a state file before it. */
    pushers: Record<string, Pusher>
    queue: QueuedPunch[]
    /** Set when the server no longer accepts the token: nothing is sent until the agent is enrolled again. */
    needsEnrolment: boolean
}

export const emptyState = (): AgentState => ({
    version: 1, token: null, agentId: null, company: null, timeZone: null, enrolledAt: null, sendFrom: null,
    devices: {}, pushers: {}, queue: [], needsEnrolment: false,
})

export function loadState(path: string): AgentState {
    if (!existsSync(path)) return emptyState()
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (parsed?.version !== 1) throw new Error(`${path} was written by a different version of the agent.`)
    return { ...emptyState(), ...parsed }
}

export function saveState(path: string, state: AgentState): void {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    const fd = openSync(tmp, "w", 0o600)
    try {
        writeSync(fd, JSON.stringify(state))
        fsyncSync(fd)
    } finally {
        closeSync(fd)
    }
    renameSync(tmp, path)
}
