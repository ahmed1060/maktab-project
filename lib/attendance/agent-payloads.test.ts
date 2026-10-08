import { describe, it, expect } from "vitest"
import { heartbeatSchema, punchBatchSchema, isRealWallClock, MAX_PUNCHES_PER_BATCH } from "./agent-payloads"
import { wallClockDrift } from "@/lib/services/attendance-device.service"

describe("what an agent sends (ATTENDANCE_PLAN.md §17)", () => {
    const beat = { agentVersion: "1.0.0", queueDepth: 3, clock: "2026-10-01T08:00:00+03:00", devices: [{ serialNumber: "SN1", reachable: true, clock: "2026-10-01T08:00:10" }] }

    it("takes a heartbeat with its clock as an instant and each terminal's as a wall clock", () => {
        expect(heartbeatSchema.safeParse(beat).success).toBe(true)
        expect(heartbeatSchema.safeParse({ ...beat, clock: "2026-10-01T08:00:00" }).success).toBe(false)
        expect(heartbeatSchema.safeParse({ ...beat, devices: [{ serialNumber: "SN1", reachable: true, clock: "2026-10-01 08:00" }] }).success).toBe(false)
        expect(heartbeatSchema.safeParse({ ...beat, devices: [{ serialNumber: " ", reachable: true }] }).success).toBe(false)
    })

    it("knows a time no calendar has, as a damaged terminal record reads (review on #17)", () => {
        for (const ok of ["2026-02-28T23:59:59", "2028-02-29T09:00:00", "2000-01-01T00:00:00"]) expect(isRealWallClock(ok), ok).toBe(true)
        // A terminal packs months of 31 days; Date would quietly make the first 2 March.
        for (const bad of ["2026-02-30T09:00:00", "2026-04-31T09:00:00", "2027-02-29T09:00:00", "2026-13-01T09:00:00", "2026-10-01T24:00:00", "2026-10-01T23:60:00", "1999-12-31T23:59:59", "2133-01-01T00:00:00"]) {
            expect(isRealWallClock(bad), bad).toBe(false)
        }
    })

    it("leaves out a terminal clock no calendar has, rather than refusing the heartbeat and every punch behind it", () => {
        const parsed = heartbeatSchema.parse({ ...beat, devices: [{ serialNumber: "SN1", reachable: true, clock: "2026-02-30T08:00:10" }] })
        expect(parsed.devices[0].clock).toBeUndefined()
        expect(heartbeatSchema.parse(beat).devices[0].clock).toBe("2026-10-01T08:00:10")
    })

    it("keeps nothing it does not know, so a company or person id sent along goes nowhere", () => {
        const parsed = heartbeatSchema.parse({ ...beat, companyId: "c2" })
        expect(parsed).not.toHaveProperty("companyId")
        const batch = punchBatchSchema.parse({ punches: [{ serialNumber: "SN1", userNumber: "7", at: "2026-10-01T08:00:00", userId: "u1" }] })
        expect(batch.punches[0]).not.toHaveProperty("userId")
    })

    it("takes between one and a thousand punches at a time", () => {
        const p = { serialNumber: "SN1", userNumber: "7", at: "2026-10-01T08:00:00" }
        expect(punchBatchSchema.safeParse({ punches: [] }).success).toBe(false)
        expect(punchBatchSchema.safeParse({ punches: Array(MAX_PUNCHES_PER_BATCH).fill(p) }).success).toBe(true)
        expect(punchBatchSchema.safeParse({ punches: Array(MAX_PUNCHES_PER_BATCH + 1).fill(p) }).success).toBe(false)
    })

    it("measures a terminal's clock against the company's wall clock", () => {
        // 05:00:00Z is 08:00:00 in Cairo in October (UTC+3).
        const now = new Date("2026-10-01T05:00:00Z")
        expect(wallClockDrift("2026-10-01T08:00:10", "Africa/Cairo", now)).toBe(10)
        expect(wallClockDrift("2026-10-01T07:59:00", "Africa/Cairo", now)).toBe(-60)
    })
})
