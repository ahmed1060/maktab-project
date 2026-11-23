import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { PERMISSIONS, lessWithoutOf, type Permission } from "./permissions/catalogue"
import { worksWithLess, newWorksWithLess } from "./permissions/grant-rules"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { createRoleSchema, updateRoleSchema, createTemplateSchema, updateTemplateSchema } from "./validations/role.schema"
import type { Grants } from "./permissions/grants"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Rule 3 between permissions, works with less (LATER_CHANGES_PLAN.md §5.1,
 * §5.3; PR 373): a permission that works without another, but does less, is
 * saved once the Super Admin confirms a warning naming what's missing, as a
 * separation-of-duties pair is (ROLES_PLAN.md §6.11). The role editor lists
 * each one the role holds; one a save newly brings needs confirming, and the
 * server refuses it otherwise and records the decision. Held or not counts,
 * not how wide, and one another held permission brings with it warns of
 * nothing.
 */

const LESS: [Permission, Permission][] = [
    ["tasks.create", "clients.view"],
    ["salary.view", "employees.view"],
    ["settings.edit", "salary.view"],
]

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const TASKS = { "tasks.create": "COMPANY", "tasks.view": "COMPANY", "locations.view": "COMPANY" } as Grants

describe("the list of what works with less, in the catalogue", () => {
    it("is §5.3's, as approved, and nothing more", () => {
        const written = (Object.keys(PERMISSIONS) as Permission[]).flatMap(p => lessWithoutOf(p).map(w => [p, w] as [Permission, Permission]))
        expect(written.sort()).toEqual([...LESS].sort())
    })

    it("warns of nothing in the built-in roles", () => {
        for (const [role, grants] of Object.entries(BUILT_IN_GRANTS)) expect(worksWithLess(grants as Grants), role).toEqual([])
    })
})

describe("what a role holds that works with less", () => {
    it("is a permission without the one it does less without", () => {
        expect(worksWithLess(TASKS)).toEqual([{ permission: "tasks.create", without: "clients.view" }])
        expect(worksWithLess({ ...TASKS, "clients.view": "COMPANY" })).toEqual([])
        expect(worksWithLess({ "settings.edit": "COMPANY", "settings.view": "COMPANY" })).toEqual([{ permission: "settings.edit", without: "salary.view" }])
    })

    it("counts the other held at all, however wide: scope is for rules 1 and 2", () => {
        expect(worksWithLess({ "salary.view": "COMPANY", "employees.view": "TEAM" })).toEqual([])
        expect(worksWithLess({ "salary.view": "TEAM" })).toEqual([{ permission: "salary.view", without: "employees.view" }])
    })

    it("is nothing for a permission another brings with it: See salaries, brought by See payroll", () => {
        expect(worksWithLess({ "payroll.view": "COMPANY", "salary.view": "COMPANY" })).toEqual([])
        // Brought, it still counts as held for what does less without it.
        expect(worksWithLess({ "settings.edit": "COMPANY", "settings.view": "COMPANY", "payroll.view": "COMPANY", "salary.view": "COMPANY" })).toEqual([])
    })

    it("is new only when the role didn't hold it before", () => {
        expect(newWorksWithLess({}, TASKS)).toEqual([{ permission: "tasks.create", without: "clients.view" }])
        expect(newWorksWithLess(TASKS, { ...TASKS, "records.view": "COMPANY" })).toEqual([])
        expect(newWorksWithLess(TASKS, { ...TASKS, "salary.view": "COMPANY" })).toEqual([{ permission: "salary.view", without: "employees.view" }])
    })
})

