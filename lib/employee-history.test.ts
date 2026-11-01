import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * An employee's history on the building blocks, part 1 (UI_PLAN.md §5 step
 * 5): the page header with the person's name, the tabs in the address, and
 * the Salary tab: the base salary, the months, settlements and debts, each
 * in the page's language, and loading, failed and empty each saying so.
 */

type Loaded = { data?: unknown; error?: unknown }
const state = {
    locale: "en" as "en" | "ar",
    me: "admin",
    id: "u2",
    query: "",
    perms: [] as string[],
    swr: {} as Record<string, Loaded>,
}
vi.mock("next/navigation", () => ({
    useParams: () => ({ id: state.id }),
    useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {} }),
    useSearchParams: () => new URLSearchParams(state.query),
    usePathname: () => `/dashboard/employees/${state.id}/history`,
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: state.me } } }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: (p: string) => state.perms.includes(p), canFor: (p: string) => state.perms.includes(p) }),
}))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    },
}))

const YOUSSEF = { id: "u2", firstName: "Youssef", lastName: "Adel", salary: 12000 }
const OCT = { id: "r10", month: 10, year: 2026, totalDays: 31, deductions: 1.5, baseSalary: 12000, bonusDays: 1, createdAt: "2026-10-01T00:00:00Z", figure: { source: "PAYSLIP", netMinor: 1175000, payslipId: "p10", status: "APPROVED" } }
const SEP = { id: "r9", month: 9, year: 2026, totalDays: 30, deductions: 0, baseSalary: 12000, bonusDays: 0, createdAt: "2026-09-01T00:00:00Z", figure: { source: "ESTIMATE", netMinor: 1200000 } }
const DEBT = { id: "d1", amount: 500, recovered: 200, outstanding: 300, writtenOff: 0, status: "OUTSTANDING", source: "CASH_ADVANCE", reason: "Kept the change", dueDate: "2026-11-25T00:00:00Z", settledAt: null }
const money = (n: number, locale = "en-EG") => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
const refused = (status: number) => ({ error: Object.assign(new Error("Request failed"), { status, info: { error: "Database unavailable" } }) })

async function page({ me = "admin", query = "", perms = ["salary.view"], swr = {} as Record<string, Loaded>, locale = "en" as "en" | "ar" } = {}) {
    Object.assign(state, { me, query, perms, swr, locale })
    const { default: Page } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/page")
    return renderToStaticMarkup(h(Page))
}
async function salary(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { SalaryTab } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/SalaryTab")
    return renderToStaticMarkup(h(SalaryTab, {
        employee: YOUSSEF, records: [OCT, SEP], loading: false, error: undefined, retrying: false, retry: () => {},
        settlements: [], debts: [], ...props,
    } as never))
}

describe("the frame", () => {
    it("names the person, under a link back to Employees", async () => {
        const html = await page({ swr: { "/api/users?id=u2": { data: { data: YOUSSEF } } } })
        expect(html).toContain(`class="ui-back-link" href="/dashboard/employees">`)
        expect(html).toContain(`${en.employees}</a>`)
        expect(html).toContain(`<h1 class="ui-page-title"><bdi>Youssef Adel</bdi></h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${en.history}</p>`)
    })

    it("has no way back to Employees on one's own history", async () => {
        const html = await page({ me: "u2", perms: [], swr: { "/api/users?id=u2": { data: { data: YOUSSEF } } } })
        expect(html).not.toContain("ui-back-link")
        expect(html).not.toContain(">Manage")
    })

    it("has its tabs, the one picked in the address, and Salary named History for who can't see salary", async () => {
        const html = await page({ query: "tab=costs" })
        expect(html).toContain(`role="tablist" aria-label="${en.history}"`)
        for (const label of [en.salary_label, en.hist_tab_day_off, en.costs_tab]) expect(html).toContain(`>${label}</button>`)
        expect(html).toMatch(new RegExp(`aria-selected="true"[^>]*>${en.costs_tab}</button>`))
        expect(await page({ perms: [] })).toMatch(new RegExp(`aria-selected="true"[^>]*>${en.history}</button>`))
    })

    it("puts the tab's own action in the page header", async () => {
        const adjust = await page({ perms: ["salary.view", "salary_adjustments.manage"] })
        expect(adjust).toMatch(new RegExp(`<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary">${en.hist_adjustments}</button></div>`))
        const deductions = await page({ query: "tab=day-off", perms: ["dayoff.approve"] })
        expect(deductions).toContain(`>${en.hist_manage_deductions}</button></div>`)
        expect(deductions).not.toContain(en.hist_adjustments)
    })
})

