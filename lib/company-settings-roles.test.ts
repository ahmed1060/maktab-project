import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Company settings on the building blocks, part 4b (UI_PLAN.md §5 step 5):
 * the Super Admin's Roles tab, that is the company's roles as rows, copying
 * roles from another company, deleting one, and the periodic access review.
 * The role editor and its permission matrix follow in part 4c.
 */

type Loaded = { data?: unknown; error?: unknown; isLoading?: boolean; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    swr: {} as Record<string, Loaded>,
    menus: null as null | { label: string; items: { key: string; danger?: boolean }[] }[],
}

vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => "/dashboard/companies/c1/settings",
    useSearchParams: () => new URLSearchParams("tab=roles"),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "sa", role: "SUPER_ADMIN" } }, update: async () => null }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => {
    const useSWR = (key: string | null) => {
        const shown = key ? state.swr[key] : undefined
        return { data: undefined, error: undefined, isLoading: !!key && !shown, isValidating: false, mutate: async () => {}, ...shown }
    }
    return { default: useSWR, useSWRConfig: () => ({ mutate: async () => {} }) }
})
vi.mock("@/components/ui", async (importOriginal) => {
    const ui = await importOriginal<typeof import("@/components/ui")>()
    const RowMenu = (props: Parameters<typeof ui.RowMenu>[0]) => {
        state.menus?.push(props)
        return h(ui.RowMenu, props)
    }
    return { ...ui, RowMenu }
})

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const ok = (data: unknown) => ({ data: { data } })
const failed = (status: number) => ({ error: Object.assign(new Error("x"), { status, info: { error: "Database unavailable" } }) })

const ROLES = "/api/roles?companyId=c1"
const TEMPLATES = "/api/role-templates"
const grants = (n: number) => Array.from({ length: n }, (_, i) => ({ permission: `p${i}`, scope: "ALL" }))
const role = (r: Record<string, unknown>) => ({ companyId: "c1", version: 1, description: null, locked: false, builtIn: null, isDefault: false, holders: 0, grants: grants(1), ...r })
const ROLE_LIST = {
    roles: [
        role({ id: "r1", name: "Admin", baseRole: "ADMIN", builtIn: "ADMIN", locked: true, holders: 2, grants: grants(30) }),
        role({ id: "r2", name: "Employee", baseRole: "EMPLOYEE", builtIn: "EMPLOYEE", isDefault: true, holders: 5, grants: grants(4) }),
        role({ id: "r3", name: "Supervisors", baseRole: "TEAM_LEADER", holders: 0, grants: grants(2) }),
        role({ id: "r4", name: "Accountants", baseRole: "EMPLOYEE", holders: 1, grants: grants(1) }),
    ],
    access: null,
    review: { accessReviewEnabled: true, accessReviewMonths: 3, accessReviewNextAt: "2026-12-01T00:00:00.000Z" },
}
const loaded = (extra: Record<string, Loaded> = {}) => ({ [ROLES]: ok(ROLE_LIST), [TEMPLATES]: ok([]), ...extra })

function render(element: Parameters<typeof renderToStaticMarkup>[0], swr: Record<string, Loaded> = {}, locale: "en" | "ar" = "en") {
    Object.assign(state, { swr, locale })
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}
const roles = async (swr: Record<string, Loaded> = loaded(), locale: "en" | "ar" = "en") => {
    const { default: Card } = await import("@/components/CompanyRolesCard")
    return render(h(Card, { companyId: "c1" }), swr, locale)
}

describe("the Roles tab", () => {
    it("is a card with Export, Copy roles from and New role, and the roles as rows", async () => {
        const html = await roles()
        expect(html).toContain(`<h2 class="ui-card-title">${en.roles_title}</h2>`)
        expect(html).toContain(`<p class="ui-card-note">${esc(en.roles_hint)}</p>`)
        expect(html).toMatch(new RegExp(`<a class="ui-btn ui-btn-secondary" href="/api/roles/export\\?companyId=c1&amp;locale=en" download="">(<svg[^]*?</svg>)?${en.roles_export}</a>`))
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary"[^>]*>(<svg[^]*?</svg>)?${en.roles_copy_from}</button>`))
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-primary"[^>]*>(<svg[^]*?</svg>)?${en.roles_new}</button>`))
        expect(html).toContain(`<ul class="ui-rows ui-rows-flush" aria-label="${en.roles_title}">`)
        for (const name of [en.role_admin, en.role_employee, "Supervisors", "Accountants"]) expect(html, name).toContain(`<bdi>${name}</bdi>`)
    })

    it("says what each role is in badges and one line of facts, as the language counts them", async () => {
        const html = await roles()
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.roles_built_in}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${en.roles_locked}</span>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${en.roles_default}</span>`)
        // A role of its own says what it's based on; one person isn't "1 people".
        expect(html).toContain(`<span class="ui-item-detail"><span>${["Based on Team Leader", "0 employees", "2 permissions"].map(x => `<bdi>${x}</bdi>`).join(en.list_separator)}</span></span>`)
        expect(html).toContain(`<span class="ui-item-detail"><span>${["Based on Employee", "1 employee", "1 permission"].map(x => `<bdi>${x}</bdi>`).join(en.list_separator)}</span></span>`)
        expect(html).toContain(`<span class="ui-item-detail"><span>${["5 employees", "4 permissions"].map(x => `<bdi>${x}</bdi>`).join(en.list_separator)}</span></span>`)
        expect(html).not.toContain(" · ")
        const arabic = await roles(loaded(), "ar")
        expect(arabic).toContain(`<bdi>${ar.count_employees_one}</bdi>`)
        expect(arabic).toContain(`<bdi>${ar.count_permissions_one}</bdi>`)
    })

    it("gives each role a menu named for it, with only what can be done to it", async () => {
        state.menus = []
        await roles()
        const menus = state.menus
        state.menus = null
        const of = (name: string) => menus.find(m => m.label === en.ui_more_actions_for.replace("{name}", name))!.items.map(i => i.key)
        // The built-in Admin is never the default; a default or built-in role, or one held, isn't deleted.
        expect(of(en.role_admin)).toEqual(["edit", "preview"])
        expect(of(en.role_employee)).toEqual(["edit", "preview"])
        expect(of("Supervisors")).toEqual(["edit", "preview", "default", "delete"])
        expect(of("Accountants")).toEqual(["edit", "preview", "default"])
        expect(menus.find(m => m.label.endsWith("Supervisors"))!.items.find(i => i.key === "delete")!.danger).toBe(true)
    })

    it("says when the roles are loading, and when they didn't load, with Try again", async () => {
        expect(await roles({})).toMatch(/<div class="ui-panel" role="status">[^]*Loading…/)
        const html = await roles({ [ROLES]: failed(500) })
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("asks before deleting a role in the building blocks' dialog, in the danger colour", async () => {
        const { DeleteRoleDialog } = await import("@/components/CompanyRolesCard")
        const html = render(h(DeleteRoleDialog, { name: "Supervisors", busy: false, onCancel: () => {}, onConfirm: () => {} }))
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`class="ui-dialog-title">${en.roles_delete_title.replace("{name}", "Supervisors")}</h2>`)
        expect(html).toContain(esc(en.roles_delete_body))
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-danger"[^>]*>${en.roles_delete}</button>`))
    })
})

