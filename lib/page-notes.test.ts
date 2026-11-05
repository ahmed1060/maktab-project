import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A note above the page (DESIGN.md §5.5), for something true on every page
 * for now: a company's free trial or its grace, and a role a Super Admin is
 * previewing. Each was a box of its own making under an emoji: the trial's
 * said "2 day(s) left" in English and "2" among Arabic-Indic digits, grace
 * told everyone to renew, which only an Admin can, and both read their day
 * on the reader's own calendar.
 */

const state = {
    locale: "en" as "en" | "ar",
    viewer: null as Record<string, unknown> | null,
}
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ update: async () => null }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

let PageNote: (props: { tone: "neutral" | "waiting" | "problem"; children: ReactNode; action?: ReactNode }) => ReactElement
let SubscriptionNote: () => ReactElement | null
let PreviewNote: (props: { preview: unknown }) => ReactElement | null
beforeAll(async () => {
    PageNote = (await import("@/components/ui")).PageNote as never
    SubscriptionNote = (await import("@/components/SubscriptionNote")).default as never
    PreviewNote = (await import("@/components/PreviewNote")).default as never
})
beforeEach(() => {
    state.locale = "en"
    state.viewer = null
})

/** As React writes text into the page. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
/** The words of a note, as it's read. */
const said = (html: string) => html.match(/<p class="ui-page-note-text">([^<]*)<\/p>/)?.[1]
const subscribed = (subscription: Record<string, unknown>, role = "EMPLOYEE") => {
    state.viewer = { id: "u1", role, companyId: "c1", subscription }
    return renderToStaticMarkup(h(SubscriptionNote))
}
// Its last day is 6 November in Cairo, whatever the reader's own calendar says.
const TRIAL = { state: "TRIAL", date: "2026-11-06T06:00:00.000Z", daysRemaining: 5 }
const GRACE = { state: "GRACE", date: "2026-11-05T21:59:59.999Z", daysRemaining: 2 }

