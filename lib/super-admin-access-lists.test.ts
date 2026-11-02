import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, part 2a (UI_PLAN.md §5 step
 * 5): role change requests and access reviews. Each list serves both sides,
 * the Super Admin's own page and a company's Roles and access page, so both
 * move together.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    role: "SUPER_ADMIN",
    userId: "sa",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    menus: [] as { label: string; items: { key: string; label: string; danger?: boolean }[] }[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: state.userId, role: state.role } }, status: "authenticated" }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(""), usePathname: () => "/dashboard", useRouter: () => ({ replace: () => {}, push: () => {} }) }))
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

function render(element: Parameters<typeof renderToStaticMarkup>[0], swr: Record<string, Loaded> = {}, { locale = "en", role = "SUPER_ADMIN", userId = "sa" }: { locale?: "en" | "ar"; role?: string; userId?: string } = {}) {
    Object.assign(state, { swr, locale, role, userId, keys: [], menus: [] })
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}

const person = (firstName: string, lastName: string) => ({ firstName, lastName })
const request = (r: Record<string, unknown> = {}) => ({
    id: "q1", description: "Let collectors see tasks.", status: "OPEN", response: null, createdAt: "2026-10-28T09:00:00.000Z",
    company: { name: "Delta Sites" }, role: { id: "r1", name: "Collector", builtIn: null }, requestedBy: person("Mona", "Adel"), respondedBy: null, ...r,
})
const changes = async (props: Record<string, unknown>, swr: Record<string, Loaded>, options?: { locale?: "en" | "ar"; role?: string; userId?: string }) => {
    const { default: RoleChangeRequests } = await import("@/components/RoleChangeRequests")
    return render(h(RoleChangeRequests, { side: "superAdmin", ...props } as never), swr, options)
}
const OPEN_REQUESTS = "/api/role-change-requests?status=OPEN"
const ALL_REQUESTS = "/api/role-change-requests"
const ASSIGNABLE = "/api/roles/assignable"

