import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Add employee on the building blocks (UI_PLAN.md §5 step 5, the pages
 * left): a card of its own making, its sides chosen by hand for each
 * language, its mistakes said in English whatever the language, and a
 * password eye drawn by hand.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: { id: "a1", role: "ADMIN" } as Record<string, unknown>,
    perms: new Set<string>(),
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: state.viewer }, status: "authenticated" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: (k: string) => state.perms.has(k) }), useViewer: () => state.viewer }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (k: string) => (k === "employees" ? "Employees" : k) }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, replace: () => {} }), usePathname: () => "/dashboard/employees/new" }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/components/AccessDenied", () => ({ default: () => h("div", { "data-denied": "" }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const loaded: Loaded = key ? state.swr[key] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))

const PAGE = "app/(dashboard)/dashboard/employees/new/page.tsx"
const COMPANIES = "/api/companies?limit=1000"
const LEADERS = "/api/users?role=TEAM_LEADER&limit=1000"
const ROLES = "/api/roles/assignable"
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const input = (attrs: Record<string, string>) =>
    new RegExp(`<input${Object.entries(attrs).map(([k, v]) => `(?=[^>]*${k}="${v}")`).join("")}[^>]*>`)
const label = (text: string) => new RegExp(`<label for="[^"]+" class="ui-label">${esc(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</label>`)
const all = ["employees.create", "employees.assign_team", "employees.assign_role"]

async function render(options: { viewer?: Record<string, unknown>; perms?: string[]; swr?: Record<string, Loaded>; locale?: "en" | "ar" } = {}) {
    Object.assign(state, {
        viewer: options.viewer ?? { id: "a1", role: "ADMIN" },
        perms: new Set(options.perms ?? all),
        swr: options.swr ?? {},
        keys: [],
        locale: options.locale ?? "en",
    })
    const { default: Page } = await import("@/app/(dashboard)/dashboard/employees/new/page")
    return renderToStaticMarkup(h(Page))
}

beforeAll(async () => {
    await import("@/app/(dashboard)/dashboard/employees/new/page")
}, 120000)

describe("Add employee", () => {
    it("has the page header, with a way back to the list", async () => {
        const html = await render()
        expect(html).toContain(`<h1 class="ui-page-title">${en.add_employee}</h1>`)
        expect(html).toMatch(/<a class="ui-back-link" href="\/dashboard\/employees">[\s\S]*?Employees<\/a>/)
        // The Super Admin adds anyone, so it says so.
        const sa = await render({ viewer: { id: "sa1", role: "SUPER_ADMIN" } })
        expect(sa).toContain(`<h1 class="ui-page-title">${en.add_new_user_title}</h1>`)
    })

    it("takes the name, email and password as the building blocks' fields, each with its label above it", async () => {
        const html = await render()
        expect(html).toMatch(label(en.first_name_label))
        expect(html).toMatch(input({ name: "firstName", autoComplete: "off", maxLength: "15" }))
        expect(html).toMatch(label(en.last_name_label))
        expect(html).toMatch(input({ name: "lastName", autoComplete: "off", maxLength: "15" }))
        expect(html).toMatch(input({ name: "email", type: "email", autoComplete: "off", spellCheck: "false" }))
        // The building blocks' password field, its eye named for what it does, and how long it must be said under it.
        expect(html).toMatch(input({ name: "password", type: "password", autoComplete: "new-password", maxLength: "72" }))
        expect(html).toContain(`aria-label="${en.show_password}"`)
        expect(html).toContain(esc(en.emp_new_password_hint))
    })

    it("takes the pay and the day off credit as numbers", async () => {
        const html = await render()
        expect(html).toMatch(input({ name: "salary", type: "number", inputMode: "decimal", min: "0" }))
        expect(html).toMatch(input({ name: "dayOffCredit", type: "number", inputMode: "decimal", min: "0", step: "0.5" }))
    })

    it("offers the roles the viewer may hand out, the company's default first", async () => {
        const roles = [
            { id: "r1", name: "Employee", baseRole: "EMPLOYEE", builtIn: "EMPLOYEE", isDefault: true },
            { id: "r2", name: "Team leader", baseRole: "TEAM_LEADER", builtIn: "TEAM_LEADER", isDefault: false },
        ]
        const html = await render({ swr: { [ROLES]: { data: { data: roles } } } })
        expect(html).toMatch(/<select(?=[^>]*name="roleId")(?=[^>]*class="ui-select")[^>]*><option value="" selected="">[^<]+<\/option><option value="r1">[^<]+<\/option><option value="r2">/)
        // Not for somebody who may neither give one nor ask for one.
        const without = await render({ perms: ["employees.create", "employees.assign_team"], swr: { [ROLES]: { data: { data: roles } } } })
        expect(without).not.toContain('name="roleId"')
    })

    it("offers an employee a team leader, none by default, with what it means", async () => {
        const leaders = [{ id: "l1", firstName: "Mona", lastName: "Adel" }]
        const html = await render({ swr: { [LEADERS]: { data: { data: { data: leaders } } } } })
        expect(html).toMatch(new RegExp(`<select(?=[^>]*name="teamLeaderId")[^>]*><option value="" selected="">${esc(en.team_leader_none)}</option><option value="l1">Mona Adel</option>`))
        expect(html).toContain(esc(en.team_leader_hint))
        // Asked for only by somebody who may assign a team.
        await render({ perms: ["employees.create"] })
        expect(state.keys).not.toContain(LEADERS)
    })

    it("asks the Super Admin for the company, from the companies there are", async () => {
        const companies = [{ id: "c1", name: "Acme" }]
        const html = await render({ viewer: { id: "sa1", role: "SUPER_ADMIN" }, swr: { [COMPANIES]: { data: { data: { data: companies } } } } })
        expect(html).toMatch(new RegExp(`<select(?=[^>]*name="companyId")[^>]*><option value="" selected="">${esc(en.select_company_placeholder)}</option><option value="c1">Acme</option>`))
        // Nobody else is asked, or asks the server for them.
        const admin = await render()
        expect(admin).not.toContain('name="companyId"')
        expect(state.keys).not.toContain(COMPANIES)
    })

    it("says when the companies or the team leaders didn't load, with Try again", async () => {
        const html = await render({ viewer: { id: "sa1", role: "SUPER_ADMIN" }, swr: { [COMPANIES]: { error: new Error("down") }, [LEADERS]: { error: new Error("down") } } })
        expect(html).toContain(esc(en.emp_new_companies_failed))
        expect(html).toContain(esc(en.emp_new_leaders_failed))
        expect(html.match(new RegExp(`>${en.try_again}</button>`, "g"))?.length).toBe(2)
    })

    it("creates with the building blocks' buttons, Cancel a link back", async () => {
        const html = await render()
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">[\\s\\S]*?${en.create_employee_button}</button>`))
        expect(html).toMatch(new RegExp(`<a class="ui-btn ui-btn-secondary" href="/dashboard/employees">${en.cancel}</a>`))
    })

    it("is for those who may add people; anybody else is told so and nothing is asked", async () => {
        const html = await render({ perms: [] })
        expect(html).toContain("data-denied")
        expect(state.keys.filter(Boolean)).toEqual([])
    })
})