describe("copying roles from another company", () => {
    const COMPANIES = "/api/companies?limit=100"
    const list = ok([{ id: "c1", name: "Delta Sites" }, { id: "c2", name: "Nile Works" }])

    it("is the building blocks' dialog: the company to copy from, named, and whether to bring the built-in roles", async () => {
        const { default: CopyRolesModal } = await import("@/components/CopyRolesModal")
        const html = render(h(CopyRolesModal, { companyId: "c1", isOpen: true, onClose: () => {}, onCopied: () => {} }), { [COMPANIES]: list })
        expect(html).toContain(`class="ui-dialog-title">${en.roles_copy_title}</h2>`)
        expect(html).toContain(esc(en.roles_copy_hint))
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.roles_copy_source}</label>`))
        expect(html).toContain(`<option value="" selected="">${en.roles_copy_choose}</option>`)
        expect(html).toContain('<option value="c2">Nile Works</option>')
        // Not this company itself.
        expect(html).not.toContain('<option value="c1">')
        expect(html).toMatch(new RegExp(`<label class="ui-choice"><input type="checkbox" class="ui-check" name="includeBuiltIn"/>${en.roles_copy_include_built_in}</label>`))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary"[^>]*>${en.roles_copy_confirm}</button>`))
    })

    it("says under the field when no company is chosen, and when the companies didn't load", async () => {
        const { sourceError } = await import("@/components/CopyRolesModal")
        expect(sourceError("")).toBe("roles_copy_source_required")
        expect(sourceError("c2")).toBeNull()
        const { default: CopyRolesModal } = await import("@/components/CopyRolesModal")
        const html = render(h(CopyRolesModal, { companyId: "c1", isOpen: true, onClose: () => {}, onCopied: () => {} }), { [COMPANIES]: failed(500) })
        expect(html).toContain(esc(en.roles_copy_companies_failed))
        expect(html).toContain(`>${en.try_again}</button>`)
    })
})

describe("the periodic access review", () => {
    const review = async (setting: Record<string, unknown> = ROLE_LIST.review) => {
        const { default: AccessReviewSetting } = await import("@/components/AccessReviewSetting")
        return render(h(AccessReviewSetting, { companyId: "c1", setting: setting as never, onSaved: () => {} }))
    }

    it("is a card with the switch, its hint under it, how often as a field, and when the next one is", async () => {
        const html = await review()
        expect(html).toContain(`<h2 class="ui-card-title">${en.access_review_setting}</h2>`)
        expect(html).toMatch(new RegExp(`<label class="ui-choice"><input type="checkbox" class="ui-check" aria-describedby="([^"]+)" name="accessReviewEnabled" checked=""/>${en.access_review_on}</label><span id="\\1" class="ui-hint ui-choice-hint">`))
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.access_review_every}</label>`))
        expect(html).toContain(`<option value="3" selected="">${en.access_review_months.replace("{count}", "3")}</option>`)
        expect(html).toContain(en.access_review_next.replace("{date}", "1 Dec 2026"))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary"[^>]*disabled=""[^>]*>${en.save}</button>`))
    })

    it("greys how often while it's off", async () => {
        const html = await review({ accessReviewEnabled: false, accessReviewMonths: 6, accessReviewNextAt: null })
        expect(html).toMatch(/<select[^>]*name="months"[^>]*disabled=""/)
        expect(html).not.toContain(en.access_review_next.replace("{date}", ""))
    })
})

describe("nothing of the old Roles tab is left", () => {
    it("has no inline styles, glass panels, old buttons or old windows", () => {
        for (const file of ["components/CompanyRolesCard.tsx", "components/CopyRolesModal.tsx", "components/AccessReviewSetting.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toContain('"glass')
            expect(source, file).not.toMatch(/className="btn/)
            expect(source, file).not.toContain("isRtl")
            expect(source, file).not.toContain("@/components/Modal'")
            expect(source, file).not.toContain("ConfirmModal")
        }
    })
})
