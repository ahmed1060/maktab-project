import { describe, it, expect } from "vitest"
import { resolveSubscriptionState, needsAttention } from "./state"
import { bundleLabelKeys, isGrandfathered, SUBSCRIPTION_STYLE, TRIAL_PRESET_LABEL_KEY } from "@/lib/subscription-display"
import { TRIAL_PRESETS } from "./state"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

// Phase B renders state rather than enforcing it, so the risks are display
// risks: a label key that does not exist, a badge that treats a grandfathered
// company as a premium one, a list and a dashboard count that disagree.

describe("every label key the UI reaches for exists in both locales", () => {
    const keys = [
        ...Object.values(SUBSCRIPTION_STYLE).map(s => s.labelKey),
        ...Object.values(TRIAL_PRESET_LABEL_KEY),
        'state_grandfathered', 'bundle_company_management', 'bundle_hr', 'core_only',
        'no_package', 'package_label', 'packages', 'bundles', 'subscription_state',
        'needs_attention_filter', 'show_all_companies', 'nothing_needs_attention',
        'sort_by_date', 'sort_by_name', 'days_left', 'ended_days_ago', 'unpaid_record',
        'trial_length', 'trial_ends_on', 'never_expires', 'not_sold_as_lifetime',
        'package_edit_warning', 'package_retired', 'companies_on_package',
        'package_created_success', 'package_updated_success', 'package_deleted_success',
    ]

    for (const key of keys) {
        it(key, () => {
            expect(en, `missing "${key}" in en`).toHaveProperty(key)
            expect(ar, `missing "${key}" in ar`).toHaveProperty(key)
        })
    }

    it("covers every state and every trial preset, not just the ones in use", () => {
        expect(Object.keys(SUBSCRIPTION_STYLE).sort())
            .toEqual(['ACTIVE', 'GRACE', 'LIFETIME', 'LOCKED', 'TRIAL'])
        expect(Object.keys(TRIAL_PRESET_LABEL_KEY).sort()).toEqual([...TRIAL_PRESETS].sort())
    })

    it("the two interpolated strings keep their placeholder in both locales", () => {
        // These are rendered with .replace('{count}', …) — a translation that
        // drops the token silently loses the number.
        expect(en.package_edit_warning).toContain('{count}')
        expect(ar.package_edit_warning).toContain('{count}')
        expect(en.ended_days_ago).toContain('{days}')
        expect(ar.ended_days_ago).toContain('{days}')
    })
})

describe("grandfathered is not the same as lifetime", () => {
    it("a company with no package and no payment reads as unrestricted, not premium", () => {
        const s = resolveSubscriptionState({ createdAt: new Date("2026-01-21") }, new Date("2026-09-13"))
        expect(s.state).toBe("ACTIVE")
        expect(isGrandfathered(s.state, s.date)).toBe(true)
    })

    it("an ordinary active subscription is not grandfathered", () => {
        const s = resolveSubscriptionState(
            { createdAt: new Date("2026-01-21"), latestPaidPeriod: { endDate: new Date("2027-01-01") } },
            new Date("2026-09-13")
        )
        expect(isGrandfathered(s.state, s.date)).toBe(false)
    })

    it("lifetime is its own state and is never called grandfathered", () => {
        const s = resolveSubscriptionState(
            { createdAt: new Date("2026-01-21"), latestPaidPeriod: { endDate: null } },
            new Date("2026-09-13")
        )
        expect(s.state).toBe("LIFETIME")
        expect(isGrandfathered(s.state, s.date)).toBe(false)
    })
})

describe("bundle labels", () => {
    it("no package means no bundles listed, rather than Core claimed", () => {
        expect(bundleLabelKeys(null)).toEqual([])
        expect(bundleLabelKeys(undefined)).toEqual([])
    })

    it("a package with neither switch is Core only — an empty list the UI labels", () => {
        expect(bundleLabelKeys({ hasCompanyManagement: false, hasHR: false })).toEqual([])
    })

    it("each switch adds its own label, and both add both", () => {
        expect(bundleLabelKeys({ hasCompanyManagement: true, hasHR: false })).toEqual(['bundle_company_management'])
        expect(bundleLabelKeys({ hasCompanyManagement: false, hasHR: true })).toEqual(['bundle_hr'])
        expect(bundleLabelKeys({ hasCompanyManagement: true, hasHR: true }))
            .toEqual(['bundle_company_management', 'bundle_hr'])
    })
})

