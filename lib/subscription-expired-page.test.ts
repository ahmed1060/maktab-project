import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A company whose subscription has ended, on the building blocks (UI_PLAN.md
 * §5 step 5, the pages left; DESIGN.md §5.5): a glass card under an
 * hourglass emoji, the day it locked in red, on the reader's own calendar.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const SOURCE = "components/SubscriptionExpired.tsx"
let SubscriptionExpired: (props: { lockedOn: string | null }) => ReactElement
beforeAll(async () => { SubscriptionExpired = (await import("@/components/SubscriptionExpired")).default })
beforeEach(() => { state.locale = "en" })
const render = (lockedOn: string | null) => renderToStaticMarkup(h(SubscriptionExpired, { lockedOn }))
/** As React writes text into the page. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const words = (locale: "en" | "ar") => (locale === "ar" ? ar : en)

// Half past midnight on 6 November in Cairo, still the 5th in UTC: access
// was paused on the 6th, as subscriptions are counted (lib/billing/state.ts).
const LOCKED = "2026-11-05T22:30:00.000Z"

describe("A company whose subscription has ended", () => {
    it("has nothing left of its own making: no inline styles, emoji or glass card", () => {
        const src = readFileSync(SOURCE, "utf8")
        expect(src).not.toMatch(/style=\{/)
        expect(src).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(src).not.toContain("glass-card")
        expect(src).not.toMatch(/ as any\)/)
        expect(src).toMatch(/from ['"]@\/components\/ui['"]/)
    })

    it("says so in its page header, with the day access was paused, in the page's language and digits", () => {
        const html = render(LOCKED)
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.subscription_expired_title)}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.subscription_expired_paused.replace("{date}", "6 Nov 2026"))} ${esc(en.subscription_expired_renew)}</p>`)
        state.locale = "ar"
        const arabic = render(LOCKED)
        expect(arabic).toContain(`<h1 class="ui-page-title">${esc(ar.subscription_expired_title)}</h1>`)
        expect(arabic).toContain(esc(ar.subscription_expired_paused.replace("{date}", "٦ نوفمبر ٢٠٢٦")))
        // Its words, that is: the check's drawing has figures of its own.
        expect(arabic.replace(/<[^>]*>/g, "")).not.toMatch(/[0-9]/)
    })

    it("without a day, says only what renewing it does", () => {
        expect(render(null)).toContain(`<p class="ui-page-subtitle">${esc(en.subscription_expired_renew)}</p>`)
    })

    it("says first, under the header, that nothing was deleted, with a check in the Good colour", () => {
        for (const locale of ["en", "ar"] as const) {
            state.locale = locale
            const html = render(LOCKED)
            const card = html.match(/<\/header>\s*<section class="ui-panel ui-card"[^>]*>([^]*?)<\/section>/)?.[1] ?? ""
            expect(card, locale).toMatch(/<p class="ui-good-line"><svg[^>]*>[^]*?<\/svg><span>/)
            expect(card, locale).toContain(esc(words(locale).subscription_expired_data_safe))
        }
        // The check takes the Good colour (DESIGN.md §2.3), and lines up with the line beside it.
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-good-line > svg \{[^}]*color: var\(--status-good-fg\);/)
    })

    it("says nothing in Arabic in the masculine, and never speaks as \"we\"", () => {
        const keys = ["subscription_expired_title", "subscription_expired_paused", "subscription_expired_renew", "subscription_expired_data_safe"] as const
        for (const key of keys) {
            expect(en[key], key).not.toMatch(/\b(we|our|us)\b/i)
            expect(ar[key], key).not.toMatch(/(^|\s)(تحقق|امسح|أدخل|اختر|حاول|انتظر|اطلب|اكتب|أكّد|انسخ|اتركه|قم|تواصل|راجع)(\s|$)|هل أنت متأكد|أنك تريد|هل تريد|سن[أتني]|نحن/)
        }
    })

    it("is what the page shows a locked company, and only a locked one", () => {
        const page = readFileSync("app/(dashboard)/dashboard/subscription-expired/page.tsx", "utf8")
        expect(page).toContain("if (!subscription || subscription.state !== 'LOCKED') {\n        redirect('/dashboard')")
        expect(page).toContain("<SubscriptionExpired lockedOn={subscription.date} />")
    })
})
