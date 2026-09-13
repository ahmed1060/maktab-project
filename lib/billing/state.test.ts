import { describe, it, expect } from "vitest"
import {
    resolveSubscriptionState, computeTrialEnd, computeGraceEnd, needsAttention,
    applyTrialPreset, TRIAL_PRESETS, DEFAULT_TRIAL_PRESET, DEFAULT_GRACE_HOURS, ENDING_SOON_DAYS,
    type SubscriptionFacts,
} from "./state"

const d = (s: string) => new Date(s + "T12:00:00.000Z")
const iso = (x: Date | null) => (x === null ? null : x.toISOString().slice(0, 10))
const NOW = d("2026-09-13")

const facts = (over: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
    createdAt: d("2026-09-01"),
    ...over,
})

describe("trial end", () => {
    it("each preset lands where its name says", () => {
        const start = d("2026-09-13")
        expect(iso(applyTrialPreset(start, "TWO_DAYS"))).toBe("2026-09-15")
        expect(iso(applyTrialPreset(start, "SEVEN_DAYS"))).toBe("2026-09-20")
        expect(iso(applyTrialPreset(start, "FOURTEEN_DAYS"))).toBe("2026-09-27")
        expect(iso(applyTrialPreset(start, "ONE_MONTH"))).toBe("2026-10-13")
        expect(iso(applyTrialPreset(start, "THREE_MONTHS"))).toBe("2026-12-13")
    })

    it("a month is a calendar month and clamps — 31 January + 1 month is 28 February", () => {
        // Not 30 days, and not 2 March. This is the surprise the creation form's
        // live preview exists to make visible.
        expect(iso(applyTrialPreset(d("2026-01-31"), "ONE_MONTH"))).toBe("2026-02-28")
        expect(iso(applyTrialPreset(d("2026-11-30"), "THREE_MONTHS"))).toBe("2027-02-28")
    })

    it("extensions are added on top of whichever preset was chosen", () => {
        expect(iso(computeTrialEnd(d("2026-09-13"), "FOURTEEN_DAYS", 7))).toBe("2026-10-04")
        expect(iso(computeTrialEnd(d("2026-01-31"), "ONE_MONTH", 3))).toBe("2026-03-03")
    })

    it("no preset means no trial, not a trial of zero length", () => {
        expect(computeTrialEnd(d("2026-09-13"), null)).toBeNull()
        expect(computeTrialEnd(d("2026-09-13"), undefined, 30)).toBeNull()
    })

    it("the default preset is one of the offered five", () => {
        expect(TRIAL_PRESETS).toContain(DEFAULT_TRIAL_PRESET)
        expect(DEFAULT_TRIAL_PRESET).toBe("FOURTEEN_DAYS")
    })
})

describe("grace end", () => {
    it("is 48 hours after the period ended", () => {
        expect(computeGraceEnd(d("2026-09-10"))!.toISOString()).toBe("2026-09-12T12:00:00.000Z")
        expect(DEFAULT_GRACE_HOURS).toBe(48)
    })

    it("an extension is added on top of the standard window", () => {
        expect(computeGraceEnd(d("2026-09-10"), 24)!.toISOString()).toBe("2026-09-13T12:00:00.000Z")
    })

    it("a lifetime subscription never ends, so grace never starts", () => {
        expect(computeGraceEnd(null)).toBeNull()
    })
})

