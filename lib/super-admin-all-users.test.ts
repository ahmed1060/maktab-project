import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, part 3c (UI_PLAN.md §5 step
 * 5), the last of the Customers group: All users, everyone in every company,
 * and those who have left, whom only a Super Admin deletes for good.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean; retained?: { data?: unknown; scope?: string } }
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
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search), usePathname: () => "/dashboard/all-users", useRouter: () => ({ replace: () => {}, push: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
// A list's key is [address, scope] (lib/swr-scoped.ts): its data comes back
// tagged with the address it's for, or another's when `retained` is kept up
// from the last request. A plain string key is plain data.
vi.mock("swr", () => ({
    default: (key: string | [string, string] | null) => {
        const url = Array.isArray(key) ? key[0] : key
        state.keys.push(url)
        const loaded: Loaded = url ? state.swr[url] ?? {} : {}
        const tagged = (body: unknown, from: string, scope?: string) => body === undefined ? undefined : Array.isArray(key) ? { scope: scope ?? key[1], url: from, body } : body
        const data = loaded.retained ? tagged(loaded.retained.data, "/api/users?an-earlier-request", loaded.retained.scope) : tagged(loaded.data, url ?? "")
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

function render(swr: Record<string, Loaded>, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null; search?: string } = {}) {
    Object.assign(state, { swr, keys: [], menus: [], locale: options.locale ?? "en", search: options.search ?? "" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN" } : options.viewer
    vi.stubGlobal("document", { body: {} })
    return import("@/app/(dashboard)/dashboard/all-users/page").then(({ default: AllUsersPage }) => {
        try {
            return renderToStaticMarkup(h(AllUsersPage))
        } finally {
            vi.unstubAllGlobals()
        }
    })
}

beforeAll(async () => {
    await import("@/app/(dashboard)/dashboard/all-users/page")
}, 120000)

// At work asks for how many have each status too (PR 384).
const CURRENT = "/api/users?page=1&limit=10&companyId=&search=&counts=status"
const LEFT = "/api/users?page=1&limit=10&status=DELETED&companyId=&search="
const COMPANIES = "/api/companies?limit=1000&filter=all&sort=name"
const companies = { [COMPANIES]: ok({ data: [{ id: "c1", name: "Delta Sites" }, { id: "c2", name: "Nile Works" }] }) }
const person = (p: Record<string, unknown> = {}) => ({
    id: "u1", firstName: "Youssef", lastName: "Adel", email: "youssef@delta.test", username: "youssef.adel", role: "EMPLOYEE",
    status: "ACTIVE", totalDifficultyPoints: 12, company: { id: "c1", name: "Delta Sites" }, ...p,
})
const listed = (rows: unknown[], extra: Record<string, unknown> = {}) => ok({ data: rows, total: rows.length, page: 1, totalPages: 1, ...extra })

describe("the All users page", () => {
    it("has the page header, with a way to the Super Admins, who have their own page", async () => {
        const top = header(await render({ ...companies, [CURRENT]: listed([person()]) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.all_users}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.all_users_hint)}</p>`)
        expect(top).toMatch(new RegExp(`<a class="ui-btn ui-btn-secondary" href="/dashboard/super-admins">.*${en.super_admins}</a>`))
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()]) }, { viewer: { id: "a1", role: "ADMIN", companyId: "c1" } })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("opens on the people at work, and those who've left are a tab kept in the address", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()]) })
        expect(state.keys).toContain(CURRENT)
        expect(html).toContain(`<a class="ui-tab" aria-current="page" href="/dashboard/all-users">${en.all_users_tab_current}</a>`)
        expect(html).toContain(`<a class="ui-tab" href="/dashboard/all-users?show=left">${en.all_users_tab_left}</a>`)
        await render({ ...companies, [LEFT]: listed([]) }, { search: "show=left" })
        expect(state.keys).toContain(LEFT)
    })

    it("finds someone by name, email or company, and narrows to one company, each control labelled", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()]) })
        expect(html).toContain('class="ui-panel ui-filterbar"')
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-visually-hidden">${en.all_users_search}</label>`))
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-visually-hidden">${en.company_label}</label>`))
        expect(html).toContain(`<option value="" selected="">${en.all_users_any_company}</option><option value="c1">Delta Sites</option><option value="c2">Nile Works</option>`)
    })

    it("lists each person with their company, username, role, points and whether they're online, their name opening their profile", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([
            person(),
            person({ id: "u2", firstName: "Mona", lastName: "Hany", email: "mona@nile.test", username: null, role: "ADMIN", status: "OFFLINE", company: { id: "c2", name: "Nile Works" } }),
            person({ id: "u3", firstName: "Omar", lastName: "Said", role: "TEAM_LEADER", status: "SUSPENDED", company: null, totalDifficultyPoints: -3 }),
        ]) })
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.all_users}</caption>`)
        for (const column of [en.name_label, en.company_label, en.username_label, en.role_label, en.points_label, en.status_label]) expect(html, column).toContain(`<th scope="col">${column}</th>`)
        expect(html).toContain('<a class="ui-item-link" href="/dashboard/employees/u1?mode=view">Youssef Adel</a>')
        expect(html).toContain("<bdi>youssef@delta.test</bdi>")
        expect(html).toContain("<bdi>Delta Sites</bdi>")
        expect(html).toContain(en.all_users_no_company)
        expect(html).toContain("<bdi>youssef.adel</bdi>")
        expect(html).toContain(en.role_employee)
        expect(html).toContain(en.role_admin)
        expect(html).toContain(en.role_team_leader)
        expect(html).toContain('<span class="ui-chip">12 pts</span>')
        expect(html).toContain('<span class="ui-chip">-3 pts</span>')
        expect(html.match(/<span class="ui-chip">/g)).toHaveLength(4)
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${en.status_online}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.status_offline}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-problem">${en.status_suspended}</span>`)
        expect(html).toContain('<ul class="ui-cards"')
    })

    it("says how many in the pager, with its pages when there's more than one", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()], { total: 23, totalPages: 3 }) })
        expect(html).toContain("23 employees")
        expect(html).toContain(`aria-label="${en.ui_page_of.replace("{page}", "1").replace("{pages}", "3")}"`)
    })

    it("lists those who've left by the email they had, where they were and as what, with Delete for good in a menu", async () => {
        const html = await render({ ...companies, [LEFT]: listed([
            person({ id: "g1", firstName: "Ghost", lastName: "User", email: "sara@delta.test_DELETED_1793000000000", username: "deleted_1793000000000", status: "DELETED" }),
        ]) }, { search: "show=left" })
        expect(html).toContain('<a class="ui-item-link" href="/dashboard/employees/g1?mode=view"><bdi>sara@delta.test</bdi></a>')
        expect(html).not.toContain("Ghost User")
        expect(html).not.toContain("deleted_1793000000000")
        expect(html).not.toContain("_DELETED_")
        expect(html).toContain("<bdi>Delta Sites</bdi>")
        expect(html).toContain(en.role_employee)
        const menu = state.menus.find(m => m.label === en.ui_more_actions_for.replace("{name}", "sara@delta.test"))!
        expect(menu.items.map(i => [i.key, i.label, i.danger])).toEqual([["delete", en.all_users_delete_for_good, true]])
    })

    it("asks before deleting someone for good, named for them, and says the server's reason when it won't", () => {
        const source = readFileSync("app/(dashboard)/dashboard/all-users/page.tsx", "utf8")
        expect(source).toMatch(/<DeleteTemplateDialog[\s\S]*?name=\{emailOf\(removing\)\}[\s\S]*?body=\{t\('all_users_delete_body'\)\}/)
        expect(source).toContain("fetch(`/api/users?id=${encodeURIComponent(u.id)}&permanent=true`, { method: 'DELETE' })")
        expect(source).toContain("showToast(await refusalOf(res, t('error_generic')), 'error')")
    })

    it("says when there's no one, and when no one matches, and while they load, and when they didn't, with the server's reason and Try again", async () => {
        expect(await render({ ...companies, [CURRENT]: listed([]) })).toContain(`class="ui-empty-title">${esc(en.all_users_none)}<`)
        expect(await render({ ...companies, [LEFT]: listed([]) }, { search: "show=left" })).toContain(`class="ui-empty-title">${esc(en.all_users_left_none)}<`)
        const source = readFileSync("app/(dashboard)/dashboard/all-users/page.tsx", "utf8")
        expect(source).toContain("search || companyId")
        expect(source).toContain("'all_users_none_match'")
        expect(await render(companies)).toContain('<div class="ui-panel" role="status">')
        const html = await render({ ...companies, [CURRENT]: failed })
        expect(html).toContain(esc(en.all_users_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("says a failed search, tab or page didn't load, not the rows kept from the one before", async () => {
        const html = await render({ ...companies, [LEFT]: { retained: listed([person()]), error: failed.error } }, { search: "show=left" })
        expect(html).toContain(esc(en.all_users_load_failed))
        expect(html).not.toContain("Youssef Adel")
    })

    it("keeps no rows from the other tab or another company up while the next ones load, so Delete for good is never on someone it isn't for (Codex on PR 173)", async () => {
        // The people at work, kept from the tab before: the Left tab says it's loading, not them.
        const html = await render({ ...companies, [LEFT]: { retained: { ...listed([person()]), scope: "at-work/" } } }, { search: "show=left" })
        expect(html).toContain('<div class="ui-panel" role="status">')
        expect(html).not.toContain("Youssef Adel")
        expect(state.menus).toEqual([])
        const source = readFileSync("app/(dashboard)/dashboard/all-users/page.tsx", "utf8")
        expect(source).toContain("const scope = `${left ? 'left' : 'at-work'}/${companyId}`")
        expect(source).toContain("useSWR(scopedKey(listUrl, scope), scopedFetcher, { keepPreviousData: true })")
        expect(source).toContain("forScope(data, scope)?.data")
    })

    it("goes back to page 1 when what's asked changes, and to the last page there is when the pages it's on are gone", () => {
        const source = readFileSync("app/(dashboard)/dashboard/all-users/page.tsx", "utf8")
        expect(source).toContain("useAdjustOnChange([filters], () => setPage(1))")
        expect(source).toContain("useAdjustOnChange([pageCount], () => { if (pageCount !== undefined) setPage(p => pageInRange(p, pageCount)) })")
    })

    it("says a person's status in the words and colours the Employees list does, from one place", () => {
        const shared = readFileSync("lib/person-status.ts", "utf8")
        expect(shared).toContain("export const STATUS_TONE")
        expect(shared).toContain("export const STATUS_WORD")
        for (const file of ["app/(dashboard)/dashboard/all-users/page.tsx", "app/(dashboard)/dashboard/employees/page.tsx"]) {
            expect(readFileSync(file, "utf8"), file).toContain("from '@/lib/person-status'")
        }
    })

    it("says it in Arabic", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()]) }, { locale: "ar" })
        expect(html).toContain(ar.all_users_tab_current)
        expect(html).toContain(ar.status_online)
    })
})

