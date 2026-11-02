import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Company settings on the building blocks, part 4c (UI_PLAN.md §5 step 5):
 * the role editor and its permission matrix, which the Roles tab and the
 * role templates page share.
 */

const state = { locale: "en" as "en" | "ar" }

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const label = /<label for="[^"]+" class="ui-label">/

function render(element: Parameters<typeof renderToStaticMarkup>[0], locale: "en" | "ar" = "en") {
    state.locale = locale
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}

type Rows = { permission: string; scope: string }[]
const role = (r: Record<string, unknown>) => ({ id: "r1", name: "Supervisors", description: null, baseRole: "TEAM_LEADER", grants: [] as Rows, builtIn: null, holders: 0, locked: false, ...r })
const editor = async (props: Record<string, unknown>, locale: "en" | "ar" = "en") => {
    const { default: RoleEditorModal } = await import("@/components/RoleEditorModal")
    return render(h(RoleEditorModal, { isOpen: true, onClose: () => {}, kind: "role", role: null, onSubmit: async () => true, ...props } as never), locale)
}
const TEMPLATES = [{ id: "t1", name: "Accountant", description: null, baseRole: "EMPLOYEE", grants: [] as Rows }]

describe("the role editor", () => {
    it("is the building blocks' dialog: a template to start from, the name, description and base role as labelled fields", async () => {
        const html = await editor({ templates: TEMPLATES })
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`class="ui-dialog-title">${en.roles_new}</h2>`)
        for (const name of [en.roles_template, en.roles_name, en.roles_description, en.roles_base_role]) {
            expect(html, name).toMatch(new RegExp(`${label.source}${name}</label>`))
        }
        expect(html).toContain(`<option value="" selected="">${en.roles_from_scratch}</option>`)
        expect(html).toContain('<option value="t1">Accountant</option>')
        expect(html).toMatch(/<textarea[^>]*name="description"/)
        expect(html).toContain(esc(en.roles_base_role_hint))
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.cancel}</button><button type="submit" class="ui-btn ui-btn-primary"[^>]*>${en.save}</button>`))
    })

    it("keeps a built-in role's name and a held role's base, and shows a built-in role's name in the page's language", async () => {
        const html = await editor({ role: role({ name: "Employee", baseRole: "EMPLOYEE", builtIn: "EMPLOYEE", holders: 2 }) }, "ar")
        const name = html.match(/<input[^>]*name="name"[^>]*>/)![0]
        expect(name).toContain(`value="${ar.role_employee}"`)
        expect(name).toContain('disabled=""')
        expect(html.match(/<select[^>]*name="baseRole"[^>]*>/)![0]).toContain('disabled=""')
    })

    it("says why the built-in Admin can't be changed, and offers only Close", async () => {
        const html = await editor({ role: role({ name: "Admin", baseRole: "ADMIN", builtIn: "ADMIN", locked: true, holders: 1 }) })
        expect(html).toContain(`<p class="ui-dialog-note">${esc(en.roles_locked_hint)}</p>`)
        expect(html).not.toContain(`>${en.save}</button>`)
        expect(html).toMatch(new RegExp(`<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary"[^>]*>${en.close}</button></div>`))
    })

    it("says what's wrong under the field on Save: a role needs a name, and a new pair of duties needs keeping on purpose", async () => {
        const { roleErrors } = await import("@/components/RoleEditorModal")
        expect(roleErrors({ name: " ", addedPairs: 0, acknowledged: false })).toEqual({ name: "roles_name_required" })
        expect(roleErrors({ name: "Payroll desk", addedPairs: 1, acknowledged: false })).toEqual({ acknowledge: "sod_acknowledge_required" })
        expect(roleErrors({ name: "Payroll desk", addedPairs: 1, acknowledged: true })).toEqual({})
    })

    it("shows the pairs auditors look for in a note of its own, with the box to keep both", async () => {
        const grants = [{ permission: "employees.create", scope: "COMPANY" }, { permission: "salary.edit", scope: "COMPANY" }]
        // Held before: shown, nothing to acknowledge.
        const held = await editor({ role: role({ grants }) })
        expect(held).toMatch(new RegExp(`<section class="ui-dialog-note" data-tone="problem"[^>]*><h3 class="ui-subsection-title"[^>]*>${en.sod_title}</h3>`))
        expect(held).toContain(esc(en.sod_create_employee_salary))
        expect(held).not.toContain(en.sod_acknowledge)
    })

    it("names a template being edited, and offers no template to start from", async () => {
        const html = await editor({ kind: "template", role: role({ name: "Accountant", baseRole: "EMPLOYEE" }) })
        expect(html).toContain('class="ui-dialog-title">Accountant</h2>')
        expect(html).not.toContain(`>${en.roles_template}</label>`)
        expect((await editor({ kind: "template" }))).toContain(`class="ui-dialog-title">${en.role_templates_new}</h2>`)
    })
})