describe("role change requests", () => {
    it("lets a company's Admin ask in a card of labelled fields, the role picked from the ones they may give", async () => {
        const html = await changes({ side: "company" }, { [ALL_REQUESTS]: ok([]), [ASSIGNABLE]: ok([{ id: "r1", name: "Collector", baseRole: "EMPLOYEE", builtIn: null, isDefault: false }]) }, { role: "ADMIN", userId: "a1" })
        expect(html).toContain(`<h2 class="ui-card-title">${en.role_changes_ask}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.role_changes_ask_hint)}</p>`)
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.role_changes_role}</label>`))
        expect(html).toContain(`<option value="" selected="">${en.role_changes_new_role}</option><option value="r1">Collector</option>`)
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.role_changes_description}</label>`))
        expect(html).toMatch(/<textarea[^>]*name="description"/)
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.role_changes_send}</button>`))
        // The Super Admin answers; they don't ask.
        expect(await changes({}, { [OPEN_REQUESTS]: ok([]) })).not.toContain(en.role_changes_ask)
    })

    it("says on Send what's wrong under the field, where Send was off without a word", async () => {
        const { askError } = await import("@/components/RoleChangeRequests")
        expect(askError("")).toBe("role_changes_description_required")
        expect(askError(" add ")).toBe("role_changes_description_required")
        expect(askError("Add a driver role")).toBeNull()
    })

    it("lists the requests in a card with the status to show in its head, open ones for the Super Admin and all for a company", async () => {
        const sa = await changes({}, { [OPEN_REQUESTS]: ok([]) })
        expect(sa).toContain(`<h2 class="ui-card-title">${en.role_changes_list}</h2>`)
        expect(sa).toMatch(new RegExp(`<label for="[^"]+" class="ui-visually-hidden">${en.status}</label>`))
        expect(sa).toContain(`<option value="OPEN" selected="">${en.role_change_OPEN}</option><option value="DONE">${en.role_change_DONE}</option><option value="DECLINED">${en.role_change_DECLINED}</option><option value="">${en.all_statuses}</option>`)
        const company = await changes({ side: "company" }, { [ALL_REQUESTS]: ok([]) }, { role: "ADMIN", userId: "a1" })
        expect(company).toContain(`<option value="" selected="">${en.all_statuses}</option>`)
        expect(company).toContain(`class="ui-empty-title">${en.role_changes_empty}<`)
    })

    it("makes each request a row: the role, its status as a badge, the company, who asked and when, what was asked and the response", async () => {
        const html = await changes({}, { [OPEN_REQUESTS]: ok([request(), request({ id: "q2", role: null, status: "DECLINED", response: "Use the Employee role." })]) })
        expect(html).toContain(`<span class="ui-item-title"><bdi>Collector</bdi> <span class="ui-badge ui-badge-waiting">${en.role_change_OPEN}</span></span>`)
        expect(html).toContain('<span class="ui-item-detail"><span><bdi>Delta Sites</bdi>, <bdi>Mona Adel</bdi>, <bdi>28 Oct 2026</bdi></span></span>')
        expect(html).toContain('<span class="ui-item-note"><bdi>Let collectors see tasks.</bdi></span>')
        expect(html).toContain(`<bdi>${en.role_changes_new_role}</bdi> <span class="ui-badge ui-badge-neutral">${en.role_change_DECLINED}</span>`)
        expect(html).toContain(`<span class="ui-item-note">${en.role_changes_response_line.replace("{text}", "<bdi>Use the Employee role.</bdi>")}</span>`)
        expect(html).not.toContain(" · ")
    })

    it("offers the Super Admin Mark done and Decline on an open request only, and a company nothing to do", async () => {
        await changes({}, { [OPEN_REQUESTS]: ok([request(), request({ id: "q2", status: "DONE" })]) })
        expect(state.menus).toHaveLength(1)
        expect(state.menus[0].label).toBe(en.ui_more_actions_for.replace("{name}", `Collector${en.list_separator}Delta Sites`))
        expect(state.menus[0].items.map(i => i.label)).toEqual([en.role_changes_done, en.role_changes_decline])
        expect(state.menus[0].items.at(-1)?.danger).toBe(true)
        await changes({ side: "company" }, { [ALL_REQUESTS]: ok([request()]) }, { role: "ADMIN", userId: "a1" })
        expect(state.menus).toHaveLength(0)
    })

    it("marks the request a notification opened", async () => {
        const html = await changes({ highlight: "q2" }, { [OPEN_REQUESTS]: ok([request(), request({ id: "q2" })]) })
        expect(html.match(/<li data-tone="selected">/g)).toHaveLength(1)
    })

    it("says while the requests load, and when they didn't, with the server's reason and Try again", async () => {
        expect(await changes({}, {})).toContain(`role="status"`)
        const html = await changes({}, { [OPEN_REQUESTS]: failed })
        expect(html).toContain(esc(en.role_changes_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("declines in the building blocks' dialog, with the request in view and the response required", async () => {
        const { DeclineDialog, responseError } = await import("@/components/RoleChangeRequests")
        expect(responseError("no")).toBe("role_changes_response_required")
        expect(responseError("Use the Employee role")).toBeNull()
        const html = render(h(DeclineDialog, { request: request(), onClose: () => {}, onDecline: async () => true } as never))
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`class="ui-dialog-title">${en.role_changes_decline_title}</h2>`)
        expect(html).toContain('<p class="ui-dialog-note"><bdi>Let collectors see tasks.</bdi></p>')
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.role_changes_response}</label>`))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-danger">${en.role_changes_decline}</button>`))
    })
})

const line = (l: Record<string, unknown> = {}) => ({
    id: "l1", userId: "u1", userName: "Karim Nabil", permission: "salary.view", scope: "COMPANY", roleName: "Accountants", roleBuiltIn: null,
    decision: null, note: null, answeredBy: null, answeredBySuperAdmin: null, ...l,
})
const review = (r: Record<string, unknown> = {}) => ({ id: "v1", status: "OPEN", createdAt: "2026-11-01T08:00:00.000Z", company: { name: "Delta Sites" }, lines: [line()], ...r })
const reviews = async (props: Record<string, unknown>, swr: Record<string, Loaded>, options?: { locale?: "en" | "ar"; role?: string; userId?: string }) => {
    const { default: AccessReviews } = await import("@/components/AccessReviews")
    return render(h(AccessReviews, { side: "superAdmin", ...props } as never), swr, options)
}
const OPEN_REVIEWS = "/api/access-reviews?status=OPEN"