describe("how many at work have each status (LATER_CHANGES_PLAN.md §6, PR 384)", () => {
    const COUNTS = { statusCounts: { ACTIVE: 3, OFFLINE: 9, SUSPENDED: 1, ARCHIVED: 0 } }
    const ONLINE_ONLY = "/api/users?page=1&limit=10&status=ACTIVE&companyId=&search=&counts=status"
    const pill = (tone: string, word: string, count: string, pressed = false) =>
        `<button type="button" class="ui-status-count ui-badge-${tone}" aria-pressed="${pressed}">${pressed ? '<svg' : '<span>'}`
            + (pressed ? "" : `${word}</span><span class="ui-status-count-n">${count}</span></button>`)

    it("asks for the counts on the At work tab, and not on Left", async () => {
        await render({ ...companies, [CURRENT]: listed([person()], COUNTS) })
        expect(state.keys).toContain(CURRENT)
        await render({ ...companies, [LEFT]: listed([]) }, { search: "show=left" })
        expect(state.keys).toContain(LEFT)
        expect(state.keys.filter(k => k?.includes("counts="))).toEqual([])
    })

    it("has a pill for each status with how many, at 0 too, in the list's order and its badge colours, between the tabs and the filter bar", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()], COUNTS) })
        expect(html).toContain(`<div role="group" aria-label="${en.all_users_by_status}" class="ui-status-counts-row">`)
        const pills = [pill("good", en.status_online, "3"), pill("neutral", en.status_offline, "9"), pill("problem", en.status_suspended, "1"), pill("neutral", en.status_archived, "0")]
        const at = pills.map(p => html.indexOf(p))
        expect(at.every(i => i > 0)).toBe(true)
        expect([...at].sort((a, b) => a - b)).toEqual(at)
        expect(html.indexOf('class="ui-tablinks') < html.indexOf("ui-status-counts")).toBe(true)
        expect(html.indexOf("ui-status-counts") < html.indexOf("ui-filterbar")).toBe(true)
        expect(html).not.toContain(en.all_users_show_everyone)
    })

    it("has none until the counts come, and none on the Left tab", async () => {
        expect(await render({ ...companies, [CURRENT]: listed([person()]) })).not.toContain("ui-status-counts")
        expect(await render({ ...companies, [LEFT]: listed([], COUNTS) }, { search: "show=left" })).not.toContain("ui-status-counts")
        // A status in the address is the At work tab's: Left still lists everyone who left.
        await render({ ...companies, [LEFT]: listed([], COUNTS) }, { search: "show=left&status=ACTIVE" })
        expect(state.keys).toContain(LEFT)
    })

    it("shows only the status pressed, kept in the address, with a line saying so and Show everyone", async () => {
        const html = await render({ ...companies, [ONLINE_ONLY]: listed([person()], COUNTS) }, { search: "status=ACTIVE" })
        expect(state.keys).toContain(ONLINE_ONLY)
        expect(html).toContain(pill("good", en.status_online, "3", true))
        expect(html).toMatch(new RegExp(`aria-pressed="true"><svg[^>]*aria-hidden="true"[^>]*>.*?</svg><span>${en.status_online}</span><span class="ui-status-count-n">3</span></button>`))
        expect(html).toContain(pill("neutral", en.status_offline, "9"))
        expect(html).toContain(`<p class="ui-hint ui-status-counts-line" role="status">${en.all_users_showing_status.replace("{status}", "online")} <button type="button" class="ui-btn ui-btn-quiet ui-btn-sm">${en.all_users_show_everyone}</button></p>`)
    })

    it("takes no status from the address it doesn't count", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()], COUNTS) }, { search: "status=DELETED" })
        expect(state.keys).toContain(CURRENT)
        expect(html).not.toContain('aria-pressed="true"')
    })

    it("says them in Arabic, with Arabic digits", async () => {
        const html = await render({ ...companies, [CURRENT]: listed([person()], COUNTS) }, { locale: "ar" })
        expect(html).toContain(`aria-label="${ar.all_users_by_status}"`)
        expect(html).toContain(`<span>${ar.status_online}</span><span class="ui-status-count-n">٣</span>`)
        expect(html).toContain(`<span>${ar.status_archived}</span><span class="ui-status-count-n">٠</span>`)
    })

    it("presses by the address, starting again from page 1, and hears every company the picker lists while none is picked", () => {
        const source = readFileSync("app/(dashboard)/dashboard/all-users/page.tsx", "utf8")
        expect(source).toContain("router.replace(next ? `${pathname}?status=${next}` : pathname, { scroll: false })")
        expect(source).toContain("const filters = `${left}/${companyId}/${search}/${status}`")
        expect(source).toContain("onlineTopics(viewer, companyId || null, [...companies.map(c => c.id), ...(listed?.data ?? []).map(p => p.company?.id)])")
        // A pill pressed again lets go: everyone again.
        const block = readFileSync("components/ui/StatusCounts.tsx", "utf8")
        expect(block).toContain("onClick={() => onPress(on ? null : item.key)}")
    })
})