describe("saving a role or a template", () => {
    it("is refused while what it newly brings isn't confirmed, and keeps what was confirmed", async () => {
        const { checkLess, LessError } = await import("./services/role.service")
        expect(() => checkLess({}, TASKS, undefined)).toThrow(LessError)
        expect(() => checkLess({}, TASKS, false)).toThrow("LESS_UNACKNOWLEDGED")
        expect(checkLess({}, TASKS, true)).toEqual([{ permission: "tasks.create", without: "clients.view" }])
        // Held before: not asked again.
        expect(checkLess(TASKS, TASKS, undefined)).toEqual([])
        try { checkLess({}, TASKS, false) } catch (e) { expect((e as InstanceType<typeof LessError>).missing).toEqual([{ permission: "tasks.create", without: "clients.view" }]) }
    })

    it("asks it everywhere a role or template is saved, and records the decision", () => {
        const roles = stripComments(readFileSync("lib/services/role.service.ts", "utf8"))
        const templates = stripComments(readFileSync("lib/services/role-template.service.ts", "utf8"))
        expect(roles).toContain("const less = checkLess({}, verdict.grants, input.acknowledgeLess)")
        expect(roles).toContain("less = checkLess(grantsFromRows(before.grants), verdict.grants, input.acknowledgeLess)")
        expect(templates).toContain("const less = checkLess({}, verdict.grants, input.acknowledgeLess)")
        expect(templates).toContain("less = checkLess(had.ok ? had.grants : {}, verdict.grants, input.acknowledgeLess)")
        const recorded = "...(less.length ? { worksWithLess: { missing: less, acknowledged: true } } : {})"
        expect(roles.split(recorded)).toHaveLength(3)
        expect(templates.split(recorded)).toHaveLength(3)
    })

    it("doesn't ask again when applying a template or copying a company's roles, as for the pairs", () => {
        const roles = stripComments(readFileSync("lib/services/role.service.ts", "utf8"))
        const templates = stripComments(readFileSync("lib/services/role-template.service.ts", "utf8"))
        expect(roles).toContain("acknowledgeConflicts: true,\n                acknowledgeLess: true,")
        expect(roles).toContain("RoleService.update({ id: to.id, grants: from.grants, acknowledgeConflicts: true, acknowledgeLess: true }, session)")
        expect(templates).toContain("RoleService.update({ id: role.id, grants: template.grants, acknowledgeConflicts: true, acknowledgeLess: true,")
    })

    it("takes the confirmation in each of the four writes", () => {
        const sample = { companyId: "c1", id: "r1", name: "Desk", baseRole: "EMPLOYEE", grants: [], acknowledgeLess: true }
        for (const schema of [createRoleSchema, updateRoleSchema, createTemplateSchema, updateTemplateSchema]) {
            expect((schema.parse(sample) as { acknowledgeLess?: boolean }).acknowledgeLess).toBe(true)
        }
    })

    it("reads in the audit log by the permissions' names", async () => {
        const { describeDetails } = await import("./audit-details")
        for (const [words, locale] of [[en, "en"], [ar, "ar"]] as const) {
            const t = (key: string) => (words as Record<string, string>)[key] ?? ""
            const text = JSON.stringify(describeDetails({ worksWithLess: { missing: [{ permission: "tasks.create", without: "clients.view" }], acknowledged: true } }, { t, locale } as never))
            for (const shown of [words.audit_field_worksWithLess, words.audit_field_missing, words.perm_tasks_create, words.audit_field_without, words.perm_clients_view]) expect(text, `${locale} ${shown}`).toContain(shown)
        }
    })

    it("answers a caller that didn't confirm with what's missing", async () => {
        const { LessError } = await import("./services/role.service")
        const { roleErrorResponse } = await import("./role-errors")
        const res = roleErrorResponse(new LessError([{ permission: "tasks.create", without: "clients.view" }]))!
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(JSON.stringify(body)).toContain('"worksWithLess":[{"permission":"tasks.create","without":"clients.view"}]')
    })
})

