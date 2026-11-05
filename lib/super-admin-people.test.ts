import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, part 2b (UI_PLAN.md §5 step
 * 5), the rest of the Access group: the Super Admins page, and Who can do
 * this, whose company is the one in view from the top bar and whose question
 * is kept in its address.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "sa1", role: "SUPER_ADMIN", isProtected: false } as Record<string, unknown> | null,
    company: null as string | null,
    search: "",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    menus: [] as { label: string; items: { key: string; label: string; danger?: boolean }[] }[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: state.viewer ? { user: state.viewer } : null, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer, useCan: () => ({ can: () => true }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: state.company }) }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search), usePathname: () => "/dashboard/who-can", useRouter: () => ({ replace: () => {}, push: () => {} }) }))
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

function render(element: Parameters<typeof renderToStaticMarkup>[0], swr: Record<string, Loaded> = {}, options: { locale?: "en" | "ar"; viewer?: Record<string, unknown> | null; company?: string | null; search?: string } = {}) {
    Object.assign(state, { swr, keys: [], menus: [], locale: options.locale ?? "en", company: options.company ?? null, search: options.search ?? "" })
    state.viewer = options.viewer === undefined ? { id: "sa1", role: "SUPER_ADMIN", isProtected: false } : options.viewer
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}

// The pages are slow to load the first time; once, before the tests time them.
beforeAll(async () => {
    await Promise.all([
        import("@/app/(dashboard)/dashboard/super-admins/page"),
        import("@/app/(dashboard)/dashboard/who-can/page"),
        import("@/components/SuperAdminDialogs"),
    ])
}, 120000)

const ADMINS = "/api/super-admins?page=1&limit=10"
const admin = (a: Record<string, unknown> = {}) => ({ id: "sa2", firstName: "Sara", lastName: "Ali", email: "sara@nizmo.test", role: "SUPER_ADMIN", status: "ACTIVE", gender: "FEMALE", isProtected: false, ...a })
const admins = async (swr: Record<string, Loaded>, options?: Parameters<typeof render>[2]) => {
    const { default: SuperAdminsPage } = await import("@/app/(dashboard)/dashboard/super-admins/page")
    return render(h(SuperAdminsPage), swr, options)
}
const listed = (rows: unknown[], totalPages = 1) => ok({ data: rows, totalPages })

