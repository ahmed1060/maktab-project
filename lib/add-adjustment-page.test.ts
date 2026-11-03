import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Add a bonus and Add a deduction on the building blocks (UI_PLAN.md §5
 * step 5, the pages left): two copies of one form, each a card of its own
 * making with its sides chosen by hand for each language, saying nothing of
 * whose pay it was, open to anybody who reached its address, and answering
 * every refusal with "Failed to add bonus".
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "a1", role: "ADMIN" } as Record<string, unknown>,
    perms: new Set<string>(),
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    personId: "u2",
    sessionLoading: false,
}

vi.mock("next-auth/react", () => ({
    useSession: () => (state.sessionLoading ? { data: null, status: "loading" } : { data: { user: state.viewer }, status: "authenticated" }),
}))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (k: string) => state.perms.has(k) }), useViewer: () => state.viewer }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (k: string) => (k === "employees" ? "Employees" : k) }) }))
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }),
    useParams: () => ({ id: state.personId }),
    usePathname: () => `/dashboard/employees/${state.personId}/bonus`,
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/components/AccessDenied", () => ({ default: () => h("div", { "data-denied": "" }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const loaded: Loaded = key ? state.swr[key] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))

const BONUS = "app/(dashboard)/dashboard/employees/[id]/bonus/page.tsx"
const DEDUCTION = "app/(dashboard)/dashboard/employees/[id]/deduction/page.tsx"
const FORM = "app/(dashboard)/dashboard/employees/[id]/AddAdjustment.tsx"