describe("the role editor", () => {
    const role = (grants: Grants) => ({ id: "r1", name: "Task desk", description: null, baseRole: "EMPLOYEE", grants: Object.entries(grants).map(([permission, scope]) => ({ permission, scope })), builtIn: null, holders: 0, locked: false })
    const editor = async (props: Record<string, unknown>, locale: "en" | "ar" = "en") => {
        state.locale = locale
        const { default: RoleEditorModal } = await import("@/components/RoleEditorModal")
        vi.stubGlobal("document", { body: {} })
        try {
            return renderToStaticMarkup(h(RoleEditorModal, { isOpen: true, onClose: () => {}, kind: "role", role: null, onSubmit: async () => true, ...props } as never))
        } finally {
            vi.unstubAllGlobals()
        }
    }
    const item = (words: typeof en, p: Permission, w: Permission, effect: keyof typeof en) => words.roles_less_item
        .replace("{permission}", words[`perm_${p.replace(".", "_")}` as keyof typeof en])
        .replace("{without}", words[`perm_${w.replace(".", "_")}` as keyof typeof en])
        .replace("{effect}", words[effect])

    it("lists what the role holds that works with less, in a warning's colour, naming what's missing", async () => {
        const html = await editor({ role: role(TASKS) })
        expect(html).toMatch(new RegExp(`<section class="ui-dialog-note" data-tone="waiting"[^>]*><h3 class="ui-subsection-title"[^>]*>${en.roles_less_title}</h3><p>${esc(en.roles_less_hint)}</p>`))
        expect(html).toContain(`<li>${esc(item(en, "tasks.create", "clients.view", "roles_less_tasks_create_clients_view"))}</li>`)
        // Held before: shown, nothing to confirm.
        expect(html).not.toContain(esc(en.roles_less_acknowledge))
        expect(await editor({ role: role({ ...TASKS, "clients.view": "COMPANY" }) })).not.toContain(en.roles_less_title)
    })

    it("asks to confirm one a save newly brings, and won't send it otherwise", async () => {
        const { roleErrors } = await import("@/components/RoleEditorModal")
        expect(roleErrors({ name: "Task desk", addedPairs: 0, acknowledged: false, addedLess: 1, keptLess: false })).toEqual({ less: "roles_less_acknowledge_required" })
        expect(roleErrors({ name: "Task desk", addedPairs: 0, acknowledged: false, addedLess: 1, keptLess: true })).toEqual({})
        const source = stripComments(readFileSync("components/RoleEditorModal.tsx", "utf8"))
        expect(source).toContain("const addedLess = newWorksWithLess(original, grants)")
        expect(source).toContain("addedLess: addedLess.length, keptLess")
        expect(source).toContain("if (found.name || found.acknowledge || found.needs || found.less)")
        expect(source).toContain("...(addedLess.length && keptLess ? { acknowledgeLess: true } : {}),")
        expect(source).toContain('{addedLess.length > 0 && (')
        expect(source).toContain('name="acknowledgeLess" checked={keptLess}')
        expect(source).toContain("{errors.less && <span id={`${id}-less-ack`} className=\"ui-error\">{t(errors.less)}</span>}")
    })

    it("sends the confirmation from both screens that save one", () => {
        const card = stripComments(readFileSync("components/CompanyRolesCard.tsx", "utf8"))
        expect(card).toContain("...(submission.acknowledgeLess ? { acknowledgeLess: true } : {}),")
        const templates = stripComments(readFileSync("app/(dashboard)/dashboard/role-templates/page.tsx", "utf8"))
        expect(templates).toContain("const { name, description, baseRole, grants, acknowledgeConflicts, acknowledgeLess } = submission")
        expect(templates).toContain("{ name, description, baseRole, grants, acknowledgeConflicts, acknowledgeLess }")
        expect(templates).toContain("{ id: (editing as Template).id, name, description, baseRole, grants, acknowledgeConflicts, acknowledgeLess }")
    })

    it("is in Arabic too", async () => {
        const html = await editor({ role: role({ "salary.view": "COMPANY" }) }, "ar")
        expect(html).toContain(`>${ar.roles_less_title}</h3>`)
        expect(html).toContain(`<li>${esc(item(ar, "salary.view", "employees.view", "roles_less_salary_view_employees_view"))}</li>`)
    })

    it("has the words in both languages, for each of the list", () => {
        const keys = ["roles_less_title", "roles_less_hint", "roles_less_item", "roles_less_acknowledge", "roles_less_acknowledge_required", "audit_field_worksWithLess", "audit_field_missing", "audit_field_without",
            ...LESS.map(([p, w]) => `roles_less_${p.replace(".", "_")}_${w.replace(".", "_")}`)]
        for (const key of keys) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
        }
        for (const words of [en, ar]) for (const slot of ["{permission}", "{without}", "{effect}"]) expect(words.roles_less_item).toContain(slot)
    })
})
