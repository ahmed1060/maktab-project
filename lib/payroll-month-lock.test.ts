import { describe, it, expect, vi, afterEach } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { PayrollPeriodService } from "@/lib/services/payroll-period.service"
import { SETTLED, lockDateMonths, lockMonths, lockPunchMonthsOf, lockedMonths, reachOf } from "@/lib/services/attendance-lock"

/**
 * The payroll month a writer writes to (LATER_CHANGES_PLAN.md §7.10, Codex
 * review on PR 430). A date after its month's close is the next month's, so
 * which month it is can move: a payday changed, or payroll set to close on
 * another day. Read before the month's lock is taken, a month approved in
 * between could freeze the day without what was written to it, the writer
 * then checking the month it read, still open. So a writer locks both months
 * a date can fall in first, and reads which of them it is under those locks.
 */

// What a transaction is asked, in order: each lock taken, by its key, and the read. `settled`: the days a final
// settlement counted, as "userId:date".
function recording(settled: string[] = []) {
    const asked: string[] = []
    const tx = {
        $queryRaw: async (_: TemplateStringsArray, key: string) => { asked.push(key); return [] },
        attendanceDay: {
            findMany: async ({ where }: { where: { userId: { in: string[] }; date: { in: Date[] } } }) => settled
                .map(k => ({ userId: k.slice(0, k.indexOf(":")), date: new Date(`${k.slice(k.indexOf(":") + 1)}T00:00:00Z`) }))
                .filter(d => where.userId.in.includes(d.userId) && where.date.in.some(x => x.getTime() === d.date.getTime())),
        },
        payrollRun: { findMany: async () => [] },
    }
    return { asked, tx: tx as never }
}

afterEach(() => { vi.restoreAllMocks() })

describe("the payroll month a writer writes to", () => {
    it("can be a date's own calendar month's or the next's, and no other", () => {
        expect(reachOf("2026-11-26")).toEqual(["2026-11", "2026-12"])
        expect(reachOf("2026-12-31")).toEqual(["2026-12", "2027-01"])
        expect(reachOf("2027-01-31")).toEqual(["2027-01", "2027-02"])
    })

    it("is read once both months each date can fall in are locked", async () => {
        const { asked, tx } = recording()
        vi.spyOn(PayrollPeriodService, "monthsOfDates").mockImplementation(async () => { asked.push("read"); return ["2026-12"] })
        expect(await lockDateMonths(tx, "c1", ["2026-11-26", "2026-11-26", "2026-11-27"])).toEqual(["2026-12"])
        expect(asked).toEqual(["attendance-month:c1:2026-11", "attendance-month:c1:2026-12", "read"])
    })

    it("for a punch, both months of the day before, its own and the day after, a shift can be on any of them", async () => {
        const { asked, tx } = recording()
        vi.spyOn(PayrollPeriodService, "payrollMonthsOf").mockImplementation(async (_db, _company, dates) => {
            asked.push("read")
            return new Map(dates.map(d => [d, d.slice(0, 7)]))
        })
        // Nobody's yet: its own date's month, read under the locks.
        expect(await lockPunchMonthsOf(tx, "c1", [{ userId: null, local: "2026-12-01T00:30:00" }])).toEqual([["2026-12"]])
        expect(asked).toEqual(["attendance-month:c1:2026-11", "attendance-month:c1:2026-12", "attendance-month:c1:2027-01", "read"])
    })

    it("says a day a final settlement counted is paid, as an approved month's are (Codex review on PR 430)", async () => {
        vi.spyOn(PayrollPeriodService, "monthsOfDates").mockImplementation(async () => ["2026-12"])
        vi.spyOn(PayrollPeriodService, "payrollMonthsOf").mockImplementation(async (_db, _company, dates) => new Map(dates.map(d => [d, d.slice(0, 7)])))
        // Ehab's 26th, after November closed, is his settlement's.
        const { tx } = recording(["e1:2026-11-26"])
        expect(await lockDateMonths(tx, "c1", ["2026-11-26"], "e1")).toEqual(["2026-12", SETTLED])
        expect(await lockDateMonths(tx, "c1", ["2026-11-26"], "e9")).toEqual(["2026-12"])
        // A punch whose shift can be on it: its own day, the day after, the day before.
        expect(await lockPunchMonthsOf(tx, "c1", [
            { userId: "e1", local: "2026-11-27T00:30:00" }, { userId: "e1", local: "2026-11-25T23:30:00" },
            { userId: "e1", local: "2026-11-28T09:00:00" }, { userId: null, local: "2026-11-26T09:00:00" },
        ])).toEqual([["2026-11", SETTLED], ["2026-11", SETTLED], ["2026-11"], ["2026-11"]])
        // Reported as locked, never locked as a month.
        expect(await lockedMonths(tx, "c1", ["2026-12", SETTLED])).toEqual(new Set([SETTLED]))
        const { asked, tx: counting } = recording()
        await lockMonths(counting, "c1", ["2026-12", SETTLED])
        expect(asked).toEqual(["attendance-month:c1:2026-12"])
    })

    it("is what every writer reads, the plain readers left to what writes nothing", () => {
        const READERS = /\b(monthsOfDates|punchMonthsOf|punchMonths)\(/g
        // Where they're defined, and the two that only read: the list of check-ins
        // to review, and a file's preview, which writes nothing and waits on nobody.
        const DEFINED = ["lib/services/attendance-lock.ts", "lib/services/payroll-period.service.ts"]
        const READ_ONLY = { "lib/services/attendance-flag.service.ts": 1, "lib/services/attendance-punch.service.ts": 1 }
        const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
            const path = join(dir, name)
            if (statSync(path).isDirectory()) return name === "node_modules" ? [] : files(path)
            return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
        })
        const found: Record<string, number> = {}
        for (const file of [...files("lib"), ...files("app")]) {
            if (DEFINED.includes(file)) continue
            const n = (readFileSync(file, "utf8").match(READERS) ?? []).length
            if (n > 0) found[file] = n
        }
        expect(found).toEqual(READ_ONLY)
        expect(readFileSync("lib/services/attendance-flag.service.ts", "utf8")).toContain("await punchMonthsOf(prisma, companyId,")
        expect(readFileSync("lib/services/attendance-punch.service.ts", "utf8")).toContain("const rowMonths = commit ? await lockPunchMonthsOf(tx, companyId, rows) : await punchMonthsOf(tx, companyId, rows)")
        // The person whose days they are, so a day their settlement counted is refused (Codex review on PR 430).
        expect(readFileSync("lib/services/attendance-exception.service.ts", "utf8").match(/await openMonth\(tx, [\w.]+, [\w.]+, [\w.]+\)/g)).toHaveLength(2)
        expect(readFileSync("lib/services/attendance-request.service.ts", "utf8").match(/await openDate\(tx, [\w.]+, [\w.]+, [\w.]+\)/g)).toHaveLength(5)
        expect(readFileSync("lib/services/mission-request.service.ts", "utf8").match(/if \(\(await lockDateMonths\(tx, [\w.]+, (?:[\w.]+|datesOf\(from, to\)), [\w.]+\)\)\.includes\(SETTLED\)\) fail\("PAYROLL_MONTH_LOCKED"\)/g)).toHaveLength(3)
    })
})
