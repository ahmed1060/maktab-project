import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { PERMISSIONS, requiresOf, type Permission } from "./permissions/catalogue"
import { normalizeGrants, unmetNeeds } from "./permissions/grant-rules"
import { setGrant, neededBy } from "./permissions/matrix"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import type { Grants } from "./permissions/grants"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Rule 1 between permissions, another area's ticked first
 * (LATER_CHANGES_PLAN.md §5.1, §5.3; PR 372): a permission that can't work
 * without one from another area stays greyed in the role editor, with
 * "Needs See locations first", until that one is ticked, and the server
 * refuses to save a role that breaks it, naming what's missing. Nothing is
 * ticked for the Super Admin: across areas, that would give access nobody
 * chose. A needed permission is held at least as wide as what needs it, and
 * one that another brings with it carries no needs of its own.
 */

const NEEDS: [Permission, Permission][] = [
    ["tasks.create", "locations.view"],
    ["salary.edit", "employees.view"],
    ["dayoff.adjust_credit", "employees.view"],
    ["salary_adjustments.manage", "employees.view"],
    ["settlements.manage", "employees.view"],
    ["debts.view", "employees.view"],
    ["costs.view", "employees.view"],
    ["requests.reset_points", "employees.view"],
    ["debts.waive", "payroll.view"],
]
const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const rows = (grants: Grants) => Object.entries(grants).map(([permission, scope]) => ({ permission, scope: scope as string }))

describe("the list of needs, in the catalogue", () => {
    it("is §5.3's, as approved, and nothing more", () => {
        const written = (Object.keys(PERMISSIONS) as Permission[]).flatMap(p => requiresOf(p).map(n => [p, n] as [Permission, Permission]))
        expect(written.sort()).toEqual([...NEEDS].sort())
    })

    it("is met by each built-in role", () => {
        for (const [role, grants] of Object.entries(BUILT_IN_GRANTS)) expect(unmetNeeds(grants as Grants), role).toEqual([])
    })
})

describe("what a role still needs", () => {
    it("is another area's permission it doesn't hold", () => {
        expect(unmetNeeds({ "tasks.create": "COMPANY", "tasks.view": "COMPANY" })).toEqual([{ permission: "tasks.create", needs: "locations.view", companyWide: false }])
        expect(unmetNeeds({ "tasks.create": "TEAM", "tasks.view": "TEAM", "locations.view": "COMPANY" })).toEqual([])
    })

    it("is held at least as wide as what needs it: for the company, for the company", () => {
        expect(unmetNeeds({ "salary.edit": "COMPANY", "salary.view": "COMPANY", "employees.view": "TEAM" }))
            .toEqual([{ permission: "salary.edit", needs: "employees.view", companyWide: true }])
        expect(unmetNeeds({ "salary.edit": "COMPANY", "salary.view": "COMPANY", "employees.view": "COMPANY" })).toEqual([])
    })

    it("is nothing for a permission another brings with it: See debts, brought by Waive debts, needs no See employees", () => {
        expect(unmetNeeds({ "debts.waive": "COMPANY", "debts.view": "COMPANY", "payroll.view": "COMPANY", "salary.view": "COMPANY" })).toEqual([])
        expect(unmetNeeds({ "debts.view": "COMPANY" })).toEqual([{ permission: "debts.view", needs: "employees.view", companyWide: false }])
        expect(unmetNeeds({ "debts.waive": "COMPANY", "debts.view": "COMPANY" })).toEqual([{ permission: "debts.waive", needs: "payroll.view", companyWide: false }])
    })
})

