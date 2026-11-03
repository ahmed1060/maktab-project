import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Usernames on the building blocks (UI_PLAN.md §5 step 5, the pages left):
 * cards of its own making, its sides chosen by hand for each language, its
 * title set into the top bar, a download button that was two emoji, and a
 * failure to load said as "No employees found".
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "a1", role: "ADMIN" } as Record<string, unknown>,
    perms: new Set<string>(),
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (k: string) => state.perms.has(k) }), useViewer: () => state.viewer }))
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

const PAGE = "app/(dashboard)/dashboard/usernames/page.tsx"
const URL = "/api/users?limit=1000"
const PEOPLE = [
    { id: "u1", firstName: "Mona", lastName: "Adel", role: "EMPLOYEE", username: "mona.a" },
    { id: "u2", firstName: "Karim", lastName: "Fawzy", role: "TEAM_LEADER", username: "karim.f" },
    { id: "u3", firstName: "Hana", lastName: "Saad", role: "ADMIN", username: null },
]

let Page: () => ReactElement
beforeAll(async () => { Page = (await import("@/app/(dashboard)/dashboard/usernames/page")).default })
beforeEach(() => {
    state.locale = "en"
    state.perms = new Set(["employees.view"])
    state.swr = { [URL]: { data: { data: { data: PEOPLE } } } }
    state.keys = []
})
const render = () => renderToStaticMarkup(h(Page))
/** As React writes text into the page. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")

describe("Usernames on the building blocks", () => {
    it("has nothing left of its own making: no inline styles, sides, emoji, spinner or top-bar title", () => {
        const src = readFileSync(PAGE, "utf8")
        expect(src).not.toContain("style=")
        expect(src).not.toContain("direction")
        expect(src).not.toMatch(/📊|📥/u)
        expect(src).not.toContain("LoadingSpinner")
        expect(src).not.toContain("useHeader")
        expect(src).not.toContain("as any")
    })

    it("has the page header, with the download as a labelled button", () => {
        const html = render()
        expect(html).toContain('<h1 class="ui-page-title">Usernames</h1>')
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.usernames_subtitle)}</p>`)
        expect(html).toMatch(/<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-secondary">.*Download Excel<\/button><\/div>/)
    })

    it("lists each person with their role and username, the username kept as typed", () => {
        const html = render()
        expect(html).toContain(`<caption class="ui-visually-hidden">Usernames</caption>`)
        for (const header of ["Name", "Role", "Username"]) expect(html).toContain(`<th scope="col">${header}</th>`)
        expect(html).toContain("Mona Adel")
        expect(html).toContain(en.role_team_leader)
        expect(html).toContain('<bdi translate="no">mona.a</bdi>')
        // Somebody without one is said so, where it was a dash.
        expect(html).toContain(en.usernames_none)
        // And each as a card on a phone.
        expect(html).toContain('<ul class="ui-cards" aria-label="Usernames">')
    })

    it("can be searched by name or username", async () => {
        const html = render()
        expect(html).toMatch(new RegExp(`<input[^>]*type="search"[^>]*placeholder="${en.usernames_search}"`))
        const { matches } = await import("@/lib/usernames-list")
        expect(PEOPLE.filter(p => matches(p, "mona")).map(p => p.id)).toEqual(["u1"])
        expect(PEOPLE.filter(p => matches(p, "  KARIM.F ")).map(p => p.id)).toEqual(["u2"])
        expect(PEOPLE.filter(p => matches(p, "saad")).map(p => p.id)).toEqual(["u3"])
        expect(PEOPLE.filter(p => matches(p, "")).length).toBe(3)
    })

    it("says it's loading, as a status, and when it couldn't load, with Try again, where both read \"No employees found\"", () => {
        state.swr = {}
        expect(render()).toMatch(/<div class="ui-panel" role="status">.*Loading…/)
        state.swr = { [URL]: { error: new Error("down") } }
        const failed = render()
        expect(failed).toContain(esc(en.usernames_load_failed))
        expect(failed).toContain(">Try again</button>")
        expect(failed).not.toContain(en.no_employees_found)
    })

    it("says when there's nobody, and offers nothing to download", () => {
        state.swr = { [URL]: { data: { data: { data: [] } } } }
        const html = render()
        expect(html).toContain(esc(en.usernames_empty))
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-secondary" disabled="">.*Download Excel/)
    })

    it("tells somebody who may not see people so, and asks nothing of the server, where it asked and said it failed", () => {
        state.perms = new Set()
        const html = render()
        expect(html).toContain("data-denied")
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("says it in Arabic", () => {
        state.locale = "ar"
        const html = render()
        expect(html).toContain(`<h1 class="ui-page-title">${ar.usernames}</h1>`)
        expect(html).toContain(ar.role_employee)
        expect(html).toContain(ar.usernames_search)
    })
})

describe("The Excel file", () => {
    it("has a row for each person, their role in the reader's language and an empty cell for no username", async () => {
        const { sheetRows } = await import("@/lib/usernames-list")
        const roleWord = (r: string) => ({ EMPLOYEE: "Employee", TEAM_LEADER: "Team leader", ADMIN: "Admin" } as Record<string, string>)[r]
        expect(sheetRows(PEOPLE, roleWord)).toEqual([
            { name: "Mona Adel", role: "Employee", username: "mona.a" },
            { name: "Karim Fawzy", role: "Team leader", username: "karim.f" },
            { name: "Hana Saad", role: "Admin", username: "" },
        ])
    })

    it("is named for the day where it was downloaded, where it took the day in London", async () => {
        const { fileName } = await import("@/lib/usernames-list")
        // 23:30 in London is the next day in Cairo.
        expect(fileName("Usernames", new Date("2026-11-03T23:30:00Z"), "Africa/Cairo")).toBe("Usernames 2026-11-04.xlsx")
        expect(fileName("أسماء المستخدمين", new Date("2026-11-03T10:00:00Z"), "Africa/Cairo")).toBe("أسماء المستخدمين 2026-11-03.xlsx")
    })

    it("says when it couldn't be made, where it failed without a word", () => {
        const src = readFileSync(PAGE, "utf8")
        expect(src).toContain("showToast(t('usernames_export_failed'), 'error')")
        expect(en.usernames_export_failed).toBeTruthy()
        expect(ar.usernames_export_failed).toBeTruthy()
    })

    it("has its words in both languages", () => {
        for (const key of ["usernames_none", "usernames_search", "usernames_load_failed", "usernames_empty", "usernames_no_match", "usernames_export_failed"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })
})

describe("Usernames, found in the browser", () => {
    it("puts the focus back in the search when Clear search clears it, where it fell to the page as the button went", () => {
        expect(render()).toMatch(/<input[^>]*type="search"[^>]*name="q"/)
        const src = readFileSync(PAGE, "utf8")
        expect(src).toContain(`onClick={() => { setQuery(''); document.querySelector<HTMLElement>('[name="q"]')?.focus() }}`)
    })
})

describe("Usernames, found in the web interface audit", () => {
    it("ends its search's example with an ellipsis, as the employees list's does", () => {
        expect(en.usernames_search).toBe("Search by name or username…")
        expect(ar.usernames_search.endsWith("…")).toBe(true)
    })

    it("says out loud how many a search finds, where the list changed without a word", () => {
        const src = readFileSync(PAGE, "utf8")
        expect(src).toContain(`<span className="ui-visually-hidden" aria-live="polite">{query.trim() && people ? countOf(t, locale, shown.length, 'employees') : ''}</span>`)
        // Nothing said before anything is searched.
        expect(render()).toContain('<span class="ui-visually-hidden" aria-live="polite"></span>')
    })
})
