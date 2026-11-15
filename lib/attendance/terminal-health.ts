import { offsetMsIn } from "@/lib/time"

/**
 * Whether an office's agent and terminals are working (ATTENDANCE_PLAN.md
 * §13.2): last seen, last sync, clock drift, queue depth, memory. Silence
 * matters during working hours, when punches should be arriving; at night
 * or on a day off a PC switched off is normal, so it is "quiet", not red.
 */

/** Heartbeats come every minute or so; this many minutes of nothing is silence. */
export const SILENT_AFTER_MINUTES = 15
/**
 * A terminal straight to Nizmo calls when someone scans, and whether it
 * sends heartbeats between scans is the trial's to answer (§17.7, §18, 4;
 * PR 292). Until then it is working while heard from within a day.
 */
export const DIRECT_SILENT_AFTER_MINUTES = 24 * 60
/** The hours, local, in which a working day's terminals should be heard. */
export const WORKING_HOURS = { from: 7 * 60, to: 19 * 60 }
/** A terminal clock this far off moves punches enough to matter. */
export const CLOCK_WARN_SECONDS = 120
/** A terminal's memory this full should be cleared before it refuses scans. */
export const MEMORY_WARN_RATIO = 0.8

/** Whether it is now within working hours on a working day, in the company's time zone. */
export function inWorkingHours(now: Date, timeZone: string, workWeek: readonly number[]): boolean {
    const local = new Date(now.getTime() + offsetMsIn(now, timeZone))
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
    return workWeek.includes(local.getUTCDay()) && minutes >= WORKING_HOURS.from && minutes < WORKING_HOURS.to
}

const silent = (lastSeenAt: Date | null, now: Date, afterMinutes = SILENT_AFTER_MINUTES) => !lastSeenAt || now.getTime() - lastSeenAt.getTime() > afterMinutes * 60_000

export type AgentHealth = "WAITING" | "REVOKED" | "OK" | "SILENT" | "QUIET"

export function agentHealth(agent: { status: string; lastSeenAt: Date | null }, now: Date, working: boolean): AgentHealth {
    if (agent.status === "REVOKED") return "REVOKED"
    if (agent.status === "PENDING") return "WAITING"
    if (!silent(agent.lastSeenAt, now)) return "OK"
    return working ? "SILENT" : "QUIET"
}

/**
 * `WAITING`: added by hand and not heard from yet, by an agent's report or
 * its own call (§17.7, PR 292). Only one added by hand waits: one an agent
 * brought in was heard of when it was, so its silence is silence.
 */
export type DeviceHealth = { state: "RETIRED" | "WAITING" | "OK" | "UNREACHABLE" | "SILENT" | "QUIET"; memoryFull: boolean; clockOff: boolean }

/**
 * How a terminal is doing now. Through the agent, it is the agent that
 * says: out of reach, or heard from at its last heartbeats. Straight to
 * Nizmo, it is the terminal's own calls, and whether an agent reaches it
 * says nothing.
 */
export function deviceHealth(
    device: {
        retiredAt: Date | null; reachable: boolean; lastSeenAt: Date | null; recordCount: number | null; recordCapacity: number | null; clockDriftSeconds: number | null
        connection?: "AGENT" | "DIRECT"
        /** Who added it by hand; empty for one an agent brought in. */
        addedById?: string | null
    },
    now: Date, working: boolean,
): DeviceHealth {
    const memoryFull = !!device.recordCapacity && (device.recordCount ?? 0) / device.recordCapacity >= MEMORY_WARN_RATIO
    const clockOff = device.clockDriftSeconds !== null && Math.abs(device.clockDriftSeconds) > CLOCK_WARN_SECONDS
    if (device.retiredAt) return { state: "RETIRED", memoryFull: false, clockOff: false }
    const direct = device.connection === "DIRECT"
    const state = !direct && !device.reachable ? "UNREACHABLE"
        : !device.lastSeenAt && device.addedById ? "WAITING"
            : !silent(device.lastSeenAt, now, direct ? DIRECT_SILENT_AFTER_MINUTES : SILENT_AFTER_MINUTES) ? "OK"
                : working ? "SILENT" : "QUIET"
    return { state, memoryFull, clockOff }
}