describe("nothing of the old page is left", () => {
    it("has no inline styles, old windows, spinner, pager, filter, profile form, header title, drawn icons or words in code", () => {
        const source = readFileSync("app/(dashboard)/dashboard/all-users/page.tsx", "utf8")
        expect(source).not.toContain("style={")
        expect(source).not.toMatch(/@\/components\/(Modal|ConfirmModal|LoadingSpinner|Pagination|EmployeeFilter|EmployeeProfileForm)'/)
        expect(source).not.toMatch(/className="(input|btn|glass)/)
        expect(source).not.toContain("useHeader")
        expect(source).not.toContain("<svg")
        expect(source).not.toMatch(/[🗑️✅⛔]/u)
        expect(source).not.toMatch(/\bas any\b/)
        expect(source).not.toMatch(/locale === 'ar' \? '/)
        expect(source).not.toContain(" · ")
    })

    it("has every word it says in both languages, and none of the old page's own", () => {
        const said = [
            "all_users_hint", "all_users_tabs", "all_users_tab_current", "all_users_tab_left", "all_users_search", "all_users_any_company",
            "all_users_no_company", "all_users_none", "all_users_none_match", "all_users_left_none", "all_users_load_failed",
            "all_users_delete_for_good", "all_users_delete_body", "all_users_deleted",
            "all_users_by_status", "all_users_showing_status", "all_users_show_everyone",
        ]
        for (const key of said) {
            expect(en, key).toHaveProperty(key)
            expect(ar, key).toHaveProperty(key)
            expect(ar[key as keyof typeof ar], key).not.toBe(en[key as keyof typeof en])
        }
        expect(en.all_users).toBe("All users")
        const gone = [
            "all_users_subtitle", "super_administrators_label", "ex_users_label", "deleted_users_archive_msg", "view_archive_button",
            "ex_users_archive_title", "previously_label", "profile_label", "view_profile_button", "no_users_found_company",
            "no_companies_found_matching", "no_company_label", "status_banned",
        ]
        for (const key of gone) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
