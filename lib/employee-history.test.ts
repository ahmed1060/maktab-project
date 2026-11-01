import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { RECONSTRUCTED_NOTE } from "./leave-reset"

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
// A dialog renders in place, after hydration, so its contents are in the markup.
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async importOriginal => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (children: unknown) => children }))
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
const HISTORY = {
    baseCredit: 21, remainingCredit: 15.5, history: [
        {
            year: 2026, snapshot: null, requests: [
                { id: "o1", type: "REGULAR", date: "2026-03-05T12:00:00Z", daysDeducted: 2, deductionType: "CREDIT", reason: "Family visit" },
                { id: "o2", type: "SICK", date: "2026-02-10T12:00:00Z", daysDeducted: 1, deductionType: "SALARY", reason: null },
            ],
        },
        { year: 2025, snapshot: { id: "y25", year: 2025, baseCredit: 21, remainingCredit: 4, note: RECONSTRUCTED_NOTE }, requests: [] },
    ],
}
const COSTS = [
    { id: "t1", title: "Fix the gate", amount: 1250, status: "PAID", date: "2026-10-20T12:00:00Z" },
    { id: "t2", title: "Buy cable", amount: 80.5, status: "PENDING_PAYMENT", date: "2026-10-22T12:00:00Z" },
]
const ADJUSTMENTS = [
    { id: "a1", type: "BONUS", amount: 2, reason: "Weekend shift", status: "ACTIVE", month: 10, year: 2026, source: "MANUAL", createdAt: "2026-10-28T12:30:00Z" },
    { id: "a2", type: "DEDUCTION", amount: 1.5, reason: null, status: "ACTIVE", month: 10, year: 2026, source: "TASK_PENALTY", createdAt: "2026-10-20T12:30:00Z" },
    { id: "a3", type: "BONUS", amount: 1, reason: "Typed twice", status: "REVERSED", month: 9, year: 2026, source: "MANUAL", createdAt: "2026-09-12T12:30:00Z" },
]
const egp = (n: number, locale = "en-GB") => `${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${locale === "ar-EG" ? ar.egp : en.egp}`
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

    it("has no action in the page header: each tab's actions are on its rows", async () => {
        // Bonuses and deductions are a section of the Salary tab, each with its own actions (part 3).
        const salaryTab = await page({ perms: ["salary.view", "salary_adjustments.manage"], swr: { "/api/users/u2/adjustments": { data: { data: ADJUSTMENTS } } } })
        expect(salaryTab).not.toContain("ui-page-actions")
        expect(salaryTab).toMatch(new RegExp(`<h2 class="ui-section-title">(<span[^>]*>)?${en.hist_adjustments}(</span>)?</h2>`))
        // Day off credit has none: Reconsider is on each day off it can change (part 2).
        const dayOff = await page({ query: "tab=day-off", perms: ["dayoff.approve"], swr: { "/api/users/u2/day-off-history": { data: { data: HISTORY } } } })
        expect(dayOff).not.toContain("ui-page-actions")
        expect(dayOff).not.toContain("Manage deductions")
        expect(dayOff).toContain(`>${en.reevaluate}</button>`)
    })

    it("opens each tab from its own list, and says when that list didn't load", async () => {
        const dayOff = await page({ query: "tab=day-off", swr: { "/api/users/u2/day-off-history": { data: { data: HISTORY } } } })
        expect(dayOff).toContain(`<dt>${en.hist_dayoff_base}</dt>`)
        const costs = await page({ query: "tab=costs", swr: { "/api/users/u2/costs-history": { data: { data: COSTS } } } })
        expect(costs).toContain(`href="/dashboard/tasks/t1"`)
        const failed = await page({ query: "tab=costs", swr: { "/api/users/u2/costs-history": refused(500) } })
        expect(failed).toContain(en.hist_costs_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain(">Try again</button>")
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

async function dayOff(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { DayOffTab } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/DayOffTab")
    return renderToStaticMarkup(h(DayOffTab, {
        history: HISTORY, loading: false, error: undefined, retrying: false, retry: () => {},
        canReconsider: false, onReconsider: () => {}, ...props,
    } as never))
}
async function costs(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { CostsTab } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/CostsTab")
    return renderToStaticMarkup(h(CostsTab, { costs: COSTS, loading: false, error: undefined, retrying: false, retry: () => {}, ...props } as never))
}

describe("the Day off credit tab (part 2)", () => {
    it("gives the credit a year and what's left, in days", async () => {
        const html = await dayOff()
        expect(html).toContain(`<dt>${en.hist_dayoff_base}</dt><dd>21 days</dd>`)
        expect(html).toContain(`<dt>${en.hist_dayoff_left}</dt><dd>15.5 days</dd>`)
    })

    it("lists each year's days off: the date, the type in words, the days, what they came out of, and why", async () => {
        const html = await dayOff()
        expect(html).toContain(`<h2 class="ui-section-title">2026</h2>`)
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.hist_dayoff_days_off.replace("{year}", "2026")}</caption>`)
        expect(html).toContain("5 March 2026")
        expect(html).toContain(en.regular_day_off)
        expect(html).toContain(en.sick_day_off)
        // It said REGULAR and SICK, as the database spells them.
        expect(html).not.toContain(">REGULAR<")
        expect(html).toContain(">2 days<")
        expect(html).toContain(en.deduct_from_credit)
        expect(html).toContain(en.deduct_from_salary)
        expect(html).toContain("<bdi>Family visit</bdi>")
        // " | " between the two figures read as one string of things.
        expect(html).not.toContain(" | ")
    })

    it("gives a closed year's credit and what was left at its end, and says, in the page's language, when the year was carried rather than measured", async () => {
        const html = await dayOff()
        expect(html).toContain(`<dt>${en.hist_dayoff_year_base}</dt><dd>21 days</dd>`)
        expect(html).toContain(`<dt>${en.hist_dayoff_year_left.replace(/'/g, "&#x27;")}</dt><dd>4 days</dd>`)
        expect(html).toContain(en.hist_dayoff_reconstructed.replace(/'/g, "&#x27;"))
        expect(html).toContain(`<p class="ui-empty-title">${en.hist_dayoff_none_year}</p>`)
        const arabic = await dayOff({}, "ar")
        expect(arabic).toContain(ar.hist_dayoff_reconstructed)
        expect(arabic).not.toContain(RECONSTRUCTED_NOTE)
    })

    it("is in the page's language, digits too", async () => {
        const html = await dayOff({}, "ar")
        expect(html).toContain(`<h2 class="ui-section-title">${new Intl.NumberFormat("ar-EG", { useGrouping: false }).format(2026)}</h2>`)
        expect(html).toContain(new Date("2026-03-05T12:00:00Z").toLocaleDateString("ar-EG", { day: "numeric", month: "long", year: "numeric" }))
        expect(html).toContain(ar.regular_day_off)
    })

    it("offers Reconsider on each day taken from the credit, to who can approve days off, and only on those", async () => {
        expect(await dayOff()).not.toContain(en.reevaluate)
        const html = await dayOff({ canReconsider: true })
        const table = html.slice(0, html.indexOf('<ul class="ui-cards"'))
        expect(table.match(new RegExp(`>${en.reevaluate}</button>`, "g"))).toHaveLength(1)
    })

    it("says it's loading, that it didn't load, with Try again, or that there are no days off yet", async () => {
        expect(await dayOff({ history: null, loading: true })).toContain('<div class="ui-panel" role="status">')
        const failed = await dayOff({ history: null, error: refused(500).error })
        expect(failed).toContain(en.hist_dayoff_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(">Try again</button>")
        expect(await dayOff({ history: { baseCredit: 21, remainingCredit: 21, history: [] } })).toContain(`<p class="ui-empty-title">${en.hist_dayoff_none}</p>`)
    })
})

describe("reconsidering a day off (part 2)", () => {
    async function dialog(locale: "en" | "ar" = "en") {
        state.locale = locale
        const { ReconsiderDayOff } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/DayOffTab")
        // Portalled to the body, which a static render doesn't have.
        vi.stubGlobal("document", { body: {} })
        try {
            return renderToStaticMarkup(h(ReconsiderDayOff, { request: HISTORY.history[0].requests[0], onClose: () => {}, onDone: () => {} } as never))
        } finally {
            vi.unstubAllGlobals()
        }
    }

    it("names the day off and asks for its days, from 0 in halves, with Cancel and Save", async () => {
        const html = await dialog()
        expect(html).toContain(`<h2 id="`)
        expect(html).toContain(`class="ui-dialog-title">${en.hist_reconsider_title}</h2>`)
        expect(html).toContain(en.hist_reconsider_what.replace("{type}", en.regular_day_off).replace("{date}", "5 March 2026"))
        expect(html).toContain(en.hist_reconsider_days)
        expect(html).toMatch(/type="number"[^>]*min="0"[^>]*step="0.5"[^>]*value="2"/)
        expect(html).toContain(`>${en.cancel}</button>`)
        expect(html).toContain(`>${en.save}</button>`)
    })

    it("is in the page's language", async () => {
        const html = await dialog("ar")
        expect(html).toContain(ar.hist_reconsider_title)
        expect(html).toContain(ar.regular_day_off)
    })
})

describe("the Costs tab (part 2)", () => {
    it("lists each task's cost: the task, which opens, its date, what's to pay back, and whether it's been paid back", async () => {
        const html = await costs()
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.hist_costs_list}</caption>`)
        expect(html).toContain(`<a class="ui-item-link" href="/dashboard/tasks/t1"><bdi>Fix the gate</bdi></a>`)
        expect(html).toContain("20 October 2026")
        expect(html).toContain(egp(1250))
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${en.payment_status_paid}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.payment_status_pending}</span>`)
    })

    it("is in the page's language, digits too", async () => {
        const html = await costs({}, "ar")
        expect(html).toContain(egp(1250, "ar-EG"))
        expect(html).toContain(ar.payment_status_paid)
    })

    it("says it's loading, that it didn't load, with Try again, or that there are no costs yet", async () => {
        expect(await costs({ costs: [], loading: true })).toContain('<div class="ui-panel" role="status">')
        const failed = await costs({ costs: [], error: refused(500).error })
        expect(failed).toContain(en.hist_costs_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain(">Try again</button>")
        expect(await costs({ costs: [] })).toContain(`<p class="ui-empty-title">${en.hist_costs_none}</p>`)
    })
})

describe("found in the browser (the audit, PR 157)", () => {
    it("keeps a month's salary whole on a phone's card, with what it is on its own line", async () => {
        // Beside its note, the amount wrapped mid-number: "12,000." then "00".
        const html = await salary()
        const cards = html.slice(html.indexOf('<ul class="ui-cards"'))
        expect(cards).toContain(`<div class="ui-list-card-foot"><span class="ui-hint">${en.salary_figure_payslip}</span></div>`)
        expect(cards).not.toContain(`<span class="ui-num">${money(11750)}</span><span class="ui-item-detail">`)
    })

    it("lines a note up under its amount at the end of the row", () => {
        // In a column whose amounts are at the end, the note under each began at the start.
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-table td\.ui-end \.ui-item-detail \{\s*justify-content: flex-end;/)
    })
})

describe("found in the browser (the audit, PR 158)", () => {
    it("says a paid cost was paid back, and one waiting is to pay back", async () => {
        // "To pay back" beside "Paid" said the opposite of its badge.
        const html = await costs()
        expect(html).toContain(`<th scope="col" class="ui-end">${en.hist_cost_col_amount}</th>`)
        const cards = html.slice(html.indexOf('<ul class="ui-cards"'))
        expect(cards).toContain(`<span>${en.hist_cost_paid_back}: <strong class="ui-nowrap ui-num">${egp(1250)}</strong></span>`)
        expect(cards).toContain(`<span>${en.advances_to_pay_back}: <strong class="ui-nowrap ui-num">${egp(80.5)}</strong></span>`)
    })

    it("reads a day off's date as the calendar day it is, wherever the screen is, and gives a day off of several days its last day too", async () => {
        // Kept at midnight UTC, as the Requests page reads it: west of UTC it was the day before.
        const zone = process.env.TZ
        process.env.TZ = "America/New_York"
        try {
            const html = await dayOff({
                history: {
                    baseCredit: 21, remainingCredit: 18, history: [{
                        year: 2026, snapshot: null, requests: [
                            { id: "o3", type: "REGULAR", date: "2026-03-05T00:00:00Z", endDate: "2026-03-07T00:00:00Z", daysDeducted: 3, deductionType: "CREDIT", reason: null },
                            { id: "o4", type: "SICK", date: "2026-04-01T00:00:00Z", endDate: null, daysDeducted: 1, deductionType: "CREDIT", reason: null },
                        ],
                    }],
                },
            })
            expect(html).toContain(">5 March 2026 – 7 March 2026<")
            expect(html).toContain(">1 April 2026<")
            expect(html).not.toContain("4 March 2026")
        } finally {
            process.env.TZ = zone
        }
    })

    it("names each Reconsider for its day off, for who can't see the row", async () => {
        const html = await dayOff({ canReconsider: true })
        expect(html).toContain(`aria-label="${en.hist_reconsider_for.replace("{date}", "5 March 2026")}"`)
    })

    it("saves the days with Enter, as a form", async () => {
        state.locale = "en"
        const { ReconsiderDayOff } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/DayOffTab")
        vi.stubGlobal("document", { body: {} })
        let html: string
        try {
            html = renderToStaticMarkup(h(ReconsiderDayOff, { request: HISTORY.history[0].requests[0], onClose: () => {}, onDone: () => {} } as never))
        } finally {
            vi.unstubAllGlobals()
        }
        const form = html.slice(html.indexOf('<form class="ui-form" noValidate="">'))
        expect(form.slice(0, form.indexOf("</form>")), "the Save button is the form's").toContain(`<button type="submit" class="ui-btn ui-btn-primary">${en.save}</button>`)
        // A refused number takes the focus to its field, under which it says why.
        const src = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/DayOffTab.tsx", "utf8")
        expect(src).toContain(`form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()`)
    })
})

async function adjustments(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { Adjustments } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/Adjustments")
    return renderToStaticMarkup(h(Adjustments, {
        userId: "u2", adjustments: ADJUSTMENTS, loading: false, error: undefined, retrying: false, retry: () => {},
        canUndo: false, highlighted: null, scrollTo: null, onUndone: () => {}, ...props,
    } as never))
}
async function undo(action: "reverse" | "rollback", locale: "en" | "ar" = "en") {
    state.locale = locale
    const { UndoAdjustment } = await import("@/app/(dashboard)/dashboard/employees/[id]/history/Adjustments")
    // Portalled to the body, which a static render doesn't have.
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(UndoAdjustment, { userId: "u2", adjustment: ADJUSTMENTS[0], action, onClose: () => {}, onDone: () => {} } as never))
    } finally {
        vi.unstubAllGlobals()
    }
}

describe("bonuses and deductions (part 3)", () => {
    it("are a section of the Salary tab, for who can see salary", async () => {
        const html = await page({ swr: { "/api/users/u2/adjustments": { data: { data: ADJUSTMENTS } } } })
        expect(html).toMatch(new RegExp(`<h2 class="ui-section-title">(<span[^>]*>)?${en.hist_adjustments}(</span>)?</h2>`))
        expect(await page({ perms: [] })).not.toContain(en.hist_adjustments)
    })

    it("list each: what it was, the month it counts in, where it came from, why, and when it was entered", async () => {
        const html = await adjustments()
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.hist_adjustments}</caption>`)
        expect(html).toContain(en.hist_bonus_n.replace("{days}", "2 days"))
        expect(html).toContain(en.hist_deducted_n.replace("{days}", "1.5 days"))
        expect(html).toContain(">October 2026<")
        expect(html).toContain(en.adjustment_source_MANUAL)
        expect(html).toContain(en.adjustment_source_TASK_PENALTY)
        expect(html).toContain("<bdi>Weekend shift</bdi>")
        expect(html).toContain("28 October 2026")
        // The month and its source were one line joined by a chip; the sign was a "+" or "-".
        expect(html).not.toContain(">+")
    })

    it("say in a badge that a reversed or rolled back one is finished, and offer it nothing", async () => {
        const html = await adjustments({ canUndo: true })
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.reversed_label}</span>`)
        const table = html.slice(0, html.indexOf('<ul class="ui-cards"'))
        // A menu on each of the two still in effect, named for it; none on the reversed one.
        expect(table.match(/aria-haspopup="menu"/g)).toHaveLength(2)
        expect(table).toContain(`aria-label="${en.ui_more_actions_for.replace("{name}", `${en.hist_bonus_n.replace("{days}", "2 days")}, October 2026`)}"`)
        expect(await adjustments()).not.toContain('aria-haspopup="menu"')
    })

    it("mark the one a notification opened", async () => {
        const html = await adjustments({ highlighted: "a2" })
        expect(html).toContain('<tr data-key="a2" data-tone="selected">')
    })

    it("are in the page's language, digits too", async () => {
        const html = await adjustments({}, "ar")
        expect(html).toContain(new Date(2026, 9).toLocaleString("ar-EG", { month: "long", year: "numeric" }))
        expect(html).toContain(ar.adjustment_source_MANUAL)
    })

    it("say they're loading, that they didn't load, with Try again, or that there are none yet", async () => {
        expect(await adjustments({ adjustments: [], loading: true })).toContain('<div class="ui-panel" role="status">')
        const failed = await adjustments({ adjustments: [], error: refused(500).error })
        expect(failed).toContain(en.hist_adj_load_failed.replace(/'/g, "&#x27;"))
        expect(failed).toContain(">Try again</button>")
        expect(await adjustments({ adjustments: [] })).toContain(`<p class="ui-empty-title">${en.hist_adj_none}</p>`)
    })

    it("reverse in a dialog that says what reversing is, and asks why, if there's a reason", async () => {
        const html = await undo("reverse")
        expect(html).toContain(`class="ui-dialog-title">${en.hist_adj_reverse_title}</h2>`)
        expect(html).toContain(en.hist_adj_reverse_msg.replace(/'/g, "&#x27;"))
        expect(html).toContain(en.hist_adj_what.replace("{what}", en.hist_bonus_n.replace("{days}", "2 days")).replace("{month}", "October 2026"))
        expect(html).toContain(en.reverse_reason)
        expect(html).toContain("<textarea")
        expect(html).toContain(`<button type="submit" class="ui-btn ui-btn-primary">${en.reverse_adjustment}</button>`)
    })

    it("roll back only after asking, in the danger colour, with nothing to type", async () => {
        // It rolled back on one click.
        const html = await undo("rollback")
        expect(html).toContain(`class="ui-dialog-title">${en.hist_adj_rollback_title}</h2>`)
        expect(html).toContain(en.hist_adj_rollback_msg.replace(/'/g, "&#x27;"))
        expect(html).not.toContain("<textarea")
        expect(html).toContain(`<button type="submit" class="ui-btn ui-btn-danger">${en.hist_adj_rollback}</button>`)
        expect(await undo("rollback", "ar")).toContain(ar.hist_adj_rollback_title)
    })
})

describe("found in the browser (the audit, PR 159)", () => {
    it("names each More actions in the page's language, Arabic comma too", async () => {
        // "مكافأة يومان, نوفمبر": an English comma inside Arabic.
        const html = await adjustments({ canUndo: true }, "ar")
        const labels = [...html.matchAll(/aria-label="([^"]*)" title="[^"]*" aria-haspopup="menu"/g)].map(m => m[1])
        expect(labels.length).toBeGreaterThan(0)
        for (const label of labels) {
            expect(label).toContain("، ")
            expect(label).not.toContain(", ")
        }
    })

    it("takes the focus to the section's heading after an undo, as the row's menu goes with it", async () => {
        // It went back to the menu, which the undone row no longer has, and so to the page's start.
        const html = await adjustments()
        expect(html).toMatch(new RegExp(`<h2 class="ui-section-title"><span id="[^"]+" tabindex="-1">${en.hist_adjustments}</span></h2>`))
        const src = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/Adjustments.tsx", "utf8")
        expect(src).toContain("document.getElementById(headingId)?.focus()")
    })
})

describe("found by Codex on PR 159", () => {
    it("brings a notification's adjustment into view however long the list takes, not only while it's marked", () => {
        // It scrolled by the six-second mark: a list that took longer to load stayed where it was.
        const page = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
        expect(page).toContain("scrollTo={highlightId}")
        expect(page).toContain("highlighted={visualHighlightId}")
        const src = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/Adjustments.tsx", "utf8")
        expect(src).toContain("visibleRow(scrollTo)")
        expect(src).not.toContain("visibleRow(highlighted)")
    })
})

describe("nothing of the old frame is left", () => {
    it("has no spinner, hand-made back button, tab buttons or corner alert", () => {
        const src = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
        for (const old of ["LoadingSpinner", "router.back()", "className={`btn ${activeTab", "slideInRight", "setAlert("]) expect(src, old).not.toContain(old)
        const tab = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/SalaryTab.tsx", "utf8")
        for (const old of ["style={", "className=\"card", "toFixed(", "<table"]) expect(tab, old).not.toContain(old)
    })

    it("has no window of its own for the bonuses and deductions (part 3)", () => {
        const src = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
        for (const old of ["isAdjustmentsModalOpen", "className=\"glass", "position: 'fixed'", "SafeDate", "style={", "' · '", "useDialog("]) expect(src, old).not.toContain(old)
        const list = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/Adjustments.tsx", "utf8")
        for (const old of ["style={", "className=\"btn", "rotate(-2deg)", "' · '"]) expect(list, old).not.toContain(old)
    })

    it("has no hand-made tables, Manage deductions window or old Reconsider window (part 2)", () => {
        const src = readFileSync("app/(dashboard)/dashboard/employees/[id]/history/page.tsx", "utf8")
        for (const old of ["<table", "isManageDeductionsOpen", "isReevaluateModalOpen", "hist_manage_deductions", "t(req.type"]) expect(src, old).not.toContain(old)
        for (const file of ["DayOffTab", "CostsTab"]) {
            const tab = readFileSync(`app/(dashboard)/dashboard/employees/[id]/history/${file}.tsx`, "utf8")
            for (const old of ["style={", "className=\"card", "<table", "' | '"]) expect(tab, `${file}: ${old}`).not.toContain(old)
        }
    })
})
