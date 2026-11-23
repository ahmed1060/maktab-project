import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { narrowestAtLeast, unmetLines, withNeed } from "./permissions/matrix"
import type { Grants } from "./permissions/grants"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Rule 4 between permissions, roles already saved (LATER_CHANGES_PLAN.md
 * §5.1, PR 375): a role or template saved before rule 1 (PR 372) that holds a
 * permission without another area's it needs is marked in the Super Admin's
 * lists, "Needs a permission", with a line for each need, and its row in the
 * role editor offers "Add See locations", which ticks it at the narrowest
 * scope wide enough. It changes the form only: Save is the confirmation, and
 * nothing widens anyone's access on its own.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const tOf = (words: typeof en) => (key: string) => (words as Record<string, string>)[key] ?? key
const rows = (grants: Grants) => Object.entries(grants).map(([permission, scope]) => ({ permission, scope: scope as string }))
const OLD_TASKS = { "tasks.create": "COMPANY", "tasks.view": "COMPANY" } as Grants
const OLD_SALARY = { "salary.edit": "COMPANY", "salary.view": "COMPANY", "employees.view": "TEAM" } as Grants

describe("what a role saved before still needs, in words", () => {
    it("is a line for each need, naming both", () => {
        expect(unmetLines(tOf(en), rows(OLD_TASKS))).toEqual([
            en.roles_unmet_line.replace("{permission}", en.perm_tasks_create).replace("{name}", en.perm_locations_view),
        ])
    })

    it("says when the one needed is held, but not for the company", () => {
        expect(unmetLines(tOf(en), rows(OLD_SALARY))).toEqual([
            en.roles_unmet_line_company.replace("{permission}", en.perm_salary_edit).replace("{name}", en.perm_employees_view),
        ])
    })

    it("is nothing for a role that meets rule 1", () => {
        expect(unmetLines(tOf(en), rows({ ...OLD_TASKS, "locations.view": "COMPANY" }))).toEqual([])
    })

    it("is in Arabic too", () => {
        expect(unmetLines(tOf(ar), rows(OLD_TASKS))).toEqual([
            ar.roles_unmet_line.replace("{permission}", ar.perm_tasks_create).replace("{name}", ar.perm_locations_view),
        ])
    })
})

describe("the Super Admin's lists", () => {
    it("mark each company role that needs one, and say what", () => {
        const card = stripComments(readFileSync("components/CompanyRolesCard.tsx", "utf8"))
        expect(card).toContain("const unmet = unmetLines(t, role.grants)")
        expect(card).toContain(`{unmet.length > 0 && <>{' '}<StatusBadge tone="problem">{t('roles_needs_fixing')}</StatusBadge></>}`)
        expect(card).toContain("note={unmet}")
    })

    it("mark each template that needs one, and say what, above its description", () => {
        const page = stripComments(readFileSync("app/(dashboard)/dashboard/role-templates/page.tsx", "utf8"))
        expect(page).toContain("const unmet = unmetLines(t, template.grants)")
        expect(page).toContain(`{unmet.length > 0 && <>{' '}<StatusBadge tone="problem">{t('roles_needs_fixing')}</StatusBadge></>}`)
        expect(page).toContain("note={[...unmet, template.description && <bdi>{template.description}</bdi>]}")
    })
})

describe("fixing it in the role editor", () => {
    const matrix = async (grants: Grants, props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
        state.locale = locale
        const { default: PermissionMatrix } = await import("@/components/PermissionMatrix")
        return renderToStaticMarkup(h(PermissionMatrix, { grants, onChange: () => {}, ...props } as never))
    }
    const row = (html: string, p: string) => html.match(new RegExp(`<li[^>]*>(?:(?!</li>).)*name="perm-${p.replace(".", "\\.")}"(?:(?!</li>).)*</li>`, "s"))![0]
    const button = (words: typeof en, name: string) => new RegExp(`<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm"[^>]*>${esc(words.roles_add_needed.replace("{name}", name))}</button>`)

    it("ticks what's needed at the narrowest scope wide enough", () => {
        expect(withNeed(OLD_TASKS, "tasks.create", "locations.view")).toEqual({ ...OLD_TASKS, "locations.view": "COMPANY" })
        // Held for a team, needed for the company: widened only as far as needed.
        expect(withNeed(OLD_SALARY, "salary.edit", "employees.view")).toEqual({ ...OLD_SALARY, "employees.view": "COMPANY" })
        // Create tasks for a team: See locations is the company's only, so that's the narrowest.
        expect(withNeed({ "tasks.create": "TEAM", "tasks.view": "TEAM" } as Grants, "tasks.create", "locations.view")["locations.view"]).toBe("COMPANY")
    })

    it("widens nobody further than needed, for a need a team's scope would meet", () => {
        expect(narrowestAtLeast(["TEAM", "COMPANY"], "TEAM")).toBe("TEAM")
        expect(narrowestAtLeast(["TEAM", "COMPANY"], "COMPANY")).toBe("COMPANY")
        expect(narrowestAtLeast(["COMPANY"], "TEAM")).toBe("COMPANY")
        expect(narrowestAtLeast(["TEAM"], "COMPANY")).toBeUndefined()
    })

    it("offers it on the row that's ticked without what it needs", async () => {
        expect(row(await matrix(OLD_TASKS), "tasks.create")).toMatch(button(en, en.perm_locations_view))
        expect(row(await matrix(OLD_SALARY), "salary.edit")).toMatch(button(en, en.perm_employees_view))
    })

    it("and nowhere else: not on a row that's only greyed, nor one that has it", async () => {
        expect(row(await matrix({}), "tasks.create")).not.toContain(en.roles_add_needed.split("{name}")[0])
        expect(row(await matrix({ ...OLD_TASKS, "locations.view": "COMPANY" }), "tasks.create")).not.toContain(en.roles_add_needed.split("{name}")[0])
    })

    it("sits under its row's name, as the note does", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-perm-main > \.ui-choice-hint,\n\.ui-perm-main > \.ui-btn \{\n  margin-block-start: 0;\n  margin-inline-start: calc\(18px \+ var\(--space-2\)\);/)
    })

    it("is off where the matrix is, as for the built-in Admin", async () => {
        const html = row(await matrix(OLD_TASKS, { disabled: true }), "tasks.create")
        expect(html.match(button(en, en.perm_locations_view))![0]).toContain('disabled=""')
    })

    it("changes the form only, through what a tick does", () => {
        const source = stripComments(readFileSync("components/PermissionMatrix.tsx", "utf8"))
        expect(source).toContain("onClick={() => onChange(withNeed(grants, p, u.needs))}")
        expect(source).toContain("{scope && missing.map(u => (")
    })

    it("is in Arabic too", async () => {
        expect(row(await matrix(OLD_TASKS, {}, "ar"), "tasks.create")).toMatch(button(ar, ar.perm_locations_view))
    })
})

describe("the words", () => {
    it("are in both languages", () => {
        for (const key of ["roles_needs_fixing", "roles_unmet_line", "roles_unmet_line_company", "roles_add_needed"]) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
        }
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of ["roles_unmet_line", "roles_unmet_line_company"]) {
                expect(words[key], key).toContain("{permission}")
                expect(words[key], key).toContain("{name}")
            }
            expect(words.roles_add_needed).toContain("{name}")
        }
    })
})
