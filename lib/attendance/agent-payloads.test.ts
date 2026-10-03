import { describe, it, expect } from "vitest"
import { heartbeatSchema, punchBatchSchema, MAX_PUNCHES_PER_BATCH } from "./agent-payloads"
import { wallClockDrift } from "@/lib/services/attendance-device.service"

describe("what an agent sends (ATTENDANCE_PLAN.md §17)", () => {
    const beat = { agentVersion: "1.0.0", queueDepth: 3, clock: "2026-10-01T08:00:00+03:00", devices: [{ serialNumber: "SN1", reachable: true, clock: "2026-10-01T08:00:10" }] }

    it("takes a heartbeat with its clock as an instant and each terminal's as a wall clock", () => {
        expect(heartbeatSchema.safeParse(beat).success).toBe(true)
        expect(heartbeatSchema.safeParse({ ...beat, clock: "2026-10-01T08:00:00" }).success).toBe(false)
        expect(heartbeatSchema.safeParse({ ...beat, devices: [{ serialNumber: "SN1", reachable: true, clock: "2026-10-01 08:00" }] }).success).toBe(false)
        expect(heartbeatSchema.safeParse({ ...beat, devices: [{ serialNumber: " ", reachable: true }] }).success).toBe(false)
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