describe("its checks", () => {
    it("says what's wrong in the reader's language, under each field, the first one focused", async () => {
        const { newEmployeeErrors } = await import("@/lib/new-employee-form")
        expect(newEmployeeErrors({ firstName: "", lastName: " ", email: "nope", password: "short", company: { needed: true, id: "" } })).toEqual({
            firstName: "emp_new_first_name_required",
            lastName: "emp_new_last_name_required",
            email: "emp_new_email_invalid",
            password: "emp_new_password_short",
            companyId: "emp_new_company_required",
        })
        expect(newEmployeeErrors({ firstName: "Mona", lastName: "Adel", email: "mona@example.co.uk", password: "a-long-enough-one", company: { needed: false, id: "" } })).toEqual({})
        const src = readFileSync(PAGE, "utf8")
        expect(src).toContain("setFocusOn(firstError(errors as Record<string, string>, FIELDS) as NewEmployeeField | null)")
        for (const english of ["Email must be in format", "First Name max", "Password must be 12-72", "Company is required", "An error occurred", "Failed to create user", "Username already in use"]) {
            expect(src, english).not.toContain(english)
        }
        for (const key of ["emp_new_first_name_required", "emp_new_last_name_required", "emp_new_email_invalid", "emp_new_password_short", "emp_new_company_required", "emp_new_email_taken", "emp_new_password_hint", "emp_new_companies_failed", "emp_new_leaders_failed"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })

    it("puts the server's refusal under the field it's about: an email that's taken under the email", async () => {
        const { refusedField } = await import("@/lib/new-employee-form")
        expect(refusedField({ error: "User already exists" })).toEqual({ field: "email", key: "emp_new_email_taken" })
        expect(refusedField({ error: "Validation Error", details: { email: { _errors: ["Invalid email"] } } })).toEqual({ field: "email", key: "emp_new_email_invalid" })
        expect(refusedField({ error: "Validation Error", details: { password: { _errors: ["Too short"] } } })).toEqual({ field: "password", key: "emp_new_password_short" })
        expect(refusedField({ error: "Something else" })).toBeNull()
    })

    it("asks before leaving what's typed, but not once it's being sent", () => {
        const src = readFileSync(PAGE, "utf8")
        expect(src).toContain("if (!started || loading) return")
        expect(src).toContain("window.addEventListener('beforeunload', warn)")
    })
})

describe("on the building blocks", () => {
    const src = readFileSync(PAGE, "utf8")

    it("leaves its typed-in styles, hand-picked sides and hand-drawn eye behind", () => {
        expect(src).not.toContain("style={")
        expect(src).not.toContain('className="card"')
        expect(src).not.toMatch(/'left'|'right'/)
        expect(src).not.toContain("<svg")
        expect(src).not.toContain("<RoleSelect")
    })

    it("writes its labels in sentence case, in English as in the rest of the app", () => {
        expect(en.first_name_label).toBe("First name")
        expect(en.last_name_label).toBe("Last name")
        expect(en.monthly_base_salary_label).toBe("Monthly base salary (EGP)")
        expect(en.day_off_credit).toBe("Day off credit")
        expect(en.add_new_user_title).toBe("Add a user")
        expect(en.create_user_button).toBe("Create user")
        expect(en.create_employee_button).toBe("Create employee")
        expect(en.select_company_placeholder).toBe("Select a company…")
    })
})

describe("Add employee, found in the browser", () => {
    it("puts the focus on the field a refusal is about once the form can be used again", () => {
        // The fields are off while it's sent, and the refused email was
        // focused while it still was: the focus went nowhere.
        const src = readFileSync(PAGE, "utf8")
        expect(src).toContain("if (!focusOn || loading) return")
        expect(src).toContain("document.querySelector<HTMLElement>(`[name=\"${focusOn}\"]`)?.focus()")
    })
})

describe("Add employee, found in the web interface audit", () => {
    it("says how much of a name it takes, as it stops at 15 characters", async () => {
        // Typing stopped at the 15th character with nothing to say why.
        const html = await render()
        const count = esc(en.ui_characters_used.replace("{used}", "0").replace("{max}", "15"))
        expect(html.split(count).length - 1).toBe(2)
    })
})
