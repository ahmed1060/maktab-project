import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    checkTimeZone, isSupportedTimeZone, assertSupportedTimeZone, resolveTimeZone,
    isKnownTimeZone, minOffsetMinutes, MIN_OFFSET_MINUTES, SALARY_INIT_UTC_HOUR,
} from "./timezone"
import { DEFAULT_TIME_ZONE } from "./time"

describe("the bound comes from the schedule, not from a guess", () => {
    it("matches the hour salary initialisation actually runs at", () => {
        // The guard that keeps the two in step. If somebody moves the cron, the
        // set of serviceable zones has to move with it — and a constant that has
        // silently stopped describing the thing it names is worse than none.
        const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }
        const salaryInit = vercel.crons.find(c => c.path === "/api/cron/salary-init")
        expect(salaryInit, "salary-init is no longer scheduled").toBeDefined()

        const hour = Number(salaryInit!.schedule.split(" ")[1])
        expect(hour, "SALARY_INIT_UTC_HOUR no longer matches vercel.json").toBe(SALARY_INIT_UTC_HOUR)
        expect(MIN_OFFSET_MINUTES).toBe(-hour * 60)
    })
})

describe("zones this system can serve", () => {
    it("accepts the ones the schedule actually covers", () => {
        for (const zone of ["Africa/Cairo", "UTC", "Europe/London", "Asia/Dubai", "Asia/Tokyo", "Europe/Lisbon"]) {
            expect(isSupportedTimeZone(zone), zone).toBe(true)
        }
    })

    it("refuses the Americas, and says why", () => {
        // Not arbitrary strictness: salary-init fires once for every company at
        // 02:00 UTC on the 1st, which is still the previous month in New York.
        // The job would create next month's record while that customer is
        // living in this one.
        const verdict = checkTimeZone("America/New_York")
        expect(verdict.ok).toBe(false)
        expect(verdict.reason).toMatch(/further behind UTC/)
        expect(verdict.reason).toMatch(/zone-aware/)
    })

    it("refuses a name no timezone database knows", () => {
        expect(isKnownTimeZone("Mars/Olympus")).toBe(false)
        expect(checkTimeZone("Mars/Olympus").reason).toMatch(/not a time zone/)
        expect(isKnownTimeZone("")).toBe(false)
        expect(isKnownTimeZone(undefined as any)).toBe(false)
    })

    it("throws with the reason where a caller has nowhere to put a verdict", () => {
        expect(() => assertSupportedTimeZone("America/Sao_Paulo")).toThrow(/further behind UTC/)
        expect(() => assertSupportedTimeZone("Africa/Cairo")).not.toThrow()
    })
})

describe("daylight saving is checked across the year, not just today", () => {
    it("samples both solstices", () => {
        // Cairo reintroduced daylight saving in 2023: +02:00 in winter, +03:00
        // in summer. The minimum is the winter one.
        expect(minOffsetMinutes("Africa/Cairo", 2026)).toBe(120)
    })

    it("judges a borderline zone on its worst offset, not its best", () => {
        // The failure this prevents: a company accepted in January that becomes
        // unserviceable in June, six months after the decision that caused it.
        // Azores is -01:00 in winter and +00:00 in summer, so its minimum is the
        // one that has to clear the bound.
        expect(minOffsetMinutes("Atlantic/Azores", 2026)).toBe(-60)
        expect(isSupportedTimeZone("Atlantic/Azores")).toBe(true)
        // South Georgia sits at -02:00 all year — exactly on the bound.
        expect(minOffsetMinutes("Atlantic/South_Georgia", 2026)).toBe(-120)
        expect(isSupportedTimeZone("Atlantic/South_Georgia")).toBe(true)
    })
})

describe("resolving the zone to use", () => {
    it("prefers the company's own", () => {
        expect(resolveTimeZone("Asia/Dubai", "Europe/London")).toBe("Asia/Dubai")
    })

    it("falls back to the platform default for somebody with no company", () => {
        // A Super Admin's companyId is null, and they still need to know what
        // month it is.
        expect(resolveTimeZone(null, "Europe/London")).toBe("Europe/London")
        expect(resolveTimeZone(undefined, "Europe/London")).toBe("Europe/London")
    })

    it("falls back to the constant when neither is set", () => {
        expect(resolveTimeZone(null, null)).toBe(DEFAULT_TIME_ZONE)
    })

    it("falls back rather than throwing on a value that should not be there", () => {
        // A bad setting must not take down every page that needs to know what
        // month it is. It is refused at the moment somebody sets it; by the
        // time anything reads it, falling back is the kinder failure.
        expect(resolveTimeZone("America/New_York", "Europe/London")).toBe("Europe/London")
        expect(resolveTimeZone("Mars/Olympus", null)).toBe(DEFAULT_TIME_ZONE)
    })
})
