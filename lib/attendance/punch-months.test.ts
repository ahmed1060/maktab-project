import { describe, it, expect, vi } from "vitest"
import { readFileSync } from "node:fs"
import type { Prisma } from "@prisma/client"
import { punchMonthsOf } from "@/lib/services/attendance-lock"

/**
 * The months a punch can change (lib/services/attendance-lock.ts): its own
 * date's, and the month before for a check-out after midnight on the 1st that
 * closes a night there. Approving a phone takes them for every check-in it
 * held, and was a query each (review on #22).
 */
describe("the months many punches can change", () => {
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
        expect(months[6]).toEqual(["2026-10", "2026-09"])
        expect(months[12]).toEqual(["2026-10", "2026-09"])
        expect(months[13]).toEqual(["2026-10"])
    })

    it("reads nothing when no punch is somebody's on the 1st, and keeps a punch with nobody to its own month", async () => {
        const t = tx([])
        expect(await punchMonthsOf(t.tx, "c1", [{ userId: "e3", local: "2026-10-02T06:00:00" }, { userId: null, local: "2026-10-01T06:00:00" }])).toEqual([["2026-10"], ["2026-10"]])
        expect(t.findMany).not.toHaveBeenCalled()
    })

    it("is what approving a phone takes for what it held", () => {
        const phones = readFileSync("lib/services/attendance-phone.service.ts", "utf8")
        expect(phones).toContain("await punchMonthsOf(tx, phone.companyId, waiting.map(")
        expect(phones).not.toMatch(/for \(const w of waiting\)/)
    })
})
