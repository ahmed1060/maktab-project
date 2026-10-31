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

    // Codex on #79: an allowance lowered below what's already used this year
    // leaves the credit below 0 (user.service.ts), which gave −100% and 200%.
    it("has none left, not less than none, when more was used than the allowance now gives", () => {
        const html = donut({ remaining: -5, used: 10 })
        expect(html).toContain('<span class="ui-donut-label">Remaining credit</span> <span class="ui-donut-count">0 days</span> <span class="ui-donut-share">0%</span>')
        expect(html).toContain('<span class="ui-donut-label">Used credit</span> <span class="ui-donut-count">10 days</span> <span class="ui-donut-share">100%</span>')
        expect(html).toContain("<strong>10 days</strong>")
        expect(html).not.toMatch(/(ui-donut-count|ui-donut-share)">[-−]|<strong>[-−]/)
    })

    it("links its rows only where it's asked to", () => {
        expect(donut()).not.toContain("<a ")
        expect(donut({ href: "/dashboard/day-off-requests" })).toContain('<a class="ui-donut-row" href="/dashboard/day-off-requests">')
    })

    it("says it's loading, not that there's nothing, until the credit arrives", () => {
        expect(donut({ remaining: 0, used: 0, loading: true })).toContain('<p class="ui-donut-empty">Loading…</p>')
        expect(donut({ remaining: 0, used: 0 })).toContain('<p class="ui-donut-empty">No data available</p>')
        // Nothing in the middle until then: a 0 there would read as the answer.
        expect(donut({ remaining: 0, used: 0, loading: true })).not.toContain("ui-donut-total")
        expect(donut({ remaining: 0, used: 0 })).toContain("<strong>0 days</strong>")
    })

    // Codex on #79: when the request failed, it said "Loading…" for good.
    it("says the credit didn't load, with Try again, rather than loading for good", () => {
        // SWR is loading again while it retries, but the request has failed.
        const html = donut({ remaining: 0, used: 0, loading: true, failed: true, onRetry: () => {} })
        expect(html).not.toContain("Loading…")
        expect(html).not.toContain("ui-donut-total")
        expect(html).toContain('<p class="ui-donut-empty">Your day off credit didn&#x27;t load. <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">Try again</button></p>')
        // While it tries again, the button says so.
        expect(donut({ remaining: 0, used: 0, failed: true, onRetry: () => {}, retrying: true })).toContain('aria-busy="true">Try again</button>')
        expect(donut({ t: tAr as any, locale: "ar", remaining: 0, used: 0, failed: true, onRetry: () => {} }))
            .toContain("تعذّر تحميل رصيد إجازاتك. <button")
    })

    it("on the Requests page's Mine, comes with the page, read on the server, so it never loads or fails on its own (UI_PLAN.md §2.3, part 2d)", () => {
        const server = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")
        expect(server).toContain("prisma.user.findUnique({ where: { id: viewer.id }, select: { dayOffCredit: true, baseDayOffCredit: true } })")
        const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(client).not.toContain("useSWR")
    })

    it("is the one the dashboard home and the Requests page's Mine both show", () => {
        const dashboard = readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
        const requests = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(dashboard).toContain('<DayOffCreditDonut remaining={remainingCredit} used={usedCredits} t={t} locale={locale} href="/dashboard/requests?tab=mine&kind=dayOff" />')
        expect(requests).toContain("<DayOffCreditDonut remaining={credit.remaining} used={credit.used} t={t} locale={locale} />")
        // Two tiles saying the same as the donut are gone.
        expect(requests).not.toContain("TotalTiles")
    })
})