describe("A note above the page", () => {
    it("is a panel with its meaning's bar, its words, and what to do about it at the end", () => {
        expect(renderToStaticMarkup(h(PageNote, { tone: "neutral", children: "Something true for now." })))
            .toBe('<div class="ui-panel ui-page-note" data-tone="neutral" role="status"><p class="ui-page-note-text">Something true for now.</p></div>')
        const withAction = renderToStaticMarkup(h(PageNote, { tone: "waiting", children: "Words", action: h("button", null, "Do it") }))
        expect(withAction).toContain('<div class="ui-page-note-action"><button>Do it</button></div>')
        // What can't wait is read out at once.
        expect(renderToStaticMarkup(h(PageNote, { tone: "problem", children: "Words" }))).toContain('data-tone="problem" role="alert"')
    })

    it("has nothing of its own making left in the two it replaces", () => {
        expect(existsSync("components/SubscriptionBanner.tsx")).toBe(false)
        expect(existsSync("components/PreviewBanner.tsx")).toBe(false)
        for (const file of ["components/SubscriptionNote.tsx", "components/PreviewNote.tsx"]) {
            const src = readFileSync(file, "utf8")
            expect(src, file).not.toMatch(/style=\{/)
            expect(src, file).not.toMatch(/\p{Extended_Pictographic}/u)
            expect(src, file).not.toMatch(/className="btn\b|btn-primary/)
            expect(src, file).toMatch(/from ['"]@\/components\/ui['"]/)
        }
        const shell = readFileSync("components/DashboardShell.tsx", "utf8")
        expect(shell).toMatch(/<PreviewNote preview=\{user\?\.preview\} \/>\s*<SubscriptionNote \/>/)
        expect(shell).not.toMatch(/Banner/)
    })
})

describe("A company's free trial", () => {
    it("counts the days to its last day, and says the day, on Egypt's calendar", () => {
        const html = subscribed({ ...TRIAL, daysToLastDay: 5 })
        expect(html).toContain('data-tone="neutral" role="status"')
        expect(said(html)).toBe(esc("The last day of your company's free trial is 6 Nov 2026, in 5 days."))
        state.locale = "ar"
        expect(said(subscribed({ ...TRIAL, daysToLastDay: 5 }))).toBe("آخر يوم في الفترة التجريبية لشركتك هو ٦ نوفمبر ٢٠٢٦، ويتبقى عليه ٥ أيام.")
        expect(said(subscribed({ ...TRIAL, daysToLastDay: 2 }))).toBe("آخر يوم في الفترة التجريبية لشركتك هو ٦ نوفمبر ٢٠٢٦، ويتبقى عليه يومان.")
    })

    it("says tomorrow, and today, rather than 1 day or 0", () => {
        expect(said(subscribed({ ...TRIAL, daysToLastDay: 1 }))).toBe(esc("The last day of your company's free trial is tomorrow, 6 Nov 2026."))
        expect(said(subscribed({ ...TRIAL, daysToLastDay: 0 }))).toBe(esc("Today is the last day of your company's free trial."))
        state.locale = "ar"
        expect(said(subscribed({ ...TRIAL, daysToLastDay: 1 }))).toBe("آخر يوم في الفترة التجريبية لشركتك هو غدًا، ٦ نوفمبر ٢٠٢٦.")
        expect(said(subscribed({ ...TRIAL, daysToLastDay: 0 }))).toBe("اليوم آخر يوم في الفترة التجريبية لشركتك.")
    })

    it("counts by the hours until the session has the days, for a sign-in from before", () => {
        expect(said(subscribed({ ...TRIAL, daysRemaining: 3 }))).toBe(esc("The last day of your company's free trial is 6 Nov 2026, in 3 days."))
        expect(said(subscribed({ ...TRIAL, daysRemaining: 0 }))).toBe(esc("Today is the last day of your company's free trial."))
    })
})

describe("A company's grace", () => {
    it("says the subscription has ended, and the last day of access", () => {
        const html = subscribed({ ...GRACE, daysToLastDay: 2 })
        expect(html).toContain('data-tone="problem" role="alert"')
        expect(said(html)).toBe(esc("Your company's subscription has ended. The last day of access is 5 Nov 2026, in 2 days. An Admin of your company can renew it."))
        expect(said(subscribed({ ...GRACE, daysToLastDay: 0 }))).toBe(esc("Your company's subscription has ended. Today is the last day of access. An Admin of your company can renew it."))
    })

    it("tells its Admin that renewing keeps everyone's access, and everyone else who can renew", () => {
        expect(said(subscribed({ ...GRACE, daysToLastDay: 1 }, "ADMIN"))).toBe(esc("Your company's subscription has ended. The last day of access is tomorrow, 5 Nov 2026. Renewing it keeps everyone's access."))
        state.locale = "ar"
        expect(said(subscribed({ ...GRACE, daysToLastDay: 1 }, "ADMIN"))).toBe("انتهى اشتراك شركتك. آخر يوم للوصول هو غدًا، ٥ نوفمبر ٢٠٢٦. تجديده يُبقي الوصول متاحًا للجميع.")
        expect(said(subscribed({ ...GRACE, daysToLastDay: 1 }, "TEAM_LEADER"))).toBe("انتهى اشتراك شركتك. آخر يوم للوصول هو غدًا، ٥ نوفمبر ٢٠٢٦. يمكن لمسؤول شركتك تجديده.")
    })

    it("says nothing while a subscription is simply working, or for a locked one, whose page says it", () => {
        for (const subscription of [
            { state: "ACTIVE", date: "2026-12-01T00:00:00.000Z", daysRemaining: 26, daysToLastDay: 26 },
            { state: "ACTIVE", date: null, daysRemaining: null, daysToLastDay: null },
            { state: "LIFETIME", date: null, daysRemaining: null, daysToLastDay: null },
            { state: "LOCKED", date: "2026-11-01T21:59:59.999Z", daysRemaining: -3, daysToLastDay: -4 },
        ]) {
            expect(subscribed(subscription), subscription.state).toBe("")
        }
        state.viewer = { id: "s1", role: "SUPER_ADMIN", subscription: null }
        expect(renderToStaticMarkup(h(SubscriptionNote))).toBe("")
    })
})

describe("A role being previewed", () => {
    const preview = { roleName: "Accountant", roleBuiltIn: null, companyId: "c1", companyName: "Nile Works" }

    it("says which role, where, that nothing can be changed, with Exit preview", () => {
        const html = renderToStaticMarkup(h(PreviewNote, { preview }))
        expect(html).toContain('data-tone="waiting" role="status"')
        expect(said(html)).toBe("Previewing Accountant at Nile Works. Read-only: nothing can be changed while previewing.")
        expect(html).toMatch(/<div class="ui-page-note-action"><button type="button" class="ui-btn [^"]*">Exit preview<\/button><\/div>/)
        expect(renderToStaticMarkup(h(PreviewNote, { preview: null }))).toBe("")
    })
})

describe("The words", () => {
    const keys = ["note_trial_in", "note_trial_tomorrow", "note_trial_today", "note_grace_in", "note_grace_tomorrow", "note_grace_today", "note_grace_admin", "note_grace_others", "preview_banner", "preview_exit"] as const

    it("never speak as \"we\", nor in Arabic in the masculine", () => {
        for (const key of keys) {
            expect(en[key], key).not.toMatch(/\b(we|our|us)\b/i)
            expect(ar[key], key).not.toMatch(/(^|\s)(تحقق|امسح|أدخل|اختر|حاول|انتظر|اطلب|اكتب|أكّد|انسخ|اتركه|قم|تواصل|راجع|جدد)(\s|$)|هل أنت متأكد|أنك تريد|هل تريد|نحن/)
        }
        // The glossary's name for the role that renews (UI_PLAN.md §3.2).
        expect(en.note_grace_others).toContain(en.role_admin)
        expect(ar.note_grace_others).toContain(ar.role_admin)
    })

    it("leave the banners' behind", () => {
        for (const key of ["trial_banner", "grace_banner"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