describe("access reviews", () => {
    it("lists the reviews in a card with the status to show in its head", async () => {
        const html = await reviews({}, { [OPEN_REVIEWS]: ok([]) })
        expect(html).toContain(`<h2 class="ui-card-title">${en.access_review_list}</h2>`)
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-visually-hidden">${en.status}</label>`))
        expect(html).toContain(`<option value="OPEN" selected="">${en.access_review_open}</option><option value="">${en.all_statuses}</option>`)
        expect(html).toContain(`class="ui-empty-title">${en.access_review_empty}<`)
    })

    it("heads each review with its company and day for the Super Admin, its day for a company, and how many are left", async () => {
        const sa = await reviews({}, { [OPEN_REVIEWS]: ok([review({ lines: [line(), line({ id: "l2" })] })]) })
        expect(sa).toContain(`<h3 class="ui-subsection-title" id="review-v1">${en.access_review_company_opened.replace("{company}", "<bdi>Delta Sites</bdi>").replace("{date}", "1 Nov 2026")} <span class="ui-badge ui-badge-waiting">${en.access_review_remaining.replace("{count}", "2")}</span></h3>`)
        const company = await reviews({ side: "company" }, { [OPEN_REVIEWS]: ok([review({ status: "COMPLETED", lines: [line({ decision: "CONFIRMED", answeredBy: person("Mona", "Adel") })] })]) }, { role: "ADMIN", userId: "a1" })
        expect(company).toContain(`<h3 class="ui-subsection-title" id="review-v1">${en.access_review_opened.replace("{date}", "1 Nov 2026")} <span class="ui-badge ui-badge-good">${en.access_review_completed}</span></h3>`)
    })

    it("makes each line a row: who, the permission and its scope, through which role, with Confirm and Request change named for it", async () => {
        const html = await reviews({}, { [OPEN_REVIEWS]: ok([review()]) })
        expect(html).toContain('<span class="ui-item-title"><bdi>Karim Nabil</bdi></span>')
        expect(html).toContain(`<span class="ui-item-detail"><span><bdi>${en.perm_salary_view}</bdi>, <bdi>${en.scope_COMPANY}</bdi>, <bdi>Accountants</bdi></span></span>`)
        const named = `Karim Nabil${en.list_separator}${en.perm_salary_view}`
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" aria-label="${esc(en.access_review_confirm_for.replace("{line}", named))}">${en.access_review_confirm}</button>`))
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-quiet ui-btn-sm" aria-label="${esc(en.access_review_change_for.replace("{line}", named))}">${en.access_review_change}</button>`))
    })

    it("says how a line was answered, by whom, and why", async () => {
        const html = await reviews({}, { [OPEN_REVIEWS]: ok([review({ lines: [line({ decision: "CHANGE_REQUESTED", note: "Only the payroll lead.", answeredBySuperAdmin: person("Sara", "Ali") })] })]) })
        expect(html).toContain(`<span class="ui-badge ui-badge-waiting">${en.access_review_change_requested}</span>`)
        expect(html).toContain(`<bdi>${en.access_review_answered_by.replace("{name}", "Sara Ali")}</bdi>`)
        expect(html).toContain('<span class="ui-item-note"><bdi>Only the payroll lead.</bdi></span>')
        expect(html).not.toContain(`>${en.access_review_confirm}</button>`)
    })

    it("leaves a person's own line to someone else, saying so", async () => {
        const html = await reviews({ side: "company" }, { [OPEN_REVIEWS]: ok([review({ lines: [line({ userId: "a1" })] })]) }, { role: "ADMIN", userId: "a1" })
        expect(html).toContain(`<span class="ui-hint">${esc(en.access_review_own_line)}</span>`)
        expect(html).not.toContain(`>${en.access_review_confirm}</button>`)
    })

    it("marks the lines of the review a notification opened", async () => {
        const html = await reviews({ highlight: "v2" }, { [OPEN_REVIEWS]: ok([review(), review({ id: "v2", lines: [line({ id: "l3" }), line({ id: "l4" })] })]) })
        expect(html.match(/<li data-tone="selected">/g)).toHaveLength(2)
    })

    it("says while the reviews load, and when they didn't, with Try again", async () => {
        expect(await reviews({}, {})).toContain(`role="status"`)
        const html = await reviews({}, { [OPEN_REVIEWS]: failed })
        expect(html).toContain(esc(en.access_review_load_failed))
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("asks for a change in the building blocks' dialog, the line in view and the reason required", async () => {
        const { ChangeLineDialog, reasonError } = await import("@/components/AccessReviews")
        expect(reasonError("")).toBe("access_review_change_reason_required")
        expect(reasonError("Only the payroll lead")).toBeNull()
        const html = render(h(ChangeLineDialog, { line: line(), onClose: () => {}, onRequest: async () => true } as never))
        expect(html).toContain(`class="ui-dialog-title">${en.access_review_change}</h2>`)
        expect(html).toContain(`<p><bdi>Karim Nabil</bdi>, <bdi>${en.perm_salary_view}</bdi>, <bdi>Accountants</bdi></p>`)
        expect(html).toContain(`class="ui-label">${esc(en.access_review_change_reason)}</label>`)
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.access_review_change}</button>`))
    })

    it("writes its days in the page's language", async () => {
        const html = await reviews({ side: "company" }, { [OPEN_REVIEWS]: ok([review()]) }, { locale: "ar", role: "ADMIN", userId: "a1" })
        expect(html).toContain(ar.access_review_opened.replace("{date}", "١ نوفمبر ٢٠٢٦"))
    })
})

describe("the Super Admin's two pages", () => {
    it("each has the page header, and neither sets the old top bar's title", async () => {
        const { default: Changes } = await import("@/app/(dashboard)/dashboard/role-change-requests/page")
        const changesHtml = render(h(Changes), { [OPEN_REQUESTS]: ok([]) })
        expect(changesHtml).toContain(`<h1 class="ui-page-title">${en.role_changes_title}</h1>`)
        expect(changesHtml).toContain(`<p class="ui-page-subtitle">${esc(en.role_changes_hint)}</p>`)
        const { default: Reviews } = await import("@/app/(dashboard)/dashboard/access-reviews/page")
        const reviewsHtml = render(h(Reviews), { [OPEN_REVIEWS]: ok([]) })
        expect(reviewsHtml).toContain(`<h1 class="ui-page-title">${en.access_review_title}</h1>`)
        for (const file of ["app/(dashboard)/dashboard/role-change-requests/page.tsx", "app/(dashboard)/dashboard/access-reviews/page.tsx"]) {
            expect(readFileSync(file, "utf8"), file).not.toContain("useHeader")
        }
    })
})

describe("a row", () => {
    it("can be the one you came to see, and carry more than one note", async () => {
        const { Row } = await import("@/components/ui")
        const html = render(h("ul", null, h(Row, { title: "Collector", tone: "selected", note: ["Let collectors see tasks.", "Response: done"] })))
        expect(html).toContain('<li data-tone="selected">')
        expect(html).toContain('<span class="ui-item-note">Let collectors see tasks.</span><span class="ui-item-note">Response: done</span>')
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-rows > li\[data-tone="selected"\] \{\s*background: var\(--brand-tint\);/)
        const design = readFileSync("DESIGN.md", "utf8").replace(/\s+/g, " ")
        expect(design).toContain("The row you came to see, such as the one a notification opened, has `--brand-tint` behind it")
        expect(design).toContain("A list with one filter and no search")
    })
})

describe("the Role list for asking", () => {
    it("comes from the same roles RoleSelect offers", () => {
        const select = readFileSync("components/RoleSelect.tsx", "utf8")
        expect(select).toContain("export function useAssignableRoles(")
        expect(select).toMatch(/const roles = useAssignableRoles\(companyId\)/)
        expect(readFileSync("components/RoleChangeRequests.tsx", "utf8")).toContain("useAssignableRoles()")
    })
})

describe("nothing of the old lists is left", () => {
    it("has no inline styles, old windows, pills, glass panels or dots between facts", () => {
        for (const file of ["components/RoleChangeRequests.tsx", "components/AccessReviews.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toMatch(/@\/components\/(ConfirmModal|Modal|SafeDate)'/)
            // The old select itself: its list of roles is used, through useAssignableRoles.
            expect(source, file).not.toContain("import RoleSelect")
            expect(source, file).not.toMatch(/className="(input|btn|glass|badge)/)
            expect(source, file).not.toContain(" · ")
            expect(source, file).not.toContain("isRtl")
        }
    })
})

describe("found in the browser and the audit (the Super Admin's pages part 2a)", () => {
    it("stretches each review's rows to the card's edges, so a marked row's tint doesn't touch its words", async () => {
        // A review's rows sat inside the card's padding, the brand tint against the names.
        const html = await reviews({}, { [OPEN_REVIEWS]: ok([review()]) })
        expect(html).toMatch(/<section class="ui-subsection" aria-labelledby="review-v1">/)
        expect(html).toContain('<ul class="ui-rows ui-rows-flush">')
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-card > \.ui-subsection > \.ui-rows-flush \{\s*margin-inline: calc\(-1 \* var\(--space-4\)\);/)
        expect(css).toMatch(/\.ui-card > \.ui-rows-flush > li > \.ui-row,\s*\.ui-card > \.ui-subsection > \.ui-rows-flush > li > \.ui-row \{\s*padding-inline: var\(--space-4\);/)
    })

    it("names the Super Admin's menu on a request for its role and company, so two companies' are told apart", async () => {
        // Two companies asking for "A new role" had menus both named "More actions for A new role".
        await changes({}, { [OPEN_REQUESTS]: ok([request({ role: null }), request({ id: "q2", role: null, company: { name: "Nile Works" } })]) })
        expect(state.menus.map(m => m.label)).toEqual([
            en.ui_more_actions_for.replace("{name}", `${en.role_changes_new_role}${en.list_separator}Delta Sites`),
            en.ui_more_actions_for.replace("{name}", `${en.role_changes_new_role}${en.list_separator}Nile Works`),
        ])
    })
})
