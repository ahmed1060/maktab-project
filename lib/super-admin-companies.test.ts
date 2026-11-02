import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { computeTrialEnd, DEFAULT_TRIAL_PRESET } from "./billing/state"

/**
 * The Super Admin's pages on the building blocks, part 3a (UI_PLAN.md §5 step
 * 5), the first of the Customers group: the Companies list, which opens on
 * the companies that need attention, and the dialogs it adds, edits, bans and
 * deletes them in.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "sa1", role: "SUPER_ADMIN" } as Record<string, unknown> | null,
    search: "",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    menus: [] as { label: string; items: { key: string; label: string; href?: string; danger?: boolean }[] }[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.viewer ? { user: state.viewer } : null, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer, useCan: () => ({ can: () => true }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null, triggerRefresh: () => {} }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search), usePathname: () => "/dashboard/companies", useRouter: () => ({ replace: () => {}, push: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...(key ? state.swr[key] : {}) }
    },
}))
vi.mock("@/components/ui", async (importOriginal) => {
    const ui = await importOriginal<typeof import("@/components/ui")>()
    const RowMenu = (props: Parameters<typeof ui.RowMenu>[0]) => {
        state.menus.push(props as never)
        return h(ui.RowMenu, props)
    }
    return { ...ui, RowMenu }
})

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const ok = (data: unknown) => ({ data: { data } })
const failed = { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) }
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))

function render(element: Parameters<typeof renderToStaticMarkup>[0], swr: Record<string, Loaded> = {}, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null; search?: string } = {}) {
    Object.assign(state, { swr, keys: [], menus: [], locale: options.locale ?? "en", search: options.search ?? "" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN" } : options.viewer
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}

// The pages are slow to load the first time; once, before the tests time them.
beforeAll(async () => {
    await Promise.all([import("@/app/(dashboard)/dashboard/companies/page"), import("@/components/CompanyDialogs")])
}, 120000)

const ATTENTION = "/api/companies?page=1&limit=10&filter=needs-attention&sort=date&search="
const ALL = "/api/companies?page=1&limit=10&filter=all&sort=date&search="
const future = new Date(Date.now() + 14 * 86400000).toISOString()
const company = (c: Record<string, unknown> = {}) => ({
    id: "c1", name: "Delta Sites", isBanned: false, hasUnpaidPayment: false, needsAttention: true,
    package: { id: "p1", name: "Growth", hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: false, hasAttendanceMobile: true },
    subscription: { state: "TRIAL", date: future, daysRemaining: 14 },
    ...c,
})
const listed = (rows: unknown[], extra: Record<string, unknown> = {}) => ok({ data: rows, total: rows.length, totalPages: 1, totalCompanies: 12, needsAttentionCount: 2, ...extra })
const companies = async (swr: Record<string, Loaded>, options?: Parameters<typeof render>[2]) => {
    const { default: CompaniesPage } = await import("@/app/(dashboard)/dashboard/companies/page")
    return render(h(CompaniesPage), swr, options)
}
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })

describe("the Companies page", () => {
    it("has the page header with Add a company", async () => {
        const top = header(await companies({ [ATTENTION]: listed([company()]) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.companies}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.companies_hint)}</p>`)
        expect(top).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-primary">.*${en.companies_add}</button>`))
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await companies({ [ATTENTION]: listed([company()]) }, { viewer: { id: "a1", role: "ADMIN" } })
        expect(html).not.toContain("ui-page-header")
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("opens on the companies that need attention, and All companies is a tab kept in the address, each with its count", async () => {
        const html = await companies({ [ATTENTION]: listed([company()]) })
        expect(state.keys).toContain(ATTENTION)
        expect(html).toContain(`<a class="ui-tab" aria-current="page" href="/dashboard/companies">${en.needs_attention_filter} <span class="ui-tab-count">2</span></a>`)
        expect(html).toContain(`<a class="ui-tab" href="/dashboard/companies?show=all">${en.companies_tab_all} <span class="ui-tab-count">12</span></a>`)
        await companies({ [ALL]: listed([company()]) }, { search: "show=all" })
        expect(state.keys).toContain(ALL)
    })

    it("finds a company by name and sorts in the filter bar, each control labelled", async () => {
        const html = await companies({ [ATTENTION]: listed([company()]) })
        expect(html).toContain('class="ui-panel ui-filterbar"')
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-visually-hidden">${en.companies_search}</label>`))
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-visually-hidden">${en.companies_sort}</label>`))
        expect(html).toContain(`<option value="date" selected="">${en.companies_sort_date}</option>`)
        expect(html).toContain(`<option value="name">${en.companies_sort_name}</option>`)
    })

    it("lists each company with its subscription, as a badge of its meaning and its date, and its package with what it grants", async () => {
        const html = await companies({ [ATTENTION]: listed([
            company(),
            company({ id: "c2", name: "Nile Works", isBanned: true, hasUnpaidPayment: true, package: null, subscription: { state: "LOCKED", date: new Date(Date.now() - 3 * 86400000).toISOString(), daysRemaining: -3 } }),
            company({ id: "c3", name: "Old Co", package: { id: "p2", name: "Basic", hasCompanyManagement: false, hasHR: false }, subscription: { state: "ACTIVE", date: null, daysRemaining: null } }),
            company({ id: "c4", name: "Forever Ltd", subscription: { state: "LIFETIME", date: null, daysRemaining: null } }),
        ]) })
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.companies}</caption>`)
        for (const column of [en.companies_name, en.subscription_state, en.package_label]) expect(html).toContain(`<th scope="col">${column}</th>`)
        expect(html).toContain("<bdi>Delta Sites</bdi>")
        expect(html).toContain(`<bdi>Nile Works</bdi> <span class="ui-badge ui-badge-problem">${en.companies_banned}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-progress">${en.state_trial}</span>`)
        expect(html).toContain(`<bdi>${day(future)}</bdi>, <bdi>${en.companies_ends_in.replace("{days}", "14 days")}</bdi>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-problem">${en.state_locked}</span>`)
        expect(html).toContain(en.companies_ended_ago.replace("{days}", "3 days"))
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.unpaid_record}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.state_grandfathered}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${en.state_lifetime}</span>`)
        expect(html).toContain(en.never_expires)
        expect(html).toContain(`<bdi>Growth</bdi>`)
        expect(html).toContain(`${en.bundle_hr}, ${en.bundle_attendance_mobile}`)
        expect(html).toContain(en.core_only)
        expect(html).toContain(en.no_package)
        expect(html).toContain('<ul class="ui-cards"')
    })

    it("puts each company's actions in a menu named for it: settings and payments go there, then Edit, Ban or Unban, and Delete", async () => {
        await companies({ [ATTENTION]: listed([company(), company({ id: "c2", name: "Nile Works", isBanned: true })]) })
        const delta = state.menus.find(m => m.label === en.ui_more_actions_for.replace("{name}", "Delta Sites"))!
        expect(delta.items.map(i => i.label)).toEqual([en.company_settings_title, en.companies_payments, en.edit, en.companies_ban, en.delete])
        expect(delta.items[0].href).toBe("/dashboard/companies/c1/settings")
        expect(delta.items[1].href).toBe("/dashboard/companies/c1/payments")
        expect(delta.items.filter(i => i.danger).map(i => i.key)).toEqual(["ban", "delete"])
        const nile = state.menus.find(m => m.label.includes("Nile Works"))!
        expect(nile.items.find(i => i.key === "ban")).toMatchObject({ label: en.companies_unban, danger: undefined })
    })

    it("says how many in the pager, with its pages when there's more than one", async () => {
        const html = await companies({ [ATTENTION]: listed([company()], { total: 23, totalPages: 3 }) })
        expect(html).toContain("23 companies")
        expect(html).toContain(`aria-label="${en.ui_page_of.replace("{page}", "1").replace("{pages}", "3")}"`)
    })

    it("says so when nothing needs attention, with a way to all of them, and when there are no companies at all", async () => {
        const calm = await companies({ [ATTENTION]: listed([]) })
        expect(calm).toContain(`class="ui-empty-title">${esc(en.nothing_needs_attention)}<`)
        expect(calm).toMatch(new RegExp(`<a[^>]*href="/dashboard/companies\\?show=all"[^>]*>.*${en.companies_show_all}</a>`))
        const none = await companies({ [ALL]: listed([], { totalCompanies: 0 }) }, { search: "show=all" })
        expect(none).toContain(`class="ui-empty-title">${esc(en.companies_none)}<`)
    })

    it("says while they load, and when they didn't, with the server's reason and Try again", async () => {
        expect(await companies({})).toContain('<div class="ui-panel" role="status">')
        const html = await companies({ [ATTENTION]: failed })
        expect(html).toContain(esc(en.companies_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })
})

describe("the company dialogs", () => {
    const packages = { "/api/packages": ok([{ id: "p1", name: "Growth" }, { id: "p2", name: "Basic" }]) }

    it("adds a company with its name, its trial and its package, the trial's end said as a date", async () => {
        const { CompanyDialog } = await import("@/components/CompanyDialogs")
        const html = render(h(CompanyDialog, { company: null, onClose: () => {}, onSaved: () => {} }), packages)
        expect(html).toContain(`class="ui-dialog-title">${en.companies_add}</h2>`)
        for (const name of [en.companies_name_label, en.trial_length, en.package_label]) expect(html, name).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${name}</label>`))
        expect(html).toMatch(/<input[^>]*name="name"[^>]*maxLength="50"|<input[^>]*maxLength="50"[^>]*name="name"/)
        const ends = computeTrialEnd(new Date(), DEFAULT_TRIAL_PRESET, 0)!.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
        expect(html).toContain(esc(en.companies_trial_ends.replace("{date}", ends)))
        expect(html).toContain(`<option value="" selected="">${en.no_package}</option><option value="p1">Growth</option><option value="p2">Basic</option>`)
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.companies_add_submit}</button>`))
    })

    it("edits one's name and package, named for it, the trial left alone", async () => {
        const { CompanyDialog } = await import("@/components/CompanyDialogs")
        const html = render(h(CompanyDialog, { company: company(), onClose: () => {}, onSaved: () => {} }), packages)
        expect(html).toContain(`class="ui-dialog-title">${en.companies_edit_title.replace("{name}", "Delta Sites")}</h2>`)
        expect(html).toContain('value="Delta Sites"')
        expect(html).not.toContain(en.trial_length)
        expect(html).toContain('<option value="p1" selected="">Growth</option>')
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.save}</button>`))
    })

    it("says on Save what's wrong with the name, as the server would", async () => {
        const { companyNameError } = await import("@/components/CompanyDialogs")
        expect(companyNameError(" ")).toBe("companies_name_short")
        expect(companyNameError("A")).toBe("companies_name_short")
        expect(companyNameError("Delta Sites")).toBeNull()
    })

    it("asks before a ban, in the danger colour, and before an unban, saying what each does to its people", async () => {
        const { BanCompanyDialog } = await import("@/components/CompanyDialogs")
        const ban = render(h(BanCompanyDialog, { company: company(), busy: false, onCancel: () => {}, onConfirm: () => {} }))
        expect(ban).toContain(`class="ui-dialog-title">${en.companies_ban_title.replace("{name}", "Delta Sites")}</h2>`)
        expect(ban).toContain(esc(en.companies_ban_body))
        expect(ban).toContain(`class="ui-btn ui-btn-danger">${en.companies_ban}</button>`)
        const unban = render(h(BanCompanyDialog, { company: company({ isBanned: true }), busy: false, onCancel: () => {}, onConfirm: () => {} }))
        expect(unban).toContain(`class="ui-dialog-title">${en.companies_unban_title.replace("{name}", "Delta Sites")}</h2>`)
        expect(unban).toContain(esc(en.companies_unban_body))
        expect(unban).toContain(`class="ui-btn ui-btn-primary">${en.companies_unban}</button>`)
    })
})

describe("nothing of the old page is left", () => {
    it("has no inline styles, old windows, spinner, toggle, pager, emoji or header title", () => {
        for (const file of ["app/(dashboard)/dashboard/companies/page.tsx", "components/CompanyDialogs.tsx", "components/SubscriptionBadge.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toMatch(/@\/components\/(Modal|ConfirmModal|NoticeModal|LoadingSpinner|SegmentedToggle|Pagination)'/)
            expect(source, file).not.toMatch(/className="(input|btn|glass)/)
            expect(source, file).not.toContain("useHeader")
            expect(source, file).not.toMatch(/[💳⚙️✅]/u)
            expect(source, file).not.toContain(" · ")
        }
    })

    it("gives the subscription states the meaning colours, not colours of their own", () => {
        expect(readFileSync("lib/subscription-display.ts", "utf8")).not.toMatch(/#[0-9a-f]{6}/i)
    })
})