describe("state resolution", () => {
    it("ACTIVE while the paid period runs", () => {
        const s = resolveSubscriptionState(facts({ latestPaidPeriod: { endDate: d("2026-10-08") } }), NOW)
        expect(s.state).toBe("ACTIVE")
        expect(iso(s.date)).toBe("2026-10-08")
        expect(s.daysRemaining).toBe(25)
    })

    it("LIFETIME when the period has no end date — never expired", () => {
        // The landmine: comparing null as a date reports 1970 and would lock out
        // the customers who paid the most.
        const s = resolveSubscriptionState(facts({ latestPaidPeriod: { endDate: null } }), NOW)
        expect(s.state).toBe("LIFETIME")
        expect(s.date).toBeNull()
        expect(s.daysRemaining).toBeNull()
    })

    it("a lifetime subscription stays LIFETIME a century later", () => {
        const s = resolveSubscriptionState(facts({ latestPaidPeriod: { endDate: null } }), d("2126-09-13"))
        expect(s.state).toBe("LIFETIME")
    })

    it("GRACE once the period has passed but the window has not", () => {
        const s = resolveSubscriptionState(facts({ latestPaidPeriod: { endDate: d("2026-09-12") } }), NOW)
        expect(s.state).toBe("GRACE")
        expect(s.date!.toISOString()).toBe("2026-09-14T12:00:00.000Z")
    })

    it("LOCKED once grace has run out, showing when it locked", () => {
        const s = resolveSubscriptionState(facts({ latestPaidPeriod: { endDate: d("2026-09-01") } }), NOW)
        expect(s.state).toBe("LOCKED")
        expect(s.date!.toISOString()).toBe("2026-09-03T12:00:00.000Z")
        expect(s.daysRemaining).toBeLessThan(0)
    })

    it("a grace extension holds GRACE open that would otherwise be LOCKED", () => {
        const ended = { endDate: d("2026-09-10"), graceExtensionHours: 96 }
        expect(resolveSubscriptionState(facts({ latestPaidPeriod: ended }), NOW).state).toBe("GRACE")
        expect(resolveSubscriptionState(facts({ latestPaidPeriod: { endDate: d("2026-09-10") } }), NOW).state).toBe("LOCKED")
    })

    it("the exact instant of expiry is not yet grace-free — it is GRACE", () => {
        const s = resolveSubscriptionState(facts({ latestPaidPeriod: { endDate: NOW } }), NOW)
        expect(s.state).toBe("GRACE")
    })

    it("TRIAL while the trial runs", () => {
        const s = resolveSubscriptionState(facts({ createdAt: d("2026-09-10"), trialPreset: "FOURTEEN_DAYS" }), NOW)
        expect(s.state).toBe("TRIAL")
        expect(iso(s.date)).toBe("2026-09-24")
    })

    it("LOCKED when a trial ran out with no payment — no grace on a trial", () => {
        const s = resolveSubscriptionState(facts({ createdAt: d("2026-08-01"), trialPreset: "SEVEN_DAYS" }), NOW)
        expect(s.state).toBe("LOCKED")
        expect(iso(s.date)).toBe("2026-08-08")
    })

    it("a trial extension can rescue a trial that would have locked", () => {
        const base = { createdAt: d("2026-09-01"), trialPreset: "SEVEN_DAYS" as const }
        expect(resolveSubscriptionState(facts(base), NOW).state).toBe("LOCKED")
        expect(resolveSubscriptionState(facts({ ...base, trialExtensionDays: 30 }), NOW).state).toBe("TRIAL")
    })

    it("a payment always wins over a trial, even an expired trial", () => {
        const s = resolveSubscriptionState(facts({
            createdAt: d("2026-01-01"),
            trialPreset: "SEVEN_DAYS",          // long since over
            latestPaidPeriod: { endDate: d("2027-01-01") },
        }), NOW)
        expect(s.state).toBe("ACTIVE")
    })

    it("a grandfathered company — no payment, no trial — is ACTIVE, never LOCKED", () => {
        // All four production companies predate this feature. Locking one
        // because a column is null would be the worst failure here.
        const s = resolveSubscriptionState(facts({ createdAt: d("2026-01-21") }), NOW)
        expect(s.state).toBe("ACTIVE")
        expect(s.date).toBeNull()
    })

    it("resolves every production company as ACTIVE on the day this ships", () => {
        // The four live companies: each has exactly one paid period, all future.
        const live = [
            { createdAt: d("2026-01-21"), endDate: d("2026-10-08") },
            { createdAt: d("2026-09-05"), endDate: d("2027-09-08") },
            { createdAt: d("2026-09-07"), endDate: d("2027-09-08") },
            { createdAt: d("2026-09-08"), endDate: d("2027-09-08") },
        ]
        for (const c of live) {
            expect(resolveSubscriptionState(
                { createdAt: c.createdAt, latestPaidPeriod: { endDate: c.endDate } }, NOW
            ).state).toBe("ACTIVE")
        }
    })

    it("never invents a date for a state that has none, and always has one otherwise", () => {
        const cases: SubscriptionFacts[] = [
            facts({ latestPaidPeriod: { endDate: d("2027-01-01") } }),
            facts({ latestPaidPeriod: { endDate: null } }),
            facts({ latestPaidPeriod: { endDate: d("2026-09-12") } }),
            facts({ latestPaidPeriod: { endDate: d("2026-01-01") } }),
            facts({ createdAt: d("2026-09-12"), trialPreset: "SEVEN_DAYS" }),
            facts({}),
        ]
        for (const f of cases) {
            const s = resolveSubscriptionState(f, NOW)
            const hasDate = s.date !== null
            expect(hasDate).toBe(s.state !== "LIFETIME" && !(s.state === "ACTIVE" && !f.latestPaidPeriod))
            expect(hasDate).toBe(s.daysRemaining !== null)
        }
    })
})

