import { z } from "zod"

/**
 * What a Local Sync Agent sends (ATTENDANCE_PLAN.md §17). Never a company,
 * never one of our ids for a person: the company is the agent's, and a
 * person is the terminal's own user number, mapped here (§2.3).
 */

/** A wall-clock time as the terminal shows it: "2026-10-01T08:05:00", no zone. */
const wallClock = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "a local time, YYYY-MM-DDTHH:mm:ss")

/**
 * Whether a wall-clock time in that shape is one a calendar has: a terminal
 * packs months of 31 days, so a damaged record reads as 30 February, which
 * Date quietly makes 2 March (review on #17). Years as a terminal counts
 * them, from 2000.
 */
export function isRealWallClock(local: string): boolean {
    const at = new Date(`${local}Z`)
    return !isNaN(at.getTime()) && at.toISOString().slice(0, 19) === local && local >= "2000" && local < "2100"
}
const serial = z.string().trim().min(1).max(64)
const count = z.number().int().min(0).max(10_000_000)

export const MAX_DEVICES_PER_HEARTBEAT = 100
export const MAX_PUNCHES_PER_BATCH = 1000

export const heartbeatSchema = z.object({
    agentVersion: z.string().trim().min(1).max(50),
    hostname: z.string().trim().max(200).optional(),
    /** Punches it holds and has not yet delivered. */
    queueDepth: count,
    /** Its own clock, as an instant (ISO 8601 with a zone). */
    clock: z.string().datetime({ offset: true }),
    devices: z.array(z.object({
        serialNumber: serial,
        /** A name for a terminal seen for the first time; an admin can change it here. */
        name: z.string().trim().max(80).optional(),
        model: z.string().trim().max(80).optional(),
        firmware: z.string().trim().max(80).optional(),
        /** Whether the agent reached it this time. */
        reachable: z.boolean(),
        error: z.string().max(500).optional(),
        /**
         * The terminal's own clock, read just now. One no calendar has is
         * left out, as if unread: refusing the heartbeat would hold up every
         * punch behind it, round after round.
         */
        clock: wallClock.optional().transform(c => (c && isRealWallClock(c) ? c : undefined)),
        userCount: count.optional(),
        recordCount: count.optional(),
        recordCapacity: count.optional(),
    })).max(MAX_DEVICES_PER_HEARTBEAT),
})
export type Heartbeat = z.infer<typeof heartbeatSchema>

export const punchBatchSchema = z.object({
    punches: z.array(z.object({
        serialNumber: serial,
        /** The terminal's user number: the employee number mapped to a person here. */
        userNumber: z.string().trim().min(1).max(32),
        /** One no calendar has is refused on its own, for good (INVALID_TIME), not with the batch. */
        at: wallClock,
    })).min(1).max(MAX_PUNCHES_PER_BATCH),
})
export type PunchBatch = z.infer<typeof punchBatchSchema>
