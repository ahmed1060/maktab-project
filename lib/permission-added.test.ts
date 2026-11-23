import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { addedFor, untick } from "./permissions/matrix"
import type { Grants } from "./permissions/grants"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Rule 2 between permissions, its own area's (LATER_CHANGES_PLAN.md §5.1,
 * PR 374): a permission ticked for another of its area says why on its row,
 * "Added because Create tasks needs it", and unticking it asks first, "Create
 * tasks needs it. Remove both?", removing what needs it with it, all the way
 * down, as what needs it would only bring it back. Where it was greyed. One
 * another area's permission needs (rule 1, PR 372) asks the same, its note
 * still "Needed by", as the Super Admin ticked it.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const list = (locale: "en" | "ar", names: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(names)
const TASKS = { "tasks.view": "COMPANY", "tasks.create": "COMPANY", "locations.view": "COMPANY" } as Grants

describe("a row ticked for another of its area", () => {
    it("is known as added for what brings it", () => {
        expect(addedFor({ "obligations.approve": "COMPANY", "obligations.view": "COMPANY" })).toEqual({ "obligations.view": ["obligations.approve"] })
        expect(addedFor({ ...TASKS, "tasks.edit": "COMPANY" })["tasks.view"]).toEqual(["tasks.create", "tasks.edit"])
    })

    it("isn't, when another area's needs it: the Super Admin ticked that", () => {
        expect(addedFor(TASKS)["locations.view"]).toBeUndefined()
    })
})

describe("unticking a row another needs", () => {
    it("takes what needs it with it", () => {
        expect(untick({ ...TASKS, "tasks.edit": "COMPANY" }, "tasks.view")).toEqual({ grants: { "locations.view": "COMPANY" }, also: ["tasks.create", "tasks.edit"] })
    })

    it("all the way down, as what's left would only bring it back", () => {
        expect(untick({ "payroll.prepare": "COMPANY", "payroll.view": "COMPANY", "salary.view": "COMPANY" }, "salary.view"))
            .toEqual({ grants: {}, also: ["payroll.view", "payroll.prepare"] })
    })

    it("for another area's need too", () => {
        expect(untick(TASKS, "locations.view")).toEqual({ grants: { "tasks.view": "COMPANY" }, also: ["tasks.create"] })
    })

    it("still unticks in a role saved before that lacks another area's need, as setGrant ticks", () => {
        // Create tasks without See locations, from before rule 1 (PR 372): marked, not refused, on the screen.
        const before = { "tasks.create": "COMPANY", "tasks.view": "COMPANY", "obligations.approve": "COMPANY", "obligations.view": "COMPANY" } as Grants
        expect(untick(before, "obligations.view")).toEqual({ grants: { "tasks.create": "COMPANY", "tasks.view": "COMPANY" }, also: ["obligations.approve"] })
    })

    it("takes nothing else where nothing needs it, or what needs it is brought by another", () => {
        expect(untick(TASKS, "tasks.create")).toEqual({ grants: { "tasks.view": "COMPANY", "locations.view": "COMPANY" }, also: [] })
        // See debts, brought by Waive debts, needs no See employees.
        const waiver = { "debts.waive": "COMPANY", "debts.view": "COMPANY", "payroll.view": "COMPANY", "salary.view": "COMPANY", "employees.view": "COMPANY" } as Grants
        expect(untick(waiver, "employees.view").also).toEqual([])
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

    it("says why a row was ticked for another of its area, and lets it be unticked", async () => {
        const html = await matrix(TASKS)
        const note = esc(en.roles_added_because_one.replace("{names}", en.perm_tasks_create))
        expect(row(html, "tasks.view")).toContain(`class="ui-hint ui-choice-hint">${note}<`)
        expect(box(html, "tasks.view")).not.toContain('disabled=""')
        expect(box(html, "tasks.view")).toContain("aria-describedby=")
        // Said once, as added: not as needed too.
        expect(row(html, "tasks.view")).not.toContain(en.roles_needed_by.split("{name}")[0])
    })

    it("names each that needs it", async () => {
        const html = await matrix({ ...TASKS, "tasks.edit": "COMPANY" })
        expect(row(html, "tasks.view")).toContain(esc(en.roles_added_because_many.replace("{names}", list("en", [en.perm_tasks_create, en.perm_tasks_edit]))))
    })

    it("keeps another area's need as Needed by, and lets it be unticked too", async () => {
        const html = await matrix(TASKS)
        expect(row(html, "locations.view")).toContain(esc(en.roles_needed_by.replace("{name}", en.perm_tasks_create)))
        expect(row(html, "locations.view")).not.toContain(en.roles_added_because_one.split("{names}")[0])
        expect(box(html, "locations.view")).not.toContain('disabled=""')
    })

    it("is in Arabic too", async () => {
        const html = await matrix(TASKS, "ar")
        expect(row(html, "tasks.view")).toContain(esc(ar.roles_added_because_one.replace("{names}", ar.perm_tasks_create)))
    })

    it("asks before unticking one another needs, over the role editor, and only then", () => {
        const source = stripComments(readFileSync("components/PermissionMatrix.tsx", "utf8"))
        expect(source).toContain("const out = untick(grants, p)")
        expect(source).toContain("if (out.also.length) setAsking({ permission: p, ...out })")
        expect(source).toContain("else onChange(out.grants)")
        expect(source).toMatch(/<ConfirmDialog\s+open=\{!!asking\}\s+overModal/)
        expect(source).toContain("onConfirm={() => { if (asking) onChange(asking.grants); setAsking(null) }}")
        expect(source).toContain("onCancel={() => setAsking(null)}")
        expect(source).toContain("t('roles_remove_title').replace('{name}', label(asking.permission))")
        expect(source).toContain("t(asking.also.length === 1 ? 'roles_remove_needs_one' : 'roles_remove_needs_many').replace('{names}', names(asking.also))")
        expect(source).toContain("t(asking && asking.also.length > 1 ? 'roles_remove_all' : 'roles_remove_both')")
        // Greyed only while it waits for another area's (rule 1), never because another needs it.
        expect(source).toContain("disabled={disabled || (!scope && missing.length > 0)}")
    })
})

describe("the words", () => {
    it("are in both languages", () => {
        const keys = ["roles_added_because_one", "roles_added_because_many", "roles_remove_title", "roles_remove_needs_one", "roles_remove_needs_many", "roles_remove_both", "roles_remove_all"]
        for (const key of keys) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
        }
        for (const words of [en, ar] as Record<string, string>[]) {
            for (const key of ["roles_added_because_one", "roles_added_because_many", "roles_remove_needs_one", "roles_remove_needs_many"]) expect(words[key], key).toContain("{names}")
            expect(words.roles_remove_title).toContain("{name}")
        }
    })

    it("say what the plan says, in English", () => {
        expect(en.roles_added_because_one.replace("{names}", "Approve obligations")).toBe("Added because Approve obligations needs it")
        expect(`${en.roles_remove_needs_one.replace("{names}", "Approve obligations")} ${en.roles_remove_both}`).toBe("Approve obligations needs it. Remove both")
    })
})