describe("saving a role or a template", () => {
    it("is refused while one of its permissions still needs another, naming what's missing", () => {
        const verdict = normalizeGrants(rows({ "tasks.create": "COMPANY" }))
        expect(verdict).toEqual({ ok: false, errors: ["tasks.create needs locations.view first"] })
        expect(normalizeGrants(rows({ "salary.edit": "COMPANY", "employees.view": "TEAM" })))
            .toEqual({ ok: false, errors: ["salary.edit needs employees.view for the company first"] })
    })

    it("ticks nothing for the Super Admin", () => {
        expect(normalizeGrants(rows({ "tasks.create": "COMPANY", "locations.view": "COMPANY" }))).toEqual({
            ok: true, grants: { "tasks.create": "COMPANY", "tasks.view": "COMPANY", "locations.view": "COMPANY" },
        })
    })

    it("goes through that refusal everywhere a role or template is written", () => {
        const roles = stripComments(readFileSync("lib/services/role.service.ts", "utf8"))
        const templates = stripComments(readFileSync("lib/services/role-template.service.ts", "utf8"))
        expect(roles.match(/normalizeGrants\(/g)).toHaveLength(2)
        expect(roles).not.toContain("needs: false")
        expect(templates.match(/normalizeGrants\(input\.grants\)/g)).toHaveLength(2)
        // What a template held before, read to compare, isn't a save.
        expect(templates).toContain("normalizeGrants(before.grants, { needs: false })")
    })
})

describe("the role editor's matrix", () => {
    const matrix = async (grants: Grants, locale: "en" | "ar" = "en") => {
        state.locale = locale
        const { default: PermissionMatrix } = await import("@/components/PermissionMatrix")
        return renderToStaticMarkup(h(PermissionMatrix, { grants, onChange: () => {} }))
    }
    const box = (html: string, p: string) => html.match(new RegExp(`<input[^>]*name="perm-${p.replace(".", "\\.")}"[^>]*>`))![0]
    const row = (html: string, p: string) => html.match(new RegExp(`<li[^>]*>(?:(?!</li>).)*name="perm-${p.replace(".", "\\.")}"(?:(?!</li>).)*</li>`, "s"))![0]

    it("greys a permission that needs another first, and says which, until that one is ticked", async () => {
        const without = await matrix({})
        expect(box(without, "tasks.create")).toContain('disabled=""')
        expect(row(without, "tasks.create")).toContain(en.roles_needs_first.replace("{name}", en.perm_locations_view))
        const withIt = await matrix({ "locations.view": "COMPANY" })
        expect(box(withIt, "tasks.create")).not.toContain('disabled=""')
        expect(row(withIt, "tasks.create")).not.toContain(en.roles_needs_first.replace("{name}", en.perm_locations_view))
    })

    it("says when the one needed is held, but not for the company", async () => {
        const html = await matrix({ "employees.view": "TEAM" })
        expect(row(html, "salary.edit")).toContain(en.roles_needs_first_company.replace("{name}", en.perm_employees_view))
        expect(box(html, "salary.edit")).toContain('disabled=""')
    })

    it("lets a role saved before untick one it holds without what it needs, and says what it needs", async () => {
        const html = await matrix({ "tasks.create": "COMPANY", "tasks.view": "COMPANY" })
        expect(box(html, "tasks.create")).toContain('checked=""')
        expect(box(html, "tasks.create")).not.toContain('disabled=""')
        expect(row(html, "tasks.create")).toContain(en.roles_needs_first.replace("{name}", en.perm_locations_view))
        expect(box(html, "tasks.create")).toContain('aria-invalid="true"')
        // Said as an error there, and as a hint where it's only greyed.
        expect(row(html, "tasks.create")).toContain(`class="ui-error ui-choice-hint">${en.roles_needs_first.replace("{name}", en.perm_locations_view)}<`)
        expect(row(await matrix({}), "tasks.create")).toContain(`class="ui-hint ui-choice-hint">${en.roles_needs_first.replace("{name}", en.perm_locations_view)}<`)
        expect(box(await matrix({ "tasks.create": "COMPANY", "tasks.view": "COMPANY", "locations.view": "COMPANY" }), "tasks.create")).not.toContain("aria-invalid")
    })

    it("says what needs the one needed, and asks before it goes, as for its own area's (PR 374)", async () => {
        const grants = { "tasks.create": "COMPANY", "tasks.view": "COMPANY", "locations.view": "COMPANY" } as Grants
        expect(neededBy(grants)["locations.view"]).toEqual(["tasks.create"])
        const html = await matrix(grants)
        expect(box(html, "locations.view")).not.toContain('disabled=""')
        expect(row(html, "locations.view")).toContain(en.roles_needed_by.replace("{name}", en.perm_tasks_create))
        // Brought by Waive debts, See debts needs nothing of its own.
        const waiver = { "debts.waive": "COMPANY", "debts.view": "COMPANY", "payroll.view": "COMPANY", "salary.view": "COMPANY", "employees.view": "COMPANY" } as Grants
        expect(neededBy(waiver)["employees.view"]).toBeUndefined()
    })

    it("ticks a row without refusing it on the screen: the screen greys, the server refuses", () => {
        expect(setGrant({}, "debts.view", "COMPANY")).toEqual({ "debts.view": "COMPANY" })
    })

    it("is in Arabic too", async () => {
        const html = await matrix({}, "ar")
        expect(row(html, "tasks.create")).toContain(ar.roles_needs_first.replace("{name}", ar.perm_locations_view))
    })
})

describe("the role editor", () => {
    it("won't send a role whose permissions still need others, and says so", () => {
        const source = stripComments(readFileSync("components/RoleEditorModal.tsx", "utf8"))
        expect(source).toContain("if (unmet > 0) errors.needs = 'roles_needs_missing'")
        expect(source).toContain("roleErrors({ name, addedPairs: addedPairs.length, acknowledged, unmet: unmetNeeds(grants).length, addedLess: addedLess.length, keptLess })")
        expect(source).toContain("if (found.name || found.acknowledge || found.needs || found.less)")
        expect(source).toContain('{errors.needs && <span className="ui-error" role="alert">{t(errors.needs)}</span>}')
    })

    it("has the words in both languages", () => {
        for (const key of ["roles_needs_first", "roles_needs_first_company", "roles_needs_missing"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
        expect(ar.roles_needs_first).toContain("{name}")
        expect(ar.roles_needs_first_company).toContain("{name}")
    })
})
