import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The last of the old loading spinner (UI_PLAN.md §5 step 5, the pages left):
 * a ring of its own making with "Loading data..." beside it, which stood in
 * for the whole page while it loaded. Each place says it's loading the
 * building blocks' way now, as every other page does: the panel with the
 * hourglass and "Loading…", which a screen reader hears, inside the page's
 * own frame, so its header and filters are there from the start.
 */

type Given = { data?: unknown; error?: unknown; isLoading?: boolean; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: null as Record<string, unknown> | null,
    // The session hook, which has nothing on the first paint.
    sessionLoading: false,
    swr: {} as Record<string, Given>,
    keys: [] as unknown[],
}
const ADMIN = { id: "a1", role: "ADMIN", companyId: "c1", grants: [] }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>

vi.mock("next-auth/react", () => ({
    useSession: () => state.sessionLoading
        ? { data: null, status: "loading", update: async () => null }
        : { data: state.viewer ? { user: state.viewer } : null, status: state.viewer ? "authenticated" : "unauthenticated", update: async () => null },
}))
vi.mock("@/lib/useCan", () => ({
    // The layout's copy on the first paint, as the real one gives.
    useViewer: () => state.viewer,
    useCan: () => ({ can: () => !!state.viewer, companyWide: () => !!state.viewer, scope: () => (state.viewer ? "COMPANY" : null), canFor: () => !!state.viewer }),
}))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next/navigation", () => ({
    useParams: () => ({ id: "client-1" }),
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard",
}))
vi.mock("swr", () => ({
    // Asked for and not back yet, unless a test gives what came back.
    default: (key: unknown) => {
        state.keys.push(key)
        const url = Array.isArray(key) ? key[0] : key
        const given = typeof url === "string" ? state.swr[url] : undefined
        return { data: undefined, error: undefined, isLoading: !!key, isValidating: !!key, mutate: async () => {}, ...given }
    },
    useSWRConfig: () => ({ mutate: () => {} }),
}))
// What a page holds once it has loaded isn't what these are about.
vi.mock("@/components/cash-advances/CashAdvanceHistory", () => ({ default: () => h("p", null, "the history") }))
vi.mock("@/components/locations/LocationsList", () => ({ default: () => null }))
vi.mock("@/components/charges/ChargesList", () => ({ default: () => null }))
vi.mock("@/components/records/RecordsList", () => ({ default: () => null }))
vi.mock("@/components/records/SectionsCard", () => ({ default: () => null }))

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const literal = (text: string) => esc(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** The building blocks' loading panel, saying this. */
const loadingPanel = (text: string) =>
    new RegExp(`<div class="ui-panel" role="status"><div class="ui-empty">(?:(?!</div>).)*<p class="ui-empty-title">${literal(text)}</p></div></div>`, "s")
const title = (text: string) => `<h1 class="ui-page-title">${esc(text)}</h1>`

let Loading: () => ReactElement
let Employees: () => ReactElement
let Client: () => ReactElement
let MyAdvance: () => ReactElement
beforeAll(async () => {
    Loading = (await import("@/app/(dashboard)/dashboard/loading")).default
    Employees = (await import("@/app/(dashboard)/dashboard/employees/page")).default
    Client = (await import("@/app/(dashboard)/dashboard/clients/[id]/page")).default
    MyAdvance = (await import("@/app/(dashboard)/dashboard/cash-advances/mine/page")).default
})
beforeEach(() => {
    state.locale = "en"
    state.viewer = { ...ADMIN }
    state.sessionLoading = false
    state.swr = {}
    state.keys = []
})
const render = (page: () => ReactElement) => renderToStaticMarkup(h(page))

describe("the old spinner", () => {
    it("is gone, and nothing waits behind it", () => {
        expect(existsSync("components/LoadingSpinner.tsx")).toBe(false)
        // Anywhere in the code: the language's own switch used it too.
        const users = execSync("git grep -l -e LoadingSpinner -- ':!*.test.ts' ':!*.md' || true").toString().trim()
        expect(users).toBe("")
    })

    it("takes its words with it, 'Loading data...' with three dots and 'Loading users…'", () => {
        for (const key of ["loading_data", "loading_users"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})

describe("while the language changes", () => {
    // The whole screen says so for the moment it takes, so the old language
    // and the new never show side by side, as the old spinner's screen did.
    it("covers the screen in the page's colour, with the building blocks' block, which a screen reader hears", () => {
        const src = readFileSync("context/LanguageContext.tsx", "utf8")
        expect(src).toContain(`{isChangingLocale && <div className="ui-switching" role="status"><EmptyState icon={HourglassIcon} title={t('loading')} /></div>}`)
        // Not through the blocks' index, whose dialog asks this provider for its words.
        expect(src).toContain("import { EmptyState } from '@/components/ui/Blocks'")
        const css = readFileSync("components/ui/ui.css", "utf8")
        const start = css.indexOf("\n.ui-switching {")
        expect(start).toBeGreaterThan(-1)
        const rule = css.slice(start, css.indexOf("}", start))
        for (const decl of ["position: fixed;", "inset: 0;", "background: var(--page);"]) expect(rule).toContain(decl)
    })
})

describe("while a page of the dashboard is on its way", () => {
    it("says it's loading in a panel, where the page will be", () => {
        const html = render(Loading)
        expect(html.startsWith('<div class="ui-page">')).toBe(true)
        expect(html).toMatch(loadingPanel(en.loading))
    })

    it("says so in Arabic too", () => {
        state.locale = "ar"
        expect(render(Loading)).toMatch(loadingPanel(ar.loading))
    })
})

describe("the Employees list, while its people load", () => {
    it("keeps its header and filters, and says it's loading where the list goes", () => {
        const html = render(Employees)
        expect(html).toContain(title(en.employees))
        expect(html).toContain(`placeholder="${esc(en.employees_search)}"`)
        expect(html).toMatch(loadingPanel(en.loading))
        // Not the whole page given over to it, and not that there's nobody.
        expect(html.indexOf(title(en.employees))).toBeLessThan(html.search(loadingPanel(en.loading)))
        expect(html).not.toContain(esc(en.no_employees_found))
    })
})

describe("a client's page, while it loads", () => {
    it("says so under its header and back link, as it does when it doesn't load", () => {
        const html = render(Client)
        expect(html).toMatch(/<a(?=[^>]*class="ui-back-link")(?=[^>]*href="\/dashboard\/clients")[^>]*>/)
        expect(html).toContain(title(en.clients))
        expect(html).toMatch(loadingPanel(en.loading))
    })

    it("is in its frame on the first paint, before the session hook has loaded", () => {
        // The layout says who's looking from the start; the session hook comes a moment later.
        state.sessionLoading = true
        const html = render(Client)
        expect(html).toMatch(/class="ui-back-link"/)
        expect(html).toMatch(loadingPanel(en.loading))
    })
})

describe("My cash advance, before it knows whose", () => {
    it("is in the frame its history shows while it loads, so nothing moves when it comes", () => {
        state.viewer = null
        const html = render(MyAdvance)
        expect(html).toContain(title(en.my_cash_advance))
        expect(html).toMatch(loadingPanel(en.advances_loading))
        expect(html).not.toContain("the history")
    })

    it("shows the history once it knows", () => {
        expect(render(MyAdvance)).toContain("the history")
    })
})

describe("a person's profile, while it loads", () => {
    it("says so in the building blocks' panel", () => {
        const src = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
        expect(src).toMatch(/if \(loading\) \{?\s*return <div className="ui-panel" role="status"><EmptyState icon=\{HourglassIcon\} title=\{t\('loading'\)\} \/><\/div>/)
    })
})
