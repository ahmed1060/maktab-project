/**
 * Which of a Hikvision terminal's events the agent keeps, and where it had
 * got to (ATTENDANCE_PLAN.md §17.4). Nothing here needs the network.
 */

/** Hikvision's major type for events, as against alarms, exceptions and operations. */
export const MAJOR_EVENT = 5

/**
 * The minor types for an identity check that passed: the same as Nizmo's
 * when a terminal sends straight to it (lib/attendance/hikvision-events.ts),
 * held in step by a test. From Hikvision's own SDK header (HCNetSDK.h,
 * MINOR_*_PASS under MAJOR_EVENT).
 */
export const PASSED_CHECKS: ReadonlySet<number> = new Set([
    0x01, 0x02, 0x26, 0x28, 0x2b, 0x2e, 0x36, 0x39, 0x3c, 0x3f, 0x42, 0x45, 0x48, 0x4b, 0x4d, 0x65, 0x69,
])

/** One event as the terminal writes it in `AcsEvent`'s `InfoList`. */
export type HikEvent = {
    major: number
    minor: number
    /** Its wall time with its offset, such as 2026-11-16T09:05:00+02:00. */
    time: string
    /** The terminal's own order. */
    serialNo: number
    employeeNoString?: string
    employeeNo?: number | string
}

/** Where the agent had got to in a terminal's events: the last one read. */
export type HikCursor = { serialNo: number; time: string } | null

/** A scan: the employee number, at the terminal's wall time. No name, no card. */
export type HikRecord = { userNumber: string; at: string }

const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/

/**
 * The passed checks among the events that are new since the cursor, and
 * where it is after them.
 *
 * New is past the cursor's serial number. If every event found is numbered
 * below it, the terminal's log was cleared or restarted: the events from the
 * cursor's time on are new, and Nizmo stores each scan once. The cursor
 * moves to the highest numbered event found, passed check or not, so what
 * isn't a scan isn't looked at again.
 */
export function pickNew(events: readonly HikEvent[], cursor: HikCursor): { records: HikRecord[]; cursor: HikCursor } {
    if (events.length === 0) return { records: [], cursor }
    const ordered = [...events].sort((a, b) => a.serialNo - b.serialNo)
    const last = ordered[ordered.length - 1]
    const restarted = cursor !== null && last.serialNo < cursor.serialNo
    const since = cursor ? Date.parse(cursor.time) : NaN
    const fresh = cursor === null ? ordered
        : restarted ? ordered.filter(e => Number.isNaN(since) || Date.parse(e.time) >= since)
            : ordered.filter(e => e.serialNo > cursor.serialNo)
    const records: HikRecord[] = []
    for (const e of fresh) {
        if (e.major !== MAJOR_EVENT || !PASSED_CHECKS.has(e.minor)) continue
        const userNumber = String(e.employeeNoString ?? e.employeeNo ?? "").trim()
        // A card issued to nobody is no one's scan.
        if (!userNumber) continue
        const wall = WALL.exec(e.time)
        if (!wall) continue
        records.push({ userNumber, at: wall[0] })
    }
    return { records, cursor: { serialNo: last.serialNo, time: last.time } }
}
