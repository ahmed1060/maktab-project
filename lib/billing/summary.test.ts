import { describe, it, expect } from "vitest"
import { summarizeSubscription } from "./summary"

/**
 * The days to a subscription's last day, for the note above the page
 * (DESIGN.md §5.5): on Egypt's calendar, as subscriptions are counted, and
 * by the server, which has the right time. The count it had rounds hours up
 * from the date's time of day, so a trial said "0 day(s) left" all through
 * its last day, and a day more or less than another trial ending the same
 * day.
 */

// Created at 06:00 UTC: its trial's date is 6 November, 08:00 in Cairo, and
// it lasts to the end of that day there (lib/billing/state.ts).
const trial = { createdAt: new Date("2026-10-23T06:00:00Z"), trialPreset: "FOURTEEN_DAYS", trialExtensionDays: 0, payments: [] }
const at = (iso: string) => summarizeSubscription(trial, new Date(iso))!

describe("the days to a subscription's last day", () => {
    it("counts a trial's on Egypt's calendar, 0 on its last day", () => {
        expect(at("2026-11-01T10:00:00Z")).toMatchObject({ state: "TRIAL", daysToLastDay: 5 })
        // 23:30 in Cairo on the 5th: its last day is tomorrow.
        expect(at("2026-11-05T21:30:00Z")).toMatchObject({ state: "TRIAL", daysToLastDay: 1 })
        // 00:30 in Cairo on the 6th: it's the last day, while the hours left still round up to one.
        expect(at("2026-11-05T22:30:00Z")).toMatchObject({ state: "TRIAL", daysToLastDay: 0, daysRemaining: 1 })
        // 09:00 in Cairo on the 6th: still a trial until that day ends, which the hours called 0 days left.
        const lastDay = at("2026-11-06T07:00:00Z")
        expect(lastDay).toMatchObject({ state: "TRIAL", daysToLastDay: 0 })
        expect(lastDay.daysRemaining! <= 0).toBe(true)
    })

    it("counts grace's to the last day of access", () => {
        // Paid to 3 November: access lasts to the end of that day in Cairo, and grace 48 hours on, to the end of the 5th.
        const lapsed = { ...trial, payments: [{ endDate: new Date("2026-11-03T00:00:00Z"), graceExtensionHours: 0 }] }
        expect(summarizeSubscription(lapsed, new Date("2026-11-04T10:00:00Z"))).toMatchObject({ state: "GRACE", daysToLastDay: 1 })
        expect(summarizeSubscription(lapsed, new Date("2026-11-05T20:00:00Z"))).toMatchObject({ state: "GRACE", daysToLastDay: 0 })
    })

    it("has none where there's no date", () => {
        const lifetime = { ...trial, payments: [{ endDate: null, graceExtensionHours: null }] }
        expect(summarizeSubscription(lifetime, new Date("2026-11-04T10:00:00Z"))).toMatchObject({ state: "LIFETIME", daysToLastDay: null })
        const grandfathered = { ...trial, trialPreset: null }
        expect(summarizeSubscription(grandfathered, new Date("2026-11-04T10:00:00Z"))).toMatchObject({ state: "ACTIVE", daysToLastDay: null })
    })
})
