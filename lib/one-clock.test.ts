import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { calendarParts, calendarMonth, calendarYear, calendarDateStr, startOfMonthIn, startOfDayIn } from "./time"
import { stripComments } from "./strip-comments"

/**
 * The clock rule, in two halves: instants are UTC, calendar decisions are local.
 *
 * Before this, eleven places decided which month or year a record belongs to,
 * on three different clocks. The job that *creates* each month's salary record
 * worked in UTC; every path that later *finds* that record worked on the
 * server's local clock; and one stamped a year from Egypt. Cairo runs two or
 * three hours ahead, so it enters a new month first — which means a task
 * penalty at 00:30 Cairo on 1 October is October's, while UTC still reads 30
 * September and files it against a month that is closed.
 *
 * It is latent on Vercel, whose runtime sets no TZ, so server-local *is* UTC
 * and two of the three agree. That is an environment default nobody chose, not
 * a decision anyone made: it is already false on a developer's machine, and
 * agreeing on UTC is agreeing on the wrong answer for the first three hours of
 * every month regardless.
 */

const CAIRO = "Africa/Cairo"

describe("a calendar decision is answered where the person is", () => {
    it("reads the month Cairo is in, not the one UTC is in", () => {
        // 22:30 UTC on 30 September is 00:30 on 1 October in Cairo. This exact
        // instant is the bug: the old code filed it against September.
        const instant = new Date("2026-09-30T22:30:00Z")
        expect(calendarMonth(instant, CAIRO)).toEqual({ month: 10, year: 2026 })
        expect(instant.getUTCMonth() + 1).toBe(9)
    })

    it("rolls the year over on Cairo's new year, not UTC's", () => {
        const instant = new Date("2026-12-31T22:30:00Z")
        expect(calendarYear(instant, CAIRO)).toBe(2027)
        expect(instant.getUTCFullYear()).toBe(2026)
    })

    it("gives a 1-12 month, not a 0-11 one", () => {
        // Date's zero-based month is a bug generator, and half the sites this
        // replaced carried a + 1 to undo it.
        expect(calendarParts(new Date("2026-01-15T12:00:00Z"), CAIRO).month).toBe(1)
        expect(calendarParts(new Date("2026-12-15T12:00:00Z"), CAIRO).month).toBe(12)
    })

    it("reports midnight as hour zero", () => {
        // hour12:false yields 24 rather than 0 in some runtimes, which would
        // make a midnight reading look like the end of the previous day.
        expect(calendarParts(new Date("2026-06-14T21:00:00Z"), CAIRO).hour).toBe(0)
    })

    it("handles both sides of Egypt's daylight saving", () => {
        // Egypt reintroduced DST in 2023: +02:00 in winter, +03:00 in summer.
        // Hardcoding either is wrong for half the year.
        expect(calendarParts(new Date("2026-01-15T00:00:00Z"), CAIRO).hour).toBe(2)
        expect(calendarParts(new Date("2026-07-15T00:00:00Z"), CAIRO).hour).toBe(3)
    })
})

describe("boundaries come back as real UTC instants", () => {
    it("starts the month at local midnight", () => {
        const start = startOfMonthIn(new Date("2026-09-15T12:00:00Z"), CAIRO)
        // 1 September 00:00 Cairo is 31 August 21:00 UTC (summer, +03:00).
        expect(start.toISOString()).toBe("2026-08-31T21:00:00.000Z")
        // And it is the same moment Cairo calls the 1st.
        expect(calendarDateStr(start, CAIRO)).toBe("2026-09-01")
    })

    it("starts the day at local midnight", () => {
        const start = startOfDayIn(new Date("2026-09-15T12:00:00Z"), CAIRO)
        expect(calendarDateStr(start, CAIRO)).toBe("2026-09-15")
        expect(calendarParts(start, CAIRO).hour).toBe(0)
    })

    it("is a genuine instant, unlike the helper it replaced", () => {
        // getEgyptNow returned `new Date(now.toLocaleString(...))` — a Date
        // whose instant was two or three hours wrong. Anything built from one
        // of those and then stored carried the error into the database.
        const now = new Date("2026-09-15T12:00:00Z")
        expect(startOfDayIn(now, CAIRO).getTime()).toBeLessThan(now.getTime())
        expect(Number.isFinite(startOfDayIn(now, CAIRO).getTime())).toBe(true)
    })
})

describe("nothing decides a calendar question on its own clock", () => {
    // Walking the services rather than listing them: the failure this guards
    // against is a *new* site, and a hand-maintained list would not have one.
    function servicesAndRoutes(): string[] {
        const out: string[] = []
        const walk = (dir: string) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const full = join(dir, entry.name)
                if (entry.isDirectory()) walk(full)
                else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full)
            }
        }
        walk("lib/services")
        walk("app/api")
        return out
    }

    it("builds no month key from a raw Date", () => {
        // `now.getMonth() + 1` and `now.getUTCMonth() + 1` are the two
        // spellings that were in play, on two different clocks, keying the same
        // SalaryRecord rows.
        const offenders: string[] = []
        for (const file of servicesAndRoutes()) {
            const source = stripComments(readFileSync(file, "utf8"))
            if (/get(UTC)?Month\(\)\s*\+\s*1/.test(source)) offenders.push(file)
        }
        expect(offenders, `these build a month key on their own clock: ${offenders.join(", ")}`)
            .toEqual([])
    })

    it("reads no calendar year off a raw Date", () => {
        const offenders: string[] = []
        for (const file of servicesAndRoutes()) {
            const source = stripComments(readFileSync(file, "utf8"))
            // new Date(r.date).getFullYear() and friends are grouping a stored
            // instant by year, which is the same calendar question.
            if (/\.get(UTC)?FullYear\(\)/.test(source)) offenders.push(file)
        }
        expect(offenders, `these read a calendar year on their own clock: ${offenders.join(", ")}`)
            .toEqual([])
    })

    it("has deleted getEgyptNow rather than repaired it", () => {
        // Repairing it would have left the shape that caused the problem: a
        // function that hands back a Date whose instant is wrong, safe only if
        // every caller remembers to use it for one field and discard it.
        const offenders: string[] = []
        for (const file of [...servicesAndRoutes(), "lib/time.ts"]) {
            // Stripped: lib/time.ts's own docstring explains at length why that
            // helper is gone, and a guard satisfied or broken by prose about
            // itself is not a guard.
            if (/getEgyptNow/.test(stripComments(readFileSync(file, "utf8")))) offenders.push(file)
        }
        expect(offenders, `getEgyptNow is back in: ${offenders.join(", ")}`).toEqual([])
    })

    it("keeps the timezone literal in one place", () => {
        // Company gains a timezone column in P8. When it does, there must be
        // exactly one default to replace, not a scattering of them.
        const offenders: string[] = []
        for (const file of servicesAndRoutes()) {
            const source = stripComments(readFileSync(file, "utf8"))
            if (/['"]Africa\/Cairo['"]/.test(source)) offenders.push(file)
        }
        expect(offenders, `these hardcode a timezone: ${offenders.join(", ")}`).toEqual([])
    })
})
