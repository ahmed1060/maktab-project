import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * My payslips on the building blocks (UI_PLAN.md §5 step 5, Documents part 1):
 * the page header, every payslip as a row that opens it, the month in the
 * page's language, what's not paid yet as a badge, and loading, switched off,
 * failed and empty each saying so.
 */

type Shown = { data?: unknown; error?: unknown }
const state = { locale: "en" as "en" | "ar", role: "EMPLOYEE", preview: false, shown: {} as Shown }
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "u1", role: state.role, preview: state.preview } }, status: "authenticated" }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
const asked: (string | null)[] = []
vi.mock("swr", () => ({
    default: (key: string | null) => {
        asked.push(key)
        return { data: undefined, error: undefined, isLoading: key !== null && !state.shown.data && !state.shown.error, isValidating: false, mutate: async () => {}, ...(key ? state.shown : {}) }
    },
}))

const ROWS = [
    { id: "p2", month: 10, year: 2026, status: "APPROVED", paidAt: null, net: 12500.5, daysPaid: 22 },
    { id: "p1", month: 9, year: 2026, status: "PAID", paidAt: "2026-10-01T09:00:00Z", net: 11800, daysPaid: 21.5 },
]
const refused = (status: number, message: string) => ({ error: Object.assign(new Error("Request failed"), { status, info: { error: message } }) })

async function page({ shown = { data: { data: ROWS } } as Shown, locale = "en" as "en" | "ar", role = "EMPLOYEE", preview = false } = {}) {
    state.locale = locale
    state.role = role
    state.preview = preview
    state.shown = shown
    asked.length = 0
    const { default: MyPayslipsPage } = await import("@/app/(dashboard)/dashboard/documents/page")
    return renderToStaticMarkup(h(MyPayslipsPage))
}
const amount = (n: number, locale = "en-EG") => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

describe("my payslips", () => {
    it("has the page header", async () => {
        const html = await page()
        expect(html).toContain(`<h1 class="ui-page-title">${en.my_payslips}</h1>`)
        expect(html).toContain(en.my_payslips_hint)
    })

    it("lists each payslip as a row that opens it: the month, the days paid, and the net", async () => {
        const html = await page()
        expect(html).toContain(`<ul class="ui-panel ui-rows" aria-label="${en.my_payslips}">`)
        expect(html).toContain('<a class="ui-row" href="/dashboard/documents/payslip/p2">')
        expect(html).toContain('<span class="ui-item-title">October 2026</span>')
        expect(html).toContain(`<span class="ui-item-detail">${en.payroll_days_paid_n.replace("{n}", "22")}</span>`)
        expect(html).toContain(`<span class="ui-item-detail">${en.payroll_days_paid_n.replace("{n}", "21.5")}</span>`)
        expect(html).toContain(`<bdi class="ui-row-amount">${amount(12500.5)}</bdi>`)
    })

    it("says which aren't paid yet, as a badge, so an approved payslip isn't read as money already sent", async () => {
        const html = await page()
        const october = html.slice(html.indexOf('href="/dashboard/documents/payslip/p2"'), html.indexOf("</li>", html.indexOf('href="/dashboard/documents/payslip/p2"')))
        expect(october).toContain(`<span class="ui-badge ui-badge-waiting">${en.my_payslips_not_paid}</span>`)
        const september = html.slice(html.indexOf('href="/dashboard/documents/payslip/p1"'), html.indexOf("</li>", html.indexOf('href="/dashboard/documents/payslip/p1"')))
        expect(september).not.toContain("ui-badge")
        // No dot running the words together: next to Arabic digits it reads as a zero.
        expect(html).not.toContain(" · ")
    })

    it("is in the page's language, the year and digits too", async () => {
        const html = await page({ locale: "ar" })
        const october = new Date(2026, 9).toLocaleString("ar-EG", { month: "long", year: "numeric" })
        expect(html).toContain(`<span class="ui-item-title">${october}</span>`)
        expect(html).toContain(ar.payroll_days_paid_n.replace("{n}", (22).toLocaleString("ar-EG")))
        expect(html).toContain(amount(12500.5, "ar-EG"))
        expect(html).toContain(ar.my_payslips_not_paid)
    })

    it("says it's loading, and when there are none yet", async () => {
        expect(await page({ shown: {} })).toContain(`<div class="ui-panel" role="status">`)
        const none = await page({ shown: { data: { data: [] } } })
        expect(none).toContain(`<p class="ui-empty-title">${en.my_payslips_empty}</p>`)
    })

    it("says the company hasn't switched them on, rather than that something failed", async () => {
        const html = await page({ shown: refused(403, "Forbidden") })
        expect(html).toContain(`<p class="ui-empty-title">${en.my_payslips_off}</p>`)
        expect(html).not.toContain(">Try again</button>")
    })

    it("says when they didn't load, with the server's word and Try again, rather than passing for none", async () => {
        const html = await page({ shown: refused(500, "Database unavailable") })
        expect(html).toContain(en.my_payslips_load_failed.replace(/'/g, "&#x27;"))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(">Try again</button>")
        expect(html).not.toContain(en.my_payslips_empty)
    })

    it("asks nothing for a Super Admin, or while one previews a role: they're nobody's employee", async () => {
        for (const x of [{ role: "SUPER_ADMIN" }, { preview: true }]) {
            const html = await page({ ...x, shown: {} })
            expect(asked.every(k => k === null)).toBe(true)
            expect(html).toContain(`<p class="ui-empty-title">${en.my_payslips_empty}</p>`)
        }
    })

    it("keeps no old styles or spinner", () => {
        const file = readFileSync("app/(dashboard)/dashboard/documents/page.tsx", "utf8")
        expect(file).not.toContain("style={")
        expect(file).not.toContain("LoadingSpinner")
        expect(file).not.toContain('className="card"')
    })
})