describe("the list filter and the dashboard count cannot disagree", () => {
    // Both call needsAttention over the same facts; this asserts they are the
    // same computation rather than two that happen to match today.
    const now = new Date("2026-09-13T12:00:00.000Z")
    const population = [
        { name: "ending soon", createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: new Date("2026-09-20T12:00:00Z") } },
        { name: "far off", createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: new Date("2027-01-01T12:00:00Z") } },
        { name: "in grace", createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: new Date("2026-09-12T12:00:00Z") } },
        { name: "locked", createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: new Date("2026-06-01T12:00:00Z") } },
        { name: "lifetime", createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: null } },
        { name: "trial ending", createdAt: new Date("2026-09-10T12:00:00Z"), trialPreset: "SEVEN_DAYS" as const },
        { name: "long trial", createdAt: new Date("2026-09-10T12:00:00Z"), trialPreset: "THREE_MONTHS" as const },
        { name: "grandfathered", createdAt: new Date("2026-01-01") },
        { name: "unpaid record", createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: new Date("2027-01-01T12:00:00Z") }, hasUnpaidPayment: true },
    ]

    it("flags exactly the companies that deserve it", () => {
        const flagged = population.filter(c => needsAttention(c, now)).map(c => c.name)
        expect(flagged.sort()).toEqual(
            ["ending soon", "in grace", "locked", "trial ending", "unpaid record"].sort()
        )
    })

    it("the tile's count equals the filtered list's length, by construction", () => {
        const listed = population.filter(c => needsAttention(c, now))
        const counted = population.filter(c => needsAttention(c, now)).length
        expect(counted).toBe(listed.length)
    })

    it("a trial ending soon is counted — the gap the old PAID-only query left", () => {
        expect(needsAttention(population.find(c => c.name === "trial ending")!, now)).toBe(true)
    })
})

describe("what this screen will actually show on the day it ships", () => {
    // The four live companies, exactly as production holds them: no package, no
    // trial preset, one confirmed period each, no unpaid records. Pinned so the
    // first thing seen after deploy is a prediction rather than a surprise.
    const live = [
        { name: "CuraTech", createdAt: new Date("2026-09-07T19:07:50Z"), latestPaidPeriod: { endDate: new Date("2027-09-08T08:57:08Z") } },
        { name: "CuraTech Demo", createdAt: new Date("2026-09-08T16:20:56Z"), latestPaidPeriod: { endDate: new Date("2027-09-08T16:21:31Z") } },
        { name: "QA Sandbox", createdAt: new Date("2026-09-05T09:08:57Z"), latestPaidPeriod: { endDate: new Date("2027-09-08T08:58:04Z") } },
        { name: "Software Testing", createdAt: new Date("2026-01-21T04:58:03Z"), latestPaidPeriod: { endDate: new Date("2026-10-08T08:57:51Z") } },
    ]
    const now = new Date("2026-09-13T12:00:00.000Z")

    it("every live company reads ACTIVE, and none is grandfathered", () => {
        for (const company of live) {
            const status = resolveSubscriptionState(company, now)
            expect(status.state, company.name).toBe("ACTIVE")
            expect(isGrandfathered(status.state, status.date), company.name).toBe(false)
        }
    })

    it("nothing needs attention today, so the default filter shows the empty state", () => {
        expect(live.filter(c => needsAttention(c, now))).toHaveLength(0)
    })

    it("Software Testing joins the list on 2026-09-24, the day it enters the window", () => {
        // The same date the reminder ladder's first rung fires — one threshold,
        // and this is what it means on the screen.
        const softwareTesting = live.find(c => c.name === "Software Testing")!
        expect(needsAttention(softwareTesting, new Date("2026-09-23T12:00:00Z"))).toBe(false)
        expect(needsAttention(softwareTesting, new Date("2026-09-24T12:00:00Z"))).toBe(true)
    })
})

describe("sorting by date puts the soonest first and the dateless last", () => {
    const now = new Date("2026-09-13T12:00:00.000Z")
    const rows = [
        { name: "lifetime", facts: { createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: null } } },
        { name: "october", facts: { createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: new Date("2026-10-08T12:00:00Z") } } },
        { name: "grandfathered", facts: { createdAt: new Date("2026-01-01") } },
        { name: "next week", facts: { createdAt: new Date("2026-01-01"), latestPaidPeriod: { endDate: new Date("2026-09-20T12:00:00Z") } } },
    ]

    it("orders soonest-first, with no-date rows at the end rather than the top", () => {
        // A missing date must not sort as zero — that would put lifetime
        // customers at the top of a list of things about to expire.
        const sorted = [...rows].sort((a, b) => {
            const ad = resolveSubscriptionState(a.facts, now).date?.getTime()
            const bd = resolveSubscriptionState(b.facts, now).date?.getTime()
            if (ad === undefined && bd === undefined) return a.name.localeCompare(b.name)
            if (ad === undefined) return 1
            if (bd === undefined) return -1
            return ad - bd
        })
        expect(sorted.map(r => r.name)).toEqual(["next week", "october", "grandfathered", "lifetime"])
    })
})