describe("the Super Admins page", () => {
    it("has the page header with Add a Super Admin", async () => {
        const top = header(await admins({ [ADMINS]: listed([admin()]) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.super_admins}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.super_admins_hint)}</p>`)
        expect(top).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-primary">.*${en.super_admins_add}</button>`))
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await admins({ [ADMINS]: listed([admin()]) }, { viewer: { id: "a1", role: "ADMIN" } })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("lists them as a table on computers and cards on phones: the name, a badge if protected, and the email", async () => {
        const html = await admins({ [ADMINS]: listed([admin(), admin({ id: "sa3", firstName: "Omar", lastName: "Hany", isProtected: true })]) })
        expect(html).toContain(`<caption class="ui-visually-hidden">${en.super_admins}</caption>`)
        for (const column of [en.super_admins_name, en.email]) expect(html).toContain(`<th scope="col">${column}</th>`)
        expect(html).toContain('<bdi>Sara Ali</bdi>')
        expect(html).toContain(`<bdi>Omar Hany</bdi> <span class="ui-badge ui-badge-neutral">${en.super_admins_protected}</span>`)
        expect(html).toContain('<bdi>sara@nizmo.test</bdi>')
        expect(html).toContain('<ul class="ui-cards"')
    })

    it("says no status: the server sends every Super Admin as active, so Online was never true", async () => {
        const html = await admins({ [ADMINS]: listed([admin()]) })
        expect(html).not.toContain(`<th scope="col">${en.status}</th>`)
        expect(html).not.toContain(en.status_online)
    })

    it("offers Edit on yourself, and a protected Super Admin Edit and Delete on the others, Delete never on a protected one", async () => {
        await admins({ [ADMINS]: listed([admin({ id: "sa1", firstName: "Me" }), admin()]) })
        // One menu each in the table and the cards: yourself only.
        expect(state.menus.map(m => m.label)).toEqual([en.ui_more_actions_for.replace("{name}", "Me Ali"), en.ui_more_actions_for.replace("{name}", "Me Ali")])
        expect(state.menus[0].items.map(i => i.label)).toEqual([en.edit])
        await admins({ [ADMINS]: listed([admin(), admin({ id: "sa3", firstName: "Omar", isProtected: true })]) }, { viewer: { id: "sa1", role: "SUPER_ADMIN", isProtected: true } })
        const sara = state.menus.find(m => m.label.includes("Sara"))!
        expect(sara.items.map(i => i.label)).toEqual([en.edit, en.delete])
        expect(sara.items.at(-1)?.danger).toBe(true)
        expect(state.menus.find(m => m.label.includes("Omar"))!.items.map(i => i.label)).toEqual([en.edit])
    })

    it("has the pager under the list when there's more than a page", async () => {
        const html = await admins({ [ADMINS]: listed([admin()], 3) })
        expect(html).toContain('class="ui-pager"')
        expect(html).toContain(`aria-label="${en.ui_page_of.replace("{page}", "1").replace("{pages}", "3")}"`)
    })

    it("says while they load, and when they didn't, with the server's reason and Try again", async () => {
        expect(await admins({})).toContain('<div class="ui-panel" role="status">')
        const html = await admins({ [ADMINS]: failed })
        expect(html).toContain(esc(en.super_admins_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("adds one in the building blocks' dialog: labelled fields, the password shown on request, and Add, where it said Sign in", async () => {
        const { AddSuperAdminDialog } = await import("@/components/SuperAdminDialogs")
        const html = render(h(AddSuperAdminDialog, { onClose: () => {}, onAdded: () => {} }))
        expect(html).toContain(`class="ui-dialog-title">${en.super_admins_add}</h2>`)
        for (const name of [en.super_admins_first_name, en.super_admins_last_name, en.email, en.password]) {
            expect(html, name).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${name}</label>`))
        }
        // One of two, as radio buttons under their label (DESIGN.md §5.3).
        expect(html).toContain(`<legend class="ui-label">${en.super_admins_gender}</legend>`)
        expect(html).toContain('<input type="radio" class="ui-radio" name="gender" checked="" value="MALE"/>')
        expect(html).toMatch(/<input[^>]*type="email"[^>]*name="email"|<input[^>]*name="email"[^>]*type="email"/)
        expect(html).toMatch(/<input[^>]*type="password"[^>]*autoComplete="new-password"|<input[^>]*autoComplete="new-password"[^>]*type="password"/)
        expect(html).toContain(esc(en.super_admins_password_hint))
        expect(html).toContain(`aria-label="${en.show_password}"`)
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.super_admins_add_submit}</button>`))
        expect(html).not.toContain(`>${en.sign_in}<`)
    })

    it("says on Add what's wrong under each field", async () => {
        const { addErrors } = await import("@/components/SuperAdminDialogs")
        expect(addErrors({ firstName: "", lastName: " ", email: "sara", password: "short" })).toEqual({
            firstName: "super_admins_first_name_required",
            lastName: "super_admins_last_name_required",
            email: "super_admins_email_invalid",
            password: "super_admins_password_short",
        })
        expect(addErrors({ firstName: "Sara", lastName: "Ali", email: "sara@nizmo.test", password: "a-long-password" })).toEqual({})
    })

    it("edits one in the building blocks' dialog named for them, the email kept and said where it changes", async () => {
        const { EditSuperAdminDialog } = await import("@/components/SuperAdminDialogs")
        const theirs = render(h(EditSuperAdminDialog, { admin: admin(), onClose: () => {}, onSaved: () => {} }))
        expect(theirs).toContain(`class="ui-dialog-title">${en.super_admins_edit_title.replace("{name}", "Sara Ali")}</h2>`)
        expect(theirs.match(/<input[^>]*name="email"[^>]*>/)![0]).toContain('disabled=""')
        expect(theirs).toContain(esc(en.super_admins_email_theirs))
        expect(theirs).not.toContain('href="/dashboard/security-settings"')
        expect(theirs).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.save}</button>`))
        // Your own email changes in your security settings, which it links to.
        const own = render(h(EditSuperAdminDialog, { admin: admin({ id: "sa1" }), onClose: () => {}, onSaved: () => {} }))
        expect(own).toContain(`<a href="/dashboard/security-settings">${en.security_settings_nav}</a>`)
    })

    it("renames you in the top bar when you rename yourself, and nobody else's change touches your session (audit on part 2b)", async () => {
        const { ownSessionChange } = await import("@/components/SuperAdminDialogs")
        const sent = { firstName: "Sami", lastName: "Admin", gender: "MALE" as const }
        expect(ownSessionChange("sa1", "sa1", sent)).toEqual(sent)
        expect(ownSessionChange("sa2", "sa1", sent)).toBeNull()
        const source = readFileSync("components/SuperAdminDialogs.tsx", "utf8")
        expect(source).toContain("const change = ownSessionChange(admin.id, viewer?.id, sent)")
        expect(source).toContain("if (change) await update(change)")
    })

    it("shows the email in the edit dialog as the page's other fields are, not set left to right (audit on part 2b)", async () => {
        const { EditSuperAdminDialog } = await import("@/components/SuperAdminDialogs")
        const html = render(h(EditSuperAdminDialog, { admin: admin(), onClose: () => {}, onSaved: () => {} }))
        expect(html.match(/<input[^>]*name="email"[^>]*>/)![0]).not.toContain('dir="ltr"')
    })

    it("writes its words in the page's language, not typed in English and Arabic beside each other", () => {
        const source = readFileSync("app/(dashboard)/dashboard/super-admins/page.tsx", "utf8") + readFileSync("components/SuperAdminDialogs.tsx", "utf8")
        expect(source).not.toMatch(/locale === 'ar' \?/)
        expect(source).not.toContain("'sign_in'")
    })
})

const permissionKey = (c: string, p: string) => `/api/roles/who-can?companyId=${c}&permission=${encodeURIComponent(p)}`
const whoCan = async (swr: Record<string, Loaded>, options?: Parameters<typeof render>[2]) => {
    const { default: WhoCanPage } = await import("@/app/(dashboard)/dashboard/who-can/page")
    return render(h(WhoCanPage), swr, options)
}

describe("Who can do this", () => {
    it("has the page header, and its two questions as tabs kept in the address", async () => {
        const html = await whoCan({}, { company: "c1", search: "by=person" })
        expect(header(html)).toContain(`<h1 class="ui-page-title">${esc(en.who_can_title)}</h1>`)
        expect(html).toContain(`<a class="ui-tab" href="/dashboard/who-can?by=permission">${en.who_can_by_permission}</a>`)
        expect(html).toContain(`<a class="ui-tab" aria-current="page" href="/dashboard/who-can?by=person">${en.who_can_by_person}</a>`)
    })

    it("is about the company in view from the top bar, and until one is picked says to pick one", async () => {
        const html = await whoCan({})
        expect(html).toContain(`class="ui-empty-title">${esc(en.who_can_pick_company)}<`)
        expect(state.keys.filter(Boolean)).toEqual([])
        expect(html).not.toContain("<select")
    })

    it("asks for a permission in a labelled select of its groups, then lists who holds it, through which role, at which scope", async () => {
        const prompt = await whoCan({}, { company: "c1" })
        expect(prompt).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.who_can_permission}</label>`))
        expect(prompt).toContain(`<optgroup label="${en.perm_group_employees}">`)
        expect(prompt).toContain(`class="ui-empty-title">${esc(en.who_can_choose_permission)}<`)
        const html = await whoCan({ [permissionKey("c1", "salary.view")]: ok({ holders: [{ user: { id: "u1", name: "Karim Nabil", status: "ACTIVE" }, role: { id: "r1", name: "Accountants" }, scope: "COMPANY" }] }) }, { company: "c1", search: "permission=salary.view" })
        expect(html).toContain(`<option value="salary.view" selected="">${en.perm_salary_view}</option>`)
        expect(html).toContain(`<h2 class="ui-card-title">${en.perm_salary_view}</h2>`)
        expect(html).toContain('<span class="ui-item-title"><bdi>Karim Nabil</bdi></span>')
        expect(html).toContain(`<span class="ui-item-detail"><span><bdi>Accountants</bdi>, <bdi>${en.scope_COMPANY}</bdi></span></span>`)
        const nobody = await whoCan({ [permissionKey("c1", "salary.view")]: ok({ holders: [] }) }, { company: "c1", search: "permission=salary.view" })
        expect(nobody).toContain(`class="ui-empty-title">${en.who_can_nobody}<`)
    })

    it("finds a person with a labelled search and a choice of the people found, then lists what they may do, group by group", async () => {
        const people = "/api/users?companyId=c1&includeDeleted=false&limit=20&search="
        const person = "/api/roles/who-can?userId=u1"
        const html = await whoCan({
            [people]: ok({ data: [{ id: "u1", firstName: "Karim", lastName: "Nabil" }, { id: "u2", firstName: "Mona", lastName: "Adel" }] }),
            [person]: ok({ user: { id: "u1", name: "Karim Nabil", status: "ACTIVE", companyId: "c1" }, role: { name: "Accountants" }, grants: [{ permission: "salary.view", scope: "COMPANY" }, { permission: "employees.view", scope: "TEAM" }] }),
        }, { company: "c1", search: "by=person&person=u1" })
        expect(html).toMatch(new RegExp(`<label for="[^"]+" class="ui-label">${en.who_can_find_person}</label>`))
        expect(html).toContain(`<legend class="ui-label">${en.who_can_person}</legend>`)
        expect(html).toContain('<input type="radio" class="ui-radio" name="person" checked="" value="u1"/>')
        expect(html).toContain(`<h2 class="ui-card-title"><bdi>Karim Nabil</bdi></h2>`)
        const [before, after] = en.who_can_through.split("{role}")
        expect(html).toContain(`<p class="ui-card-note">${before}<bdi>Accountants</bdi>${after}</p>`)
        expect(html).toContain(`<h3 class="ui-subsection-title">${en.perm_group_employees}</h3>`)
        expect(html).toContain(`<span class="ui-item-title">${en.perm_employees_view}</span><span class="ui-item-detail">${en.scope_TEAM}</span>`)
        expect(html).not.toContain("✕")
    })

    it("says when the box holds as many as it lists, so there may be more to find by name (audit on part 2b)", async () => {
        const people = "/api/users?companyId=c1&includeDeleted=false&limit=20&search="
        const many = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, firstName: "Person", lastName: String(i) }))
        expect(await whoCan({ [people]: ok({ data: many }) }, { company: "c1", search: "by=person" })).toContain(esc(en.who_can_more_people))
        expect(await whoCan({ [people]: ok({ data: many.slice(0, 2) }) }, { company: "c1", search: "by=person" })).not.toContain(esc(en.who_can_more_people))
    })

    it("says to pick a person until one is, and doesn't show one of another company when the top bar changes", async () => {
        const person = "/api/roles/who-can?userId=u1"
        expect(await whoCan({}, { company: "c1", search: "by=person" })).toContain(`class="ui-empty-title">${esc(en.who_can_pick_person)}<`)
        const html = await whoCan({ [person]: ok({ user: { id: "u1", name: "Karim Nabil", status: "ACTIVE", companyId: "c2" }, role: null, grants: [] }) }, { company: "c1", search: "by=person&person=u1" })
        expect(html).not.toContain("Karim Nabil")
        expect(html).toContain(`class="ui-empty-title">${esc(en.who_can_pick_person)}<`)
    })

    it("says while an answer loads, and when it didn't, with Try again", async () => {
        expect(await whoCan({}, { company: "c1", search: "permission=salary.view" })).toContain('role="status"')
        const html = await whoCan({ [permissionKey("c1", "salary.view")]: failed }, { company: "c1", search: "permission=salary.view" })
        expect(html).toContain(esc(en.who_can_load_failed))
        expect(html).toContain(`>${en.try_again}</button>`)
    })
})

describe("nothing of the old pages is left", () => {
    it("has no inline styles, old windows, spinner, toggle, pager or header title", () => {
        for (const file of ["app/(dashboard)/dashboard/super-admins/page.tsx", "components/SuperAdminDialogs.tsx", "app/(dashboard)/dashboard/who-can/page.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toMatch(/@\/components\/(ConfirmModal|NoticeModal|LoadingSpinner|SegmentedToggle|Pagination)'/)
            expect(source, file).not.toMatch(/className="(input|btn|glass)/)
            expect(source, file).not.toContain("useHeader")
            expect(source, file).not.toContain("useDialog(")
        }
    })
})
