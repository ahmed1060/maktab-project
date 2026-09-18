import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
    checkTimeZone, isSupportedTimeZone, assertSupportedTimeZone, resolveTimeZone,
    isKnownTimeZone, minOffsetMinutes,
} from "./timezone"
import { DEFAULT_TIME_ZONE } from "./time"

describe("the daily schedule is what makes any zone work", () => {
    it("runs salary initialisation every day, not on the 1st", () => {
        // This is now load-bearing and not a matter of taste. The job asks each
        // company what month it is in that company's own calendar — but a
        // monthly cron pinned to the 1st in UTC gets exactly one chance to
        // catch a calendar it does not share, and for anywhere behind UTC it
        // fires while that company is still in the previous month and then does
        // not run again until the month after.
        //
        // Reverting this to a monthly schedule silently re-breaks every zone
        // west of here, which is precisely the kind of change nothing else
        // would fail on.
        const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] }
        const salaryInit = vercel.crons.find(c => c.path === "/api/cron/salary-init")
        expect(salaryInit, "salary-init is no longer scheduled").toBeDefined()

        const [, , dayOfMonth, month, dayOfWeek] = salaryInit!.schedule.split(" ")
        expect([dayOfMonth, month, dayOfWeek], `salary-init must run daily, got "${salaryInit!.schedule}"`)
            .toEqual(["*", "*", "*"])
    })

    it("and every run is an upsert, so the other 29 change nothing", () => {
        // Daily only works because re-running is free. If ensureRecordExists
        // stopped being an upsert this would write a new row every night.
        const service = readFileSync("lib/services/salary.service.ts", "utf8")
        const ensure = service.slice(service.indexOf("static async ensureRecordExists"))
        expect(ensure).toContain("salaryRecord.upsert")
        expect(ensure).toContain("update: {}")
    })
})

describe("the month is asked per company, not once for everybody", () => {
    const CRON = readFileSync("lib/services/cron.service.ts", "utf8")

    it("resolves a calendar for each company", () => {
        expect(CRON).toContain("resolveTimeZone(c.timezone, platformZone)")
        expect(CRON).toContain("calendarMonth(now, timeZone)")
    })

    it("never asks the question once and applies the answer to everyone", () => {
        // The original bug in one line: calendarMonth(now) with no zone, hoisted
        // above the loop over every employee in every company.
        const init = CRON.slice(CRON.indexOf("static async initializeSalaries"))
        expect(init).not.toMatch(/calendarMonth\(now\)/)
    })

    it("still gives somebody with no company a calendar", () => {
        expect(CRON).toContain("const fallbackZone = resolveTimeZone(null, platformZone)")
    })

    it("and the gap-filler asks the same question the same way", () => {
        // ensureRecordsThrough builds every month from the first record up to
        // "now", so a zone-blind "now" either leaves a hole at the end or
        // invents a row a month early — the same fault as the cron's, in the
        // path a person triggers rather than a schedule.
        const salary = readFileSync("lib/services/salary.service.ts", "utf8")
        const through = salary.slice(salary.indexOf("static async ensureRecordsThrough"))
        expect(through).toContain("calendarMonth(new Date(), await this.zoneFor(userId))")
        expect(through.slice(0, through.indexOf("const existingRecords"))).not.toMatch(/calendarMonth\(new Date\(\)\)/)
        // Resolved the same way as everywhere else, not re-improvised here.
        expect(salary).toContain("return resolveTimeZone(user?.company?.timezone, settings?.defaultTimezone)")
    })
})

describe("zones this system can serve", () => {
    it("accepts every real zone, including the ones it used to refuse", () => {
        for (const zone of [
            "Africa/Cairo", "UTC", "Europe/London", "Asia/Dubai", "Asia/Tokyo", "Europe/Lisbon",
            // The whole point of G7. These were refused at onboarding because
            // the cron could not serve them; now it can.
            "America/New_York", "America/Sao_Paulo", "America/Los_Angeles", "Pacific/Honolulu",
        ]) {
            expect(isSupportedTimeZone(zone), zone).toBe(true)
        }
    })

    it("no longer explains a limitation that has been removed", () => {
        // Leaving the apology standing after the thing it apologised for is
        // gone is how a codebase teaches people the wrong rule.
        const verdict = checkTimeZone("America/New_York")
        expect(verdict.ok).toBe(true)
        expect(verdict.reason).toBeUndefined()
    })

    it("refuses a name no timezone database knows", () => {
        expect(isKnownTimeZone("Mars/Olympus")).toBe(false)
        expect(checkTimeZone("Mars/Olympus").reason).toMatch(/not a time zone/)
        expect(isKnownTimeZone("")).toBe(false)
        expect(isKnownTimeZone(undefined as any)).toBe(false)
    })

    it("throws with the reason where a caller has nowhere to put a verdict", () => {
        expect(() => assertSupportedTimeZone("Mars/Olympus")).toThrow(/not a time zone/)
        expect(() => assertSupportedTimeZone("America/New_York")).not.toThrow()
        expect(() => assertSupportedTimeZone("Africa/Cairo")).not.toThrow()
    })
})

describe("daylight saving is checked across the year, not just today", () => {
    it("samples both solstices", () => {
        // Cairo reintroduced daylight saving in 2023: +02:00 in winter, +03:00
        // in summer. The minimum is the winter one.
        expect(minOffsetMinutes("Africa/Cairo", 2026)).toBe(120)
    })

    it("still reports the worst offset, which nothing judges on any more", () => {
        // Kept because it is the honest answer to "how far from UTC is this
        // company", and because sampling one date would have been wrong even
        // when it did decide something.
        expect(minOffsetMinutes("Atlantic/Azores", 2026)).toBe(-60)
        expect(minOffsetMinutes("Atlantic/South_Georgia", 2026)).toBe(-120)
        expect(minOffsetMinutes("America/New_York", 2026)).toBe(-300)
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
        expect(resolveTimeZone("Mars/Olympus", null)).toBe(DEFAULT_TIME_ZONE)
        expect(resolveTimeZone("", "Europe/London")).toBe("Europe/London")
        // And a real zone is now used rather than fallen back from.
        expect(resolveTimeZone("America/New_York", "Europe/London")).toBe("America/New_York")
    })
})
