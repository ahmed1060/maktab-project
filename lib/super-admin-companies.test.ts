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

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean; retained?: { data?: unknown } }
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
// A list's key is [address, scope] (lib/swr-scoped.ts): its data comes back
// tagged with the address it's for, or another's when `retained` is kept up
// from the last request.
vi.mock("swr", () => ({
    default: (key: string | [string, string] | null) => {
        const url = Array.isArray(key) ? key[0] : key
        state.keys.push(url)
        const loaded: Loaded & { retained?: { data?: unknown } } = url ? state.swr[url] ?? {} : {}
        const tagged = (body: unknown, from: string) => body === undefined ? undefined : Array.isArray(key) ? { scope: key[1], url: from, body } : body
        const data = loaded.retained ? tagged(loaded.retained.data, "/api/companies?an-earlier-request") : tagged(loaded.data, url ?? "")
        return { error: undefined, isValidating: false, mutate: async () => {}, ...loaded, data }
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

    it("starts the subscription's line with its badge, not set in as a badge beside a name is (found in the browser on part 3a)", async () => {
        const html = await companies({ [ATTENTION]: listed([company()]) })
        expect(html).toContain(`<div class="ui-badge-line"><span class="ui-badge ui-badge-progress">${en.state_trial}</span></div>`)
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-badge-line \{[^}]*display: flex;[^}]*gap: var\(--space-2\);/)
    })

    it("says on a phone card what the table says beside the name, and its package in one piece (found in the browser on part 3a)", async () => {
        const html = await companies({ [ATTENTION]: listed([company({ name: "Nile Works", isBanned: true })]) })
        const cards = html.slice(html.indexOf('<ul class="ui-cards"'))
        expect(cards).toContain(`<span class="ui-item-title"><bdi>Nile Works</bdi> <span class="ui-badge ui-badge-problem">${en.companies_banned}</span></span>`)
        expect(cards).toContain(`<span><bdi>Growth</bdi>, ${en.bundle_hr}, ${en.bundle_attendance_mobile}</span>`)
    })

    it("counts the days to the date it shows, not the server's hours rounded up (found in the browser on part 3a)", async () => {
        // 23:30 four days from now: the server's rounding says 5 days, the calendar 4.
        const late = new Date()
        late.setHours(23, 30, 0, 0)
        late.setDate(late.getDate() + 4)
        const html = await companies({ [ATTENTION]: listed([company({ subscription: { state: "TRIAL", date: late.toISOString(), daysRemaining: 5 } })]) })
        expect(html).toContain(en.companies_ends_in.replace("{days}", "4 days"))
        expect(html).not.toContain("5 days")
    })

    it("shows a tab's count on a pill that can be seen, selected or not (audit on part 3a)", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-tab-count \{[^}]*background: var\(--status-neutral-bg\);[^}]*color: var\(--status-neutral-fg\);/)
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

    it("says a failed search, tab or page didn't load, not the rows kept from the one before (Codex on PR 171)", async () => {
        const html = await companies({ [ALL]: { retained: listed([company()]), error: failed.error } }, { search: "show=all" })
        expect(html).toContain(esc(en.companies_load_failed))
        expect(html).toContain(`>${en.try_again}</button>`)
        expect(html).not.toContain("Delta Sites")
        // A refresh of the rows on screen that failed leaves them up.
        expect(await companies({ [ALL]: { ...listed([company()]), error: failed.error } }, { search: "show=all" })).toContain("Delta Sites")
    })

    it("goes back to the last page there is when the pages it's on are gone, as after a rename leaves a search (Codex on PR 171)", () => {
        const source = readFileSync("app/(dashboard)/dashboard/companies/page.tsx", "utf8")
        expect(source).toContain("useAdjustOnChange([pageCount], () => { if (pageCount !== undefined) setPage(p => pageInRange(p, pageCount)) })")
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
        const html = render(h(CompanyDialog, { company: null, onClose: () => {}, onSaved: () => {}, onChanged: () => {} }), packages)
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
        const html = render(h(CompanyDialog, { company: company(), onClose: () => {}, onSaved: () => {}, onChanged: () => {} }), packages)
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

    it("says which step failed: a package refused after the name saved is the package's, and the list is told (Codex on PR 171)", async () => {
        const { saveCompany } = await import("@/components/CompanyDialogs")
        const sent: string[] = []
        vi.stubGlobal("fetch", async (url: string, init: { method: string }) => {
            sent.push(`${init.method} ${url}`)
            return new Response(JSON.stringify(url.endsWith("/package") ? { error: "Package retired" } : { data: {} }), { status: url.endsWith("/package") ? 400 : 200 })
        })
        try {
            const result = await saveCompany(company(), { name: "Delta Works", trial: "FOURTEEN_DAYS", packageId: "p2", usernameCode: "" })
            expect(result.step).toBe("package")
            expect(sent).toEqual(["PUT /api/companies", "PUT /api/companies/c1/package"])
            expect((await saveCompany(company(), { name: "Delta Works", trial: "FOURTEEN_DAYS", packageId: "p1", usernameCode: "" })).step).toBe("saved")
        } finally {
            vi.unstubAllGlobals()
        }
        const source = readFileSync("components/CompanyDialogs.tsx", "utf8")
        expect(source).toMatch(/if \(result\.step === 'package'\) \{\s*onChanged\(\)/)
    })

    it("adds a company with its username code, filled in from its name, in English letters", async () => {
        const { CompanyDialog } = await import("@/components/CompanyDialogs")
        const html = render(h(CompanyDialog, { company: null, onClose: () => {}, onSaved: () => {}, onChanged: () => {} }), packages)
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.companies_code_label}</label>`))
        const input = html.match(/<input[^>]*name="usernameCode"[^>]*>/)?.[0] ?? ""
        for (const attribute of ['maxLength="8"', 'dir="ltr"', 'autoCapitalize="none"', 'spellCheck="false"', 'autoComplete="off"']) expect(input, attribute).toContain(attribute)
        expect(input).not.toContain("readOnly")
        // Empty until the name suggests one: the rule, not an example.
        expect(html).toContain(esc(en.companies_code_rule))
        // After the name, before the trial.
        expect(html.indexOf('name="usernameCode"')).toBeGreaterThan(html.indexOf('name="name"'))
        expect(html.indexOf('name="usernameCode"')).toBeLessThan(html.indexOf('name="trialPreset"'))
    })

    it("edits one's code, its usernames said as an example, until its first username is given, then shows it fixed", async () => {
        const { CompanyDialog } = await import("@/components/CompanyDialogs")
        const open = render(h(CompanyDialog, { company: company({ usernameCode: "ds", usernameLocked: false }), onClose: () => {}, onSaved: () => {}, onChanged: () => {} }), packages)
        expect(open).toMatch(/<input[^>]*name="usernameCode"[^>]*value="ds"/)
        // Kept left to right inside an Arabic sentence, where "ds0, ds1…" came out as "ds0, :0" and "…ds1".
        expect(open).toContain(`${esc(en.companies_code_hint.replace("{example}", ""))}<bdi dir="ltr">ds0, ds1…</bdi>`)
        const arabic = render(h(CompanyDialog, { company: company({ usernameCode: "ds", usernameLocked: false }), onClose: () => {}, onSaved: () => {}, onChanged: () => {} }), packages, { locale: "ar" })
        expect(arabic).toContain(`${esc(ar.companies_code_hint.replace("{example}", ""))}<bdi dir="ltr">ds0, ds1…</bdi>`)
        const fixed = render(h(CompanyDialog, { company: company({ usernameCode: "ds", usernameLocked: true }), onClose: () => {}, onSaved: () => {}, onChanged: () => {} }), packages)
        expect(fixed.match(/<input[^>]*name="usernameCode"[^>]*>/)?.[0]).toContain('readOnly=""')
        expect(fixed).toContain(`${esc(en.companies_code_fixed.replace("{example}", ""))}<bdi dir="ltr">ds0, ds1…</bdi>`)
        // Looks like a field that can't be changed, as a disabled one does (DESIGN.md §5.3).
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-input:disabled,\s*\.ui-input\[readonly\],\s*\.ui-select:disabled \{\s*background: var\(--page\);/)
        // The example ends the sentence: no full stop after its "…", in either language.
        for (const copy of [en, ar]) for (const key of ["companies_code_hint", "companies_code_fixed"] as const) expect(copy[key], key).toMatch(/\{example\}$/)
    })

    it("sends the code with a new company, and with an edit only when it's changed and not fixed", async () => {
        const { saveCompany } = await import("@/components/CompanyDialogs")
        const bodies: Record<string, unknown>[] = []
        vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
            bodies.push(JSON.parse(init.body))
            return new Response(JSON.stringify({ data: {} }), { status: 200 })
        })
        try {
            await saveCompany(null, { name: "Delta Sites", trial: "FOURTEEN_DAYS", packageId: "", usernameCode: " DS " })
            await saveCompany(company({ usernameCode: "ds", usernameLocked: false }), { name: "Delta Sites", trial: "FOURTEEN_DAYS", packageId: "p1", usernameCode: "dsi" })
            await saveCompany(company({ usernameCode: "ds", usernameLocked: false }), { name: "Delta Sites", trial: "FOURTEEN_DAYS", packageId: "p1", usernameCode: "ds" })
            await saveCompany(company({ usernameCode: "ds", usernameLocked: true }), { name: "Delta Sites", trial: "FOURTEEN_DAYS", packageId: "p1", usernameCode: "dsi" })
        } finally {
            vi.unstubAllGlobals()
        }
        expect(bodies.map(body => body.usernameCode)).toEqual(["ds", "dsi", undefined, undefined])
    })

    it("says the server's refusal under the field it's about", async () => {
        const { refusedField } = await import("@/components/CompanyDialogs")
        expect(refusedField("Company already exists")).toEqual({ field: "name", key: "companies_name_taken" })
        expect(refusedField("Company name already exists")).toEqual({ field: "name", key: "companies_name_taken" })
        expect(refusedField("Username code taken")).toEqual({ field: "usernameCode", key: "companies_code_taken" })
        expect(refusedField("Username code fixed")).toEqual({ field: "usernameCode", key: "companies_code_locked" })
        expect(refusedField("Database unavailable")).toBeNull()
    })

    it("asks for a suggestion once the name is long enough, for the company being edited", async () => {
        const { suggestionUrl } = await import("@/components/CompanyDialogs")
        expect(suggestionUrl("D", null)).toBeNull()
        expect(suggestionUrl("  ", null)).toBeNull()
        expect(suggestionUrl("Delta & Sons", null)).toBe("/api/companies/username-code?name=Delta+%26+Sons")
        expect(suggestionUrl("Delta Sites ", "c1")).toBe("/api/companies/username-code?name=Delta+Sites&id=c1")
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