describe("the Salary tab", () => {
    it("gives the current base salary as a detail", async () => {
        expect(await salary()).toContain(`<dt>${en.hist_base_salary}</dt><dd><span class="ui-num">${money(12000)}</span></dd>`)
    })

    it("lists the months: the month opens its payslip, days paid of the month's, and what was deducted and added", async () => {
        const html = await salary()
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.hist_months}</caption>`)
        expect(html).toContain(`<a class="ui-item-link" href="/dashboard/documents/payslip/p10">October 2026</a>`)
        expect(html).toContain(en.hist_days_of.replace("{n}", "29.5").replace("{total}", "31"))
        expect(html).toContain(">1.5 days<")
        expect(html).toContain(">1 day<")
        expect(html).toContain(`<span class="ui-num">${money(11750)}</span>`)
        expect(html).toContain(en.salary_figure_payslip)
        // A month payroll didn't run for says its figure is an estimate, and has no payslip to open.
        expect(html).toContain(">September 2026<")
        expect(html).toContain(en.salary_figure_estimate)
    })

    it("is in the page's language, digits too", async () => {
        const html = await salary({}, "ar")
        expect(html).toContain(new Date(2026, 9).toLocaleString("ar-EG", { month: "long", year: "numeric" }))
        expect(html).toContain(ar.hist_days_of.replace("{n}", (29.5).toLocaleString("ar-EG")).replace("{total}", (31).toLocaleString("ar-EG")))
        expect(html).toContain(money(11750, "ar-EG"))
    })

    it("lists settlements, each opening its statement", async () => {
        const html = await salary({ settlements: [{ id: "s1", lastWorkingDay: "2026-10-15T12:00:00Z", net: 4000, status: "PENDING" }] })
        expect(html).toContain(`<h2 class="ui-section-title">${en.doc_settlements}</h2>`)
        expect(html).toContain(`href="/dashboard/documents/settlement/s1"`)
        expect(html).toContain("15 October 2026")
    })

    it("lists debts with what's left, their state in words, and what was recovered and why", async () => {
        const html = await salary({ debts: [DEBT] })
        expect(html).toContain(`<h2 class="ui-section-title">${en.debts_title}</h2>`)
        expect(html).toContain(`<span class="ui-num">${money(300)}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.debt_status_OUTSTANDING}</span>`)
        expect(html).toContain(money(200))
        expect(html).toContain(en.debt_source_CASH_ADVANCE)
        expect(html).toContain("Kept the change")
        // Joined with " · " it read as one string of things (DESIGN.md §3.4).
        expect(html).not.toContain(" · ")
    })

    it("says it's loading, that it didn't load, with Try again, or that there are no months yet", async () => {
        expect(await salary({ records: [], loading: true })).toContain('<div class="ui-panel" role="status">')
        const failed = await salary({ records: [], error: refused(500).error })
        expect(failed).toContain(en.hist_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
        expect(await salary({ records: [] })).toContain(`<p class="ui-empty-title">${en.hist_no_months}</p>`)
    })
})

describe("nothing of the old frame is left", () => {
    it("has no spinner, hand-made back button, tab buttons or corner alert", () => {
        const src = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
        for (const old of ["LoadingSpinner", "router.back()", "className={`btn ${activeTab", "slideInRight", "setAlert("]) expect(src, old).not.toContain(old)
        const tab = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/SalaryTab.tsx", "utf8")
        for (const old of ["style={", "className=\"card", "toFixed(", "<table"]) expect(tab, old).not.toContain(old)
    })
})
