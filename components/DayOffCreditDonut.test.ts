import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DayOffCreditDonut } from "./DayOffCreditDonut"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * Someone's day off credit as a donut, the same on the dashboard home and on
 * the Day Off page (UI_PLAN.md change log, 2026-10-15).
 */

const tEn = (k: string) => (en as Record<string, string>)[k] ?? k
const tAr = (k: string) => (ar as Record<string, string>)[k] ?? k
const donut = (props: Partial<Parameters<typeof DayOffCreditDonut>[0]> = {}) =>
    renderToStaticMarkup(h(DayOffCreditDonut, { remaining: 18, used: 3, t: tEn as any, locale: "en", ...props }))

describe("the day off credit donut", () => {
    it("shows what's left and what's used, in days and as shares, with the year's total in the middle", () => {
        const html = donut()
        expect(html).toContain('aria-label="Day off credit"')
        expect(html).toContain('<span class="ui-donut-label">Remaining credit</span> <span class="ui-donut-count">18 days</span> <span class="ui-donut-share">86%</span>')
        expect(html).toContain('<span class="ui-donut-label">Used credit</span> <span class="ui-donut-count">3 days</span> <span class="ui-donut-share">14%</span>')
        expect(html).toContain("<strong>21 days</strong>")
        // What's left is good news; what's used is neither.
        expect(html).toMatch(/class="ui-donut-arc" data-tone="good"/)
        expect(html).toMatch(/class="ui-donut-arc" data-tone="neutral"/)
    })

    it("in Arabic, with its plural forms and digits", () => {
        const html = donut({ t: tAr as any, locale: "ar", remaining: 2, used: 1 })
        expect(html).toContain('<span class="ui-donut-count">يومان</span>')
        expect(html).toContain('<span class="ui-donut-count">يوم واحد</span>')
        expect(html).toContain("<strong>٣ أيام</strong>")
    })

    it("links its rows only where it's asked to", () => {
        expect(donut()).not.toContain("<a ")
        expect(donut({ href: "/dashboard/day-off-requests" })).toContain('<a class="ui-donut-row" href="/dashboard/day-off-requests">')
    })

    it("says it's loading, not that there's nothing, until the credit arrives", () => {
        expect(donut({ remaining: 0, used: 0, loading: true })).toContain('<p class="ui-donut-empty">Loading…</p>')
        expect(donut({ remaining: 0, used: 0 })).toContain('<p class="ui-donut-empty">No data available</p>')
    })

    it("is the one the dashboard home and the Day Off page both show", () => {
        const dashboard = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
        const dayOff = readFileSync("app/(dashboard)/dashboard/day-off-requests/page.tsx", "utf8")
        expect(dashboard).toContain('<DayOffCreditDonut remaining={remainingCredit} used={usedCredits} t={t} locale={locale} href="/dashboard/day-off-requests" />')
        expect(dayOff).toContain("<DayOffCreditDonut remaining={userCredit} used={usedByCredit} t={t} locale={locale} loading={!foundUser} />")
        // The Day Off page's two tiles are gone: the donut says the same.
        expect(dayOff).not.toContain("TotalTiles")
    })
})
