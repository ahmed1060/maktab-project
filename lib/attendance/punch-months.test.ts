import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import type { Prisma } from "@prisma/client"

// The 1st's shift, from the calendar as the engine reads it (review on #49).
const calendar = vi.hoisted(() => ({ firsts: new Map<string, { startMinutes: number; endMinutes: number }>(), asked: 0, through: [] as unknown[] }))
vi.mock("@/lib/services/attendance-engine.service", () => ({
    AttendanceEngineService: {
        plansFor: async (_companyId: string, userIds: string[], dates: string[], db?: unknown) => {
            calendar.asked += 1
            calendar.through.push(db)
            return {
                plans: new Map(userIds.map(u => [u, new Map(dates.flatMap(d => {
                    const hours = calendar.firsts.get(`${u}:${d}`)
                    return hours ? [[d, { kind: "WORK", hours: { ...hours, breakMinutes: 0 }, versionId: "v", overrideId: null }]] : []
                }))])),
                policyOn: () => null,
            }
        },
    },
}))

const { punchMonthsOf } = await import("@/lib/services/attendance-lock")
import { assignPunches } from "@/lib/attendance/engine"
import type { ExpectedDay } from "@/lib/attendance/calendar"

/**
 * The months a punch can change (lib/services/attendance-lock.ts): its own
 * date's, and the month before for a check-out after midnight on the 1st that
 * closes a night there. Approving a phone takes them for every check-in it
 * held, and was a query each (review on #22).
 */
describe("the months many punches can change", () => {
    beforeEach(() => { calendar.firsts.clear(); calendar.asked = 0; calendar.through = [] })
    const tx = (nights: { userId: string; date: string; expectedEndMinutes: number | null }[]) => {
        const findMany = vi.fn(async () => nights.map(n => ({ ...n, date: new Date(`${n.date}T00:00:00Z`) })))
        return { findMany, tx: { attendanceDay: { findMany, findUnique: vi.fn() } } as unknown as Prisma.TransactionClient }
    }

    it("reads the nights before once, however many punches", async () => {
        // Eman's 30 September night ends at 06:00 on the 1st; with its late margin, up to noon is that night's.
        const t = tx([{ userId: "e3", date: "2026-09-30", expectedEndMinutes: 1800 }])
        const punches = Array.from({ length: 300 }, (_, i) => ({ userId: "e3", local: `2026-10-01T${String(i % 24).padStart(2, "0")}:00:00` }))
        const months = await punchMonthsOf(t.tx, "c1", punches)
        expect(t.findMany).toHaveBeenCalledTimes(1)
        expect(calendar.asked).toBe(1)
        // Through the caller's transaction: on another connection, it could wait for good on a pool the
        // writers' transactions hold (review on #49).
        expect(calendar.through).toEqual([t.tx])
        expect(months[6]).toEqual(["2026-10", "2026-09"])
        expect(months[12]).toEqual(["2026-10", "2026-09"])
        expect(months[13]).toEqual(["2026-10"])
    })

    it("reads nothing when no punch is somebody's on the 1st, and keeps a punch with nobody to its own month", async () => {
        const t = tx([])
        expect(await punchMonthsOf(t.tx, "c1", [{ userId: "e3", local: "2026-10-02T06:00:00" }, { userId: null, local: "2026-10-01T06:00:00" }])).toEqual([["2026-10"], ["2026-10"]])
        expect(t.findMany).not.toHaveBeenCalled()
        expect(calendar.asked).toBe(0)
    })

    it("leaves to the 1st a punch nearer its own shift, as the engine assigns it (review on #13)", async () => {
        // The night roster ends with the month: 30 September 22:00–06:00, then 10:00–18:00 days from 1 October.
        const t = tx([{ userId: "e3", date: "2026-09-30", expectedEndMinutes: 1800 }])
        calendar.firsts.set("e3:2026-10-01", { startMinutes: 600, endMinutes: 1080 })
        const at = (time: string) => ({ userId: "e3", local: `2026-10-01T${time}:00` })
        const [late, early, tie] = await punchMonthsOf(t.tx, "c1", [at("09:30"), at("06:30"), at("08:00")])
        // 09:30: half an hour before the day's start, three and a half after the night's end.
        expect(late).toEqual(["2026-10"])
        // 06:30: the night's check-out.
        expect(early).toEqual(["2026-10", "2026-09"])
        // Two hours from each: the night's too.
        expect(tie).toEqual(["2026-10", "2026-09"])
        // Where the engine puts them.
        const plans = new Map([
            ["2026-09-30", { kind: "WORK", hours: { startMinutes: 1320, endMinutes: 1800 }, versionId: "night", overrideId: null }],
            ["2026-10-01", { kind: "WORK", hours: { startMinutes: 600, endMinutes: 1080 }, versionId: "day", overrideId: null }],
        ] as [string, ExpectedDay][])
        const assigned = assignPunches(["09:30", "06:30", "08:00"].map(time => ({ id: time, at: `2026-10-01T${time}:00`, direction: null })), plans)
        expect(assigned.get("2026-10-01")?.map(p => p.id)).toEqual(["09:30"])
        expect(assigned.get("2026-09-30")?.map(p => p.id)).toEqual(["06:30", "08:00"])
    })

    it("takes the 1st's shift from the calendar, not a stored day a failed rebuild left behind (review on #49)", async () => {
        // Stored, the 1st still starts at 10:00; the calendar has since moved it to 14:00, so 09:30 is the night's.
        const t = tx([
            { userId: "e3", date: "2026-09-30", expectedEndMinutes: 1800 },
            { userId: "e3", date: "2026-10-01", expectedEndMinutes: 1080, expectedStartMinutes: 600 } as never,
        ])
        calendar.firsts.set("e3:2026-10-01", { startMinutes: 840, endMinutes: 1320 })
        expect(await punchMonthsOf(t.tx, "c1", [{ userId: "e3", local: "2026-10-01T09:30:00" }])).toEqual([["2026-10", "2026-09"]])
    })

    it("is what a terminal agent's batch takes, at once (review on #49)", () => {
        const ingest = readFileSync("lib/services/attendance-ingest.service.ts", "utf8")
        expect(ingest).toContain("await punchMonthsOf(tx, companyId, keys.map(")
        expect(ingest).not.toMatch(/await punchMonths\(/)
    })

    it("is what approving a phone takes for what it held", () => {
        const phones = readFileSync("lib/services/attendance-phone.service.ts", "utf8")
        expect(phones).toContain("await punchMonthsOf(tx, phone.companyId, waiting.map(")
        expect(phones).not.toMatch(/for \(const w of waiting\)/)
    })
})