let Bonus: () => ReactElement
let Deduction: () => ReactElement
beforeAll(async () => {
    Bonus = (await import("@/app/(dashboard)/dashboard/employees/[id]/bonus/page")).default
    Deduction = (await import("@/app/(dashboard)/dashboard/employees/[id]/deduction/page")).default
})
beforeEach(() => {
    state.locale = "en"
    state.viewer = { id: "a1", role: "ADMIN" }
    state.perms = new Set(["salary_adjustments.manage", "employees.view"])
    state.swr = { "/api/users?id=u2": { data: { data: { id: "u2", firstName: "Mona", lastName: "Adel" } } } }
    state.keys = []
    state.personId = "u2"
    state.sessionLoading = false
})
const render = (page: () => ReactElement) => renderToStaticMarkup(h(page))
/** As React writes text into the page. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")

describe("Add a bonus and Add a deduction on the building blocks", () => {
    it("is one form for both, each page saying which", () => {
        for (const [path, kind] of [[BONUS, "BONUS"], [DEDUCTION, "DEDUCTION"]] as const) {
            const src = readFileSync(path, "utf8")
            expect(src).toContain(`<AddAdjustment kind="${kind}" />`)
            // Nothing left of the copies: no inline styles, no sides chosen by hand.
            expect(src).not.toContain("style=")
            expect(src).not.toContain("direction")
        }
        const form = readFileSync(FORM, "utf8")
        expect(form).not.toContain("style=")
        expect(form).not.toContain("locale === 'ar' ? 'rtl'")
        expect(form).not.toContain("as any")
    })

    it("has the page header, saying whose pay it is, with a way back to the list", () => {
        const html = render(Bonus)
        expect(html).toContain('<h1 class="ui-page-title">Add a bonus</h1>')
        expect(html).toContain('<p class="ui-page-subtitle">For <bdi>Mona Adel</bdi></p>')
        expect(html).toMatch(/<a class="ui-back-link" href="\/dashboard\/employees">.*Employees<\/a>/)
        expect(state.keys).toContain("/api/users?id=u2")
        expect(render(Deduction)).toContain('<h1 class="ui-page-title">Add a deduction</h1>')
    })

    it("keeps the subtitle's line while the name loads, so the form doesn't move", () => {
        state.swr = {}
        expect(render(Bonus)).toContain('<p class="ui-page-subtitle"> </p>')
    })

    it("is a card with the building blocks' fields: the days, a hint of how many, and an optional reason", () => {
        const html = render(Bonus)
        expect(html).toContain('class="ui-card')
        expect(html).toContain('<form noValidate="" class="ui-form">')
        expect(html).toContain(esc(en.adj_new_bonus_hint))
        expect(html).toContain(">Days</label>")
        expect(html).toMatch(/<input(?=[^>]*name="amount")(?=[^>]*inputMode="decimal")[^>]*>/)
        expect(html).toContain(en.adj_new_days_hint.replace("{max}", "1,000"))
        expect(html).toContain(">Reason (optional)</label>")
        expect(html).toMatch(/<textarea[^>]*name="reason"/)
        expect(html).toMatch(/<button type="submit" class="ui-btn ui-btn-primary"[^>]*>.*Add bonus/)
        expect(html).toMatch(/<a class="ui-btn ui-btn-secondary" href="\/dashboard\/employees">Cancel<\/a>/)
    })

    it("asks for a deduction with the primary button, as it can be undone (DESIGN.md: danger is for destroying)", () => {
        const html = render(Deduction)
        expect(html).toContain(esc(en.adj_new_deduction_hint))
        expect(html).toMatch(/<button type="submit" class="ui-btn ui-btn-primary"[^>]*>.*Add deduction/)
        expect(html).not.toContain("ui-btn-danger")
    })

    it("says it in Arabic, with Arabic digits", () => {
        state.locale = "ar"
        const html = render(Bonus)
        expect(html).toContain(ar.adj_new_bonus_title)
        expect(html).toContain(ar.adj_new_days_hint.replace("{max}", (1000).toLocaleString("ar-EG")))
    })

    it("tells somebody who may not adjust pay so, and asks nothing of the server", () => {
        state.perms = new Set(["employees.view"])
        const html = render(Bonus)
        expect(html).toContain("data-denied")
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("says up front that nobody adjusts their own pay, where the form let them fill it in and the server refused", () => {
        state.personId = "a1"
        state.swr = { "/api/users?id=a1": { data: { data: { id: "a1", firstName: "Hana", lastName: "Saad" } } } }
        const html = render(Bonus)
        expect(html).toContain(esc(en.adj_new_own_pay))
        expect(html).not.toContain("<form")
    })
})

describe("The days, checked before anything is sent", () => {
    it("takes more than 0 and up to 1,000, as the server does", async () => {
        const { daysError, MAX_DAYS } = await import("@/lib/adjustment-form")
        expect(MAX_DAYS).toBe(1000)
        for (const typed of ["", "  ", "0", "-1", "abc"]) expect(daysError(typed), typed).toBe("adj_new_days_invalid")
        expect(daysError("1000.5")).toBe("adj_new_days_too_many")
        for (const typed of ["1", "1.5", " 2 ", "1000", "1.25"]) expect(daysError(typed), typed).toBeNull()
    })

    it("takes up to 2 decimal places, as they're kept, where the browser's step of 0.01 said so before the form took over its checks", async () => {
        // Kept as 1.56, 1.555 would have changed the pay by 1.555 days.
        const { daysError } = await import("@/lib/adjustment-form")
        expect(daysError("1.555")).toBe("adj_new_days_decimals")
        expect(daysError("0.001")).toBe("adj_new_days_decimals")
        expect(en.adj_new_days_decimals).toBeTruthy()
        expect(ar.adj_new_days_decimals).toBeTruthy()
    })

    it("says the server's refusal of the days under them, and anything else above the buttons", async () => {
        const { refusedDays } = await import("@/lib/adjustment-form")
        expect(refusedDays({ error: "Invalid amount (1-1000)" })).toBe(true)
        expect(refusedDays({ error: "You cannot adjust your own pay" })).toBe(false)
        expect(refusedDays(null)).toBe(false)
        const form = readFileSync(FORM, "utf8")
        expect(form).toContain("apiErrorText(text, t('error_generic'))")
        expect(form).toContain("if (refusedDays(answer)) wrongDays(")
    })

    it("says it's done as a toast and goes back to the list at once, where it waited 1.5 seconds on \"Redirecting...\"", () => {
        const form = readFileSync(FORM, "utf8")
        expect(form).not.toContain("setTimeout")
        expect(form).toContain("showToast(t(COPY[kind].added), 'success')")
        expect(form).toContain("router.push('/dashboard/employees')")
    })

    it("has its words in both languages, and the old copies' words are gone", () => {
        const keys = ["adj_new_bonus_title", "adj_new_deduction_title", "adj_new_for", "adj_new_bonus_hint", "adj_new_deduction_hint",
            "adj_new_days_label", "adj_new_days_hint", "adj_new_days_invalid", "adj_new_days_too_many", "adj_new_reason_label",
            "adj_new_bonus_added", "adj_new_deduction_added", "adj_new_own_pay"] as const
        for (const key of keys) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
        for (const key of ["add_monthly_bonus_title", "add_monthly_deduction_title", "bonus_limit_error", "deduction_limit_error",
            "bonus_added_success", "deduction_added_success", "failed_add_bonus", "failed_add_deduction",
            "bonus_days_hint", "deduction_days_hint", "bonus_days_label", "deduction_days_label", "example_bonus", "example_deduction", "adding"]) {
            expect(key in en, key).toBe(false)
            expect(key in ar, key).toBe(false)
        }
    })
})

describe("Add a bonus, found in the browser", () => {
    it("knows their own pay while the session loads, where the form showed until it came", () => {
        // The viewer is the layout's while the session loads (useViewer), as
        // the permission check already is: asked of the session alone, their
        // own pay showed the form, then the note.
        state.sessionLoading = true
        state.personId = "a1"
        const html = render(Bonus)
        expect(html).toContain(esc(en.adj_new_own_pay))
        expect(html).not.toContain("<form")
        expect(readFileSync(FORM, "utf8")).not.toContain("useSession")
    })
})
