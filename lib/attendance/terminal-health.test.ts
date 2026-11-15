import { describe, it, expect } from "vitest"
import { DIRECT_SILENT_AFTER_MINUTES, agentHealth, deviceHealth, inWorkingHours } from "./terminal-health"

const SUN_TO_THU = [0, 1, 2, 3, 4]
// Thursday 1 October 2026; Cairo is UTC+3.
const at = (cairo: string) => new Date(`${cairo}+03:00`)

describe("terminal health (ATTENDANCE_PLAN.md §13.2)", () => {
    it("knows working hours on a working day, in the company's time zone", () => {
        expect(inWorkingHours(at("2026-10-01T09:00:00"), "Africa/Cairo", SUN_TO_THU)).toBe(true)
        expect(inWorkingHours(at("2026-10-01T06:59:00"), "Africa/Cairo", SUN_TO_THU)).toBe(false)
        expect(inWorkingHours(at("2026-10-01T19:00:00"), "Africa/Cairo", SUN_TO_THU)).toBe(false)
        // Friday.
        expect(inWorkingHours(at("2026-10-02T09:00:00"), "Africa/Cairo", SUN_TO_THU)).toBe(false)
        expect(inWorkingHours(at("2026-10-02T09:00:00"), "Africa/Cairo", [5])).toBe(true)
    })

    it("calls an agent silent only when it should be heard", () => {
        const now = at("2026-10-01T10:00:00")
        const recently = new Date(now.getTime() - 5 * 60_000)
        const anHourAgo = new Date(now.getTime() - 60 * 60_000)
        expect(agentHealth({ status: "ACTIVE", lastSeenAt: recently }, now, true)).toBe("OK")
        expect(agentHealth({ status: "ACTIVE", lastSeenAt: anHourAgo }, now, true)).toBe("SILENT")
        expect(agentHealth({ status: "ACTIVE", lastSeenAt: anHourAgo }, now, false)).toBe("QUIET")
        expect(agentHealth({ status: "ACTIVE", lastSeenAt: null }, now, true)).toBe("SILENT")
        expect(agentHealth({ status: "PENDING", lastSeenAt: null }, now, true)).toBe("WAITING")
        expect(agentHealth({ status: "REVOKED", lastSeenAt: recently }, now, true)).toBe("REVOKED")
    })

    it("flags a terminal out of reach, nearly full, or with its clock off", () => {
        const now = at("2026-10-01T10:00:00")
        const base = { retiredAt: null, reachable: true, lastSeenAt: now, recordCount: 1000, recordCapacity: 100_000, clockDriftSeconds: 30 }
        expect(deviceHealth(base, now, true)).toEqual({ state: "OK", memoryFull: false, clockOff: false })
        expect(deviceHealth({ ...base, reachable: false }, now, false).state).toBe("UNREACHABLE")
        expect(deviceHealth({ ...base, recordCount: 80_000 }, now, true).memoryFull).toBe(true)
        expect(deviceHealth({ ...base, clockDriftSeconds: -300 }, now, true).clockOff).toBe(true)
        expect(deviceHealth({ ...base, recordCapacity: null }, now, true).memoryFull).toBe(false)
        expect(deviceHealth({ ...base, lastSeenAt: new Date(now.getTime() - 3_600_000) }, now, true).state).toBe("SILENT")
        expect(deviceHealth({ ...base, retiredAt: now, reachable: false }, now, true)).toEqual({ state: "RETIRED", memoryFull: false, clockOff: false })
    })

    it("waits for a terminal added by hand until it is heard from (PR 292)", () => {
        const now = at("2026-10-01T10:00:00")
        const added = { retiredAt: null, reachable: true, lastSeenAt: null, recordCount: null, recordCapacity: null, clockDriftSeconds: null, addedById: "a1" }
        // Whether or not anyone is at work: nothing is expected of it yet.
        for (const working of [true, false]) {
            expect(deviceHealth({ ...added, connection: "AGENT" }, now, working).state).toBe("WAITING")
            expect(deviceHealth({ ...added, connection: "DIRECT" }, now, working).state).toBe("WAITING")
            expect(deviceHealth(added, now, working).state).toBe("WAITING")
        }
        // Once an agent reports it, the agent says how it is.
        expect(deviceHealth({ ...added, connection: "AGENT", reachable: false }, now, true).state).toBe("UNREACHABLE")
        expect(deviceHealth({ ...added, connection: "AGENT", lastSeenAt: now }, now, true).state).toBe("OK")
        expect(deviceHealth({ ...added, retiredAt: now }, now, true).state).toBe("RETIRED")
        // One an agent brought in was heard of when it was: with no contact kept, it is silent as before, not waiting (found in the browser).
        for (const addedById of [null, undefined]) {
            expect(deviceHealth({ ...added, addedById, connection: "AGENT" }, now, true).state).toBe("SILENT")
            expect(deviceHealth({ ...added, addedById, connection: "AGENT" }, now, false).state).toBe("QUIET")
            expect(deviceHealth({ ...added, addedById }, now, true).state).toBe("SILENT")
        }
    })

    it("calls a terminal straight to Nizmo working while it was heard from within a day (PR 292)", () => {
        const now = at("2026-10-01T10:00:00")
        const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000)
        const direct = { retiredAt: null, reachable: true, lastSeenAt: now, recordCount: null, recordCapacity: null, clockDriftSeconds: null, connection: "DIRECT" as const }
        expect(DIRECT_SILENT_AFTER_MINUTES).toBe(24 * 60)
        // It calls when someone scans: an hour between scans is a quiet door, not a silent terminal.
        expect(deviceHealth({ ...direct, lastSeenAt: ago(60) }, now, true).state).toBe("OK")
        expect(deviceHealth({ ...direct, lastSeenAt: ago(23 * 60) }, now, true).state).toBe("OK")
        expect(deviceHealth({ ...direct, lastSeenAt: ago(25 * 60) }, now, true).state).toBe("SILENT")
        expect(deviceHealth({ ...direct, lastSeenAt: ago(25 * 60) }, now, false).state).toBe("QUIET")
        // The same hour of silence is silence for one the agent reads every minute.
        expect(deviceHealth({ ...direct, connection: "AGENT", lastSeenAt: ago(60) }, now, true).state).toBe("SILENT")
        // Whether an agent reaches it says nothing of one that calls Nizmo itself.
        expect(deviceHealth({ ...direct, reachable: false }, now, true).state).toBe("OK")
    })
})
