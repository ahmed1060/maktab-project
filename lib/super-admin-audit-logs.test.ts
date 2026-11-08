import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, Operations part 2
 * (UI_PLAN.md §5 step 5): the audit log, every sensitive change, who made it
 * and when, found by what it was on, what was done, who did it and when.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean; retained?: { data?: unknown; scope?: string } }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "sa1", role: "SUPER_ADMIN" } as Record<string, unknown> | null,
    search: "",
    company: "",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.viewer ? { user: state.viewer } : null, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer, useCan: () => ({ can: () => true }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search), usePathname: () => "/dashboard/audit-logs", useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company || null }) }))
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
        const data = loaded.retained ? tagged(loaded.retained.data, "/api/admin/audit-logs?an-earlier-request", loaded.retained.scope) : tagged(loaded.data, url ?? "")
        return { error: undefined, isValidating: false, mutate: async () => {}, ...loaded, data }
    },
}))

const PAGE = "app/(dashboard)/dashboard/audit-logs/page.tsx"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
const ok = (data: unknown) => ({ data: { data } })

function render(swr: Record<string, Loaded>, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null; search?: string; company?: string } = {}) {
    Object.assign(state, { swr, keys: [], locale: options.locale ?? "en", search: options.search ?? "", company: options.company ?? "" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN" } : options.viewer
    vi.stubGlobal("document", { body: {} })
    return import("@/app/(dashboard)/dashboard/audit-logs/page").then(({ default: AuditLogsPage }) => {
        try {
            return renderToStaticMarkup(h(AuditLogsPage))
        } finally {
            vi.unstubAllGlobals()
        }
    })
}

beforeAll(async () => {
    await import("@/app/(dashboard)/dashboard/audit-logs/page")
}, 120000)

const LIST = "/api/admin/audit-logs?page=1&limit=20"
const USERS = "/api/users?limit=1000"
const ADMINS = "/api/super-admins?page=1&limit=100"
const people = {
    [USERS]: ok({ data: [{ id: "u1", firstName: "Youssef", lastName: "Adel", role: "EMPLOYEE", company: { id: "c1", name: "Delta Sites" } }, { id: "u2", firstName: "Mona", lastName: "Hany", role: "ADMIN", company: null }] }),
    [ADMINS]: ok({ data: [{ id: "sa1", firstName: "Super", lastName: "Admin" }] }),
}
const entry = (e: Record<string, unknown> = {}) => ({
    id: "a1", action: "UPDATE_TASK", entityType: "TASK", entityId: "task-123", userId: "u1", superAdminId: null,
    details: { status: { old: "PENDING", new: "IN_PROGRESS" } }, createdAt: "2026-11-02T08:57:00.000Z",
    user: { firstName: "Youssef", lastName: "Adel", email: "youssef@delta.test", role: "EMPLOYEE" }, ...e,
})
const listed = (rows: unknown[], extra: Record<string, unknown> = {}) => ok({ data: rows, total: rows.length, page: 1, totalPages: 1, ...extra })
const when = (iso: string, locale: "en" | "ar" = "en") => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))