describe("needsAttention — one rule, three surfaces", () => {
    it("an unpaid payment record always qualifies, whatever the state", () => {
        expect(needsAttention(facts({
            latestPaidPeriod: { endDate: d("2030-01-01") },
            hasUnpaidPayment: true,
        }), NOW)).toBe(true)
    })

    it("locked and grace qualify", () => {
        expect(needsAttention(facts({ latestPaidPeriod: { endDate: d("2026-01-01") } }), NOW)).toBe(true)
        expect(needsAttention(facts({ latestPaidPeriod: { endDate: d("2026-09-12") } }), NOW)).toBe(true)
    })

    it("a paid subscription ending inside the window qualifies; outside it does not", () => {
        const inside = facts({ latestPaidPeriod: { endDate: d("2026-09-24") } }) // 11 days
        const outside = facts({ latestPaidPeriod: { endDate: d("2026-10-08") } }) // 25 days
        expect(needsAttention(inside, NOW)).toBe(true)
        expect(needsAttention(outside, NOW)).toBe(false)
    })

    it("a trial ending inside the window qualifies — the gap the old count missed", () => {
        // The existing dashboard query required a PAID row, so a trial running
        // out next week appeared nowhere.
        const trial = facts({ createdAt: d("2026-09-10"), trialPreset: "SEVEN_DAYS" })
        expect(needsAttention(trial, NOW)).toBe(true)
    })

    it("a three-month trial with months to run does not qualify", () => {
        expect(needsAttention(facts({ createdAt: d("2026-09-10"), trialPreset: "THREE_MONTHS" }), NOW)).toBe(false)
    })

    it("a lifetime subscription never qualifies on time", () => {
        expect(needsAttention(facts({ latestPaidPeriod: { endDate: null } }), NOW)).toBe(false)
    })

    it("but a lifetime subscription with an unpaid record still does", () => {
        expect(needsAttention(facts({ latestPaidPeriod: { endDate: null }, hasUnpaidPayment: true }), NOW)).toBe(true)
    })

    it("a grandfathered company does not qualify on time alone", () => {
        expect(needsAttention(facts({}), NOW)).toBe(false)
    })

    it("the boundary is inclusive at exactly the threshold", () => {
        const atThreshold = facts({ latestPaidPeriod: { endDate: d("2026-09-27") } })
        expect(resolveSubscriptionState(atThreshold, NOW).daysRemaining).toBe(ENDING_SOON_DAYS)
        expect(needsAttention(atThreshold, NOW)).toBe(true)
    })

    it("uses the same threshold the reminder ladder starts at", async () => {
        const { REMINDER_RUNGS } = await import("./reminders")
        expect(Math.max(...REMINDER_RUNGS)).toBe(ENDING_SOON_DAYS)
    })
})