describe("the permission matrix", () => {
    const matrix = async (props: Record<string, unknown>, locale: "en" | "ar" = "en") => {
        const { default: PermissionMatrix } = await import("@/components/PermissionMatrix")
        return render(h(PermissionMatrix, { grants: {}, onChange: () => {}, ...props } as never), locale)
    }

    it("has a heading and how many are picked, and each group as a row that opens, open where any is held", async () => {
        const html = await matrix({ grants: { "employees.create": "COMPANY", "employees.view": "COMPANY" } })
        expect(html).toContain(`<h3 class="ui-subsection-title" id="`)
        expect(html).toContain(`>${en.roles_permissions}</h3>`)
        expect(html).toContain(en.roles_selected.replace("{count}", "2"))
        // Employees is open, with two of its permissions; Tasks is closed.
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-row-main ui-row-toggle" aria-expanded="true" aria-controls="[^"]+"><span class="ui-item-title">${en.perm_group_employees}<svg[^]*?</svg></span><span class="ui-item-detail">${en.roles_group_held.replace("{held}", "2").replace("{total}", "\\d+")}</span></button>`))
        expect(html).toMatch(new RegExp(`aria-expanded="false" aria-controls="[^"]+"><span class="ui-item-title">${en.perm_group_tasks}<`))
        expect(html).toMatch(new RegExp(`<ul id="[^"]+" class="ui-perm-rows" aria-label="${en.perm_group_tasks}" hidden="">`))
    })

    it("gives each permission a checkbox named for it, its risk as a badge, what needs it, and its scope as a named select", async () => {
        const html = await matrix({ grants: { "employees.create": "COMPANY", "employees.view": "TEAM" } })
        expect(html).toMatch(new RegExp(`<label class="ui-choice"><input type="checkbox" class="ui-check"[^>]*name="perm-employees.create"[^>]*checked=""[^>]*/>${en.perm_employees_create}</label>`))
        expect(html).toContain(`<span class="ui-badge ui-badge-problem">${en.risk_cannot_be_undone}</span>`)
        // Viewing is needed by adding, so it can't be unticked while adding is ticked.
        expect(html.match(/<input[^>]*name="perm-employees.view"[^>]*>/)![0]).toContain('disabled=""')
        expect(html).toContain(esc(en.roles_needed_by.replace("{name}", en.perm_employees_create)))
        expect(html).toMatch(new RegExp(`<select[^>]*aria-label="${esc(en.who_can_scope)}: ${en.perm_employees_view}"[^>]*>`))
        expect(html).toContain(`<option value="TEAM" selected="">${en.scope_TEAM}</option>`)
        // One scope only: said, not chosen.
        expect(html).toContain(`<span class="ui-perm-scope">${en.scope_COMPANY}</span>`)
    })

    it("greys a permission outside the company's package and says why", async () => {
        const access = { unrestricted: false, bundles: [] }
        const html = await matrix({ grants: {}, access })
        expect(html).toMatch(/<li data-outside="true">/)
        expect(html).toContain(esc(en.roles_not_in_package))
    })
})

describe("nothing of the old editor is left", () => {
    it("has no inline styles, old window, old controls or drawn arrows", () => {
        for (const file of ["components/RoleEditorModal.tsx", "components/PermissionMatrix.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toContain("@/components/Modal'")
            expect(source, file).not.toMatch(/className="(input|btn)/)
            expect(source, file).not.toContain("isRtl")
            expect(source, file).not.toMatch(/[▾▸]/)
        }
    })
})

describe("found in the browser and the audit (company settings part 4c)", () => {
    it("widens the editor's dialog so each permission's scope sits beside it on a computer", () => {
        // In the 440px dialog the scope wrapped under every permission, doubling the list.
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-dialog:has\(\.ui-perm-matrix\) \{\s*width: min\(100%, 640px\);/)
        expect(readFileSync("DESIGN.md", "utf8").replace(/\s+/g, " ")).toContain("such as a role's permissions, is up to 640px wide")
    })

    it("ties why a permission is greyed to its checkbox, so a screen reader says it", async () => {
        const { default: PermissionMatrix } = await import("@/components/PermissionMatrix")
        const html = render(h(PermissionMatrix, { grants: { "employees.create": "COMPANY", "employees.view": "TEAM" }, onChange: () => {} } as never))
        const box = html.match(/<input[^>]*name="perm-employees.view"[^>]*>/)![0]
        const described = box.match(/aria-describedby="([^"]+)"/)
        expect(described).not.toBeNull()
        expect(html).toContain(`<span id="${described![1]}" class="ui-hint ui-choice-hint">${esc(en.roles_needed_by.replace("{name}", en.perm_employees_create))}</span>`)
        // A box with nothing to say has nothing to point at.
        expect(html.match(/<input[^>]*name="perm-employees.create"[^>]*>/)![0]).not.toContain("aria-describedby")
    })
})