describe("the Audit logs page", () => {
    it("has the page header, its name in sentence case, and leaves the old top bar's title alone", async () => {
        const top = header(await render({ ...people, [LIST]: listed([entry()]) }))
        expect(en.audit_logs).toBe("Audit logs")
        expect(top).toContain(`<h1 class="ui-page-title">${en.audit_logs}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.audit_logs_subtitle)}</p>`)
        expect(readFileSync(PAGE, "utf8")).not.toContain("useHeader")
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await render({ ...people, [LIST]: listed([entry()]) }, { viewer: { id: "a1", role: "ADMIN", companyId: "c1" } })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("finds entries by item ID or error code, who did it, what it was on, what was done and when, each control labelled", async () => {
        const html = await render({ ...people, [LIST]: listed([entry()]) })
        expect(html).toContain('class="ui-panel ui-filterbar"')
        for (const label of [en.audit_search, en.audit_by, en.audit_item, en.audit_what]) {
            expect(html, label).toMatch(new RegExp(`<label for="[^"]+" class="ui-visually-hidden">${esc(label)}</label>`))
        }
        expect(html).toContain(`placeholder="${esc(en.audit_search)}"`)
        // The Super Admins too, whose entries were found by none of the old list's names.
        expect(html).toContain(`<option value="" selected="">${en.audit_by_anyone}</option>`)
        expect(html).toMatch(new RegExp(`<optgroup label="${en.super_admins}"><option value="sa1">Super Admin</option></optgroup>`))
        expect(html).toMatch(new RegExp(`<optgroup label="${en.audit_by_people}"><option value="u2">Mona Hany</option><option value="u1">Youssef Adel \\(Delta Sites\\)</option></optgroup>`))
        expect(html).toContain(`<option value="" selected="">${en.audit_any_item}</option>`)
        expect(html).toContain(`<option value="TASK">${en.audit_entity_TASK}</option>`)
        expect(html).toContain(`<option value="" selected="">${en.audit_any_action}</option>`)
        expect(html).toContain(`<optgroup label="${en.audit_kinds}"><option value="CREATE">${en.audit_action_CREATE}</option>`)
        expect(html).toContain(`<optgroup label="${en.audit_actions}">`)
        expect(html).toContain(`<option value="UPDATE_TASK">${en.audit_action_UPDATE_TASK}</option>`)
    })

    it("keeps what's picked in the address, so the dashboard's System errors link lands filtered, and the company the top bar picked", async () => {
        const start = "2026-11-02T06:00:00.000Z"
        const url = `/api/admin/audit-logs?page=2&limit=20&entityType=SYSTEM&action=SYSTEM_API_ERROR&startDate=${encodeURIComponent(start)}&entityId=9F3A21BC&performedById=u1&companyId=c1`
        const html = await render({ ...people, [url]: listed([entry()]) }, {
            search: `action=SYSTEM_API_ERROR&startDate=${encodeURIComponent(start)}&entityType=SYSTEM&entityId=9F3A21BC&performedById=u1&page=2`,
            company: "c1",
        })
        expect(state.keys).toContain(url)
        expect(html).toContain('value="9F3A21BC"')
        expect(html).toContain('<option value="SYSTEM_API_ERROR" selected="">')
        expect(html).toContain('<option value="u1" selected="">')
        const page = readFileSync(PAGE, "utf8")
        expect(page).toContain("useListAddress('/dashboard/audit-logs')")
        expect(page).toContain("useSearchField(")
    })

    it("lists each entry, when, what was done, what it was on, who did it and what changed", async () => {
        const html = await render({ ...people, [LIST]: listed([
            entry(),
            entry({ id: "a2", action: "DELETE_TASK", entityId: "task-9", userId: null, user: undefined, superAdminId: "sa1", superAdmin: { firstName: "Super", lastName: "Admin", email: "sa@x.test" }, details: null }),
            entry({ id: "a3", action: "SYSTEM_API_ERROR", entityType: "SYSTEM", entityId: "9F3A21BC", userId: null, user: undefined, details: { route: "/api/tasks" } }),
            entry({ id: "a4", action: "CREATE_TASK", entityId: "task-10" }),
        ]) })
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.audit_logs}</caption>`)
        for (const column of [en.audit_when, en.audit_what, en.audit_item, en.audit_by, en.details]) expect(html, column).toContain(`<th scope="col">${column}</th>`)
        expect(html).toContain(`<span class="ui-nowrap">${when("2026-11-02T08:57:00.000Z")}</span>`)
        // What was done, in its meaning's colour.
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.audit_action_UPDATE_TASK}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-problem">${en.audit_action_DELETE_TASK}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${en.audit_action_CREATE_TASK}</span>`)
        // What it was on, and its ID, a code kept as it is.
        expect(html).toContain(en.audit_entity_TASK)
        expect(html).toContain('<bdi dir="ltr" translate="no">task-123</bdi>')
        // Who: a person and their role, a Super Admin, or the system itself,
        // a name on one line, where "Super Admin" broke onto two (found in the browser).
        expect(html).toContain('<span class="ui-nowrap">Youssef Adel</span>')
        expect(html).toContain(en.audit_value_EMPLOYEE)
        expect(html).toContain(en.role_super_admin)
        expect(html).toContain(en.audit_by_system)
        expect(html).toContain(en.audit_by_automated)
        // What changed, in the reader's words.
        expect(html).toContain(`<ul class="ui-report">`)
        expect(html).toContain(`${en.audit_field_status}: </span>`)
        // Each side in its own direction, so a change reads the right way
        // round whatever its script (PR 233).
        expect(html).toContain(`<span class="ui-report-value"><bdi>${en.audit_value_PENDING}</bdi> → <bdi>${en.audit_value_IN_PROGRESS}</bdi></span>`)
        expect(html).toContain(`${en.audit_field_route}: </span><span class="ui-report-value">/api/tasks</span>`)
    })

    // "Vendors ← Customers" drew as one run left to right in an Arabic line,
    // the arrow pointing at the name it was (found in the browser, PR 233).
    it("draws each side of a change in its own direction, the arrow the page's way", async () => {
        const details = { moduleLabels: { old: { clients: "Vendors" }, new: { clients: "Customers" } } }
        const ar_ = await render({ ...people, [LIST]: listed([entry({ details })]) }, { locale: "ar" })
        expect(ar_).toContain(`<span class="ui-report-value"><bdi>Vendors</bdi> ← <bdi>Customers</bdi></span>`)
        const en_ = await render({ ...people, [LIST]: listed([entry({ details: { name: { old: "دلتا", new: "دلتا للمواقع" } } })]) })
        expect(en_).toContain(`<span class="ui-report-value"><bdi>دلتا</bdi> → <bdi>دلتا للمواقع</bdi></span>`)
    })

    it("shows an entry's first three short details, and the rest, such as a stack trace, behind a Show more", async () => {
        // In the order Postgres keeps them, shorter names first, so the stack
        // trace came before the message, and was shown where the message
        // waited behind Show more (found in the browser).
        const html = await render({ ...people, [LIST]: listed([entry({ details: { route: "/api/tasks", stack: "Error: boom\n    at run (task.ts:1)", method: "POST", message: "boom" } })]) })
        const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"))
        const cell = table.slice(table.indexOf('<ul class="ui-report">'))
        for (const field of [en.audit_field_route, en.audit_field_method, en.audit_field_message]) expect(cell.indexOf(field), field).toBeLessThan(cell.indexOf('<details class="ui-more">'))
        expect(cell).toContain(`<details class="ui-more"><summary>${en.audit_more.replace("{n}", "1")}</summary>`)
        expect(cell.indexOf(en.audit_field_stack)).toBeGreaterThan(cell.indexOf('<details class="ui-more">'))
        // Behind it, the shorter first: an error's message before its stack trace (found in the browser).
        const error = await render({ ...people, [LIST]: listed([entry({ details: { route: "/api/tasks", stack: "Error: boom\n" + "    at run (task.ts:1)\n".repeat(20), method: "POST", message: "Invalid call:\n\nno record found" } })]) })
        const hidden = error.slice(error.indexOf('<details class="ui-more">'), error.indexOf("</details>"))
        expect(hidden.indexOf(en.audit_field_message)).toBeGreaterThan(-1)
        expect(hidden.indexOf(en.audit_field_message)).toBeLessThan(hidden.indexOf(en.audit_field_stack))
        // A long line, or a field's own fields, is never one of the three.
        const long = await render({ ...people, [LIST]: listed([entry({ details: { note: "x".repeat(200), grants: { add: "tasks.view" }, title: "Fix the pump" } })]) })
        const longCell = long.slice(long.indexOf("<table"), long.indexOf("</table>"))
        expect(longCell.indexOf(en.audit_field_title)).toBeLessThan(longCell.indexOf('<details class="ui-more">'))
        expect(longCell).toContain(`<summary>${en.audit_more.replace("{n}", "2")}</summary>`)
        // Three or fewer, all shown.
        const short = await render({ ...people, [LIST]: listed([entry()]) })
        expect(short).not.toContain('<details class="ui-more">')
    })

    it("pages with how many there are, where it guessed from the pages", async () => {
        const html = await render({ ...people, [LIST]: listed([entry()], { total: 41, totalPages: 3 }) })
        expect(html).toContain("41 entries")
        expect(html).toContain('class="ui-pager"')
    })

    it("says when nothing has been logged, when nothing matches, while it loads, and when it failed", async () => {
        expect(await render({ ...people, [LIST]: listed([]) })).toContain(`<p class="ui-empty-title">${en.audit_none}</p>`)
        const filtered = "/api/admin/audit-logs?page=1&limit=20&action=DELETE"
        expect(await render({ ...people, [filtered]: listed([]) }, { search: "action=DELETE" })).toContain(`<p class="ui-empty-title">${en.audit_none_match}</p>`)
        // An ID or a code is found whole, which the field doesn't say: the next step, where none matches (the interface audit).
        const byId = "/api/admin/audit-logs?page=1&limit=20&entityId=9F3A"
        const none = await render({ ...people, [byId]: listed([]) }, { search: "entityId=9F3A" })
        expect(none).toContain(`<p class="ui-empty-detail">${esc(en.audit_search_whole)}</p>`)
        expect(en.audit_search_whole).toBeTruthy()
        const loading = await render(people)
        expect(loading).toContain('role="status"')
        expect(loading).toContain(en.loading)
        const failed = await render({ ...people, [LIST]: { error: Object.assign(new Error("x"), { status: 500, info: { error: "Database unavailable" } }) } })
        expect(failed).toContain(`<p class="ui-empty-title">${esc(en.audit_load_failed)}</p>`)
        expect(failed).toContain("Database unavailable")
        expect(failed).toContain(`>${en.try_again}</button>`)
    })

    it("keeps no rows from another filter up while the next ones load, only another page's", async () => {
        const rows = listed([entry()])
        const other = await render({ ...people, ["/api/admin/audit-logs?page=1&limit=20&action=DELETE"]: { retained: { data: rows.data, scope: "" } } }, { search: "action=DELETE" })
        expect(other).not.toContain("<table")
        expect(other).toContain('role="status"')
        const next = await render({ ...people, ["/api/admin/audit-logs?page=2&limit=20"]: { retained: { data: rows.data } } }, { search: "page=2" })
        expect(next).toContain("<table")
    })

    it("goes back to a page there is, where it was past the last, and to the first on another company (Codex on PR 175)", async () => {
        // Page 8, where the company the top bar picked has 3: it isn't "nothing has been logged", with no pager to go back by.
        const url = "/api/admin/audit-logs?page=8&limit=20&companyId=c2"
        const html = await render({ ...people, [url]: listed([], { total: 41, totalPages: 3 }) }, { search: "page=8", company: "c2" })
        expect(html).not.toContain(en.audit_none)
        expect(html).toContain('role="status"')
        const page = readFileSync(PAGE, "utf8")
        // To the last page there is, once the answer says how many.
        expect(page).toMatch(/useEffect\(\(\) => \{\s*if \(pastTheEnd\) go\(\{ page: String\(listed\.totalPages\) \}\)/)
        // Another company starts from its first page, as another filter does.
        expect(page).toMatch(/useAdjustOnChange\(\[selectedCompanyId\], \(\) => \{ if \(page !== 1\) go\(\{ page: '1' \}\) \}\)/)
    })

    it("writes dates and counts as Arabic does", async () => {
        const html = await render({ ...people, [LIST]: listed([entry()], { total: 41, totalPages: 3 }) }, { locale: "ar" })
        expect(html).toContain(`<h1 class="ui-page-title">${ar.audit_logs}</h1>`)
        expect(html).toContain(when("2026-11-02T08:57:00.000Z", "ar"))
        // An audit log's entries, where it took the cash advance's word, حركة, a movement of money (found in the browser).
        expect(html).toContain("٤١ إدخالًا")
        expect(html).not.toContain("حركة")
    })

    it("leaves the old filter, spinner, pager and styles typed in behind", () => {
        const page = readFileSync(PAGE, "utf8")
        for (const old of ["AuditLogFilter", "LoadingSpinner", "@/components/Pagination", "style={", "(t as any)", "locale === 'ar' ? 'النظام'"]) expect(page, old).not.toContain(old)
        expect(page).not.toMatch(/\bas any\b/)
        expect(existsSync("components/AuditLogFilter.tsx")).toBe(false)
    })
})
