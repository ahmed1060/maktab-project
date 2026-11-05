import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The Super Admin's pages on the building blocks, part 1 (UI_PLAN.md §5 step
 * 5): the Templates group's role templates and attendance policy templates,
 * each a page header with New template and the templates as rows with a menu,
 * deleting one asked first, and offering a role template's change to the
 * companies that copied it. Their editors moved in company settings parts 3b
 * and 4c; public holidays moved in PR 146.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    role: "SUPER_ADMIN",
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
    menus: [] as { label: string; items: { key: string; label: string; danger?: boolean }[] }[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "sa", role: state.role } }, status: "authenticated" }) }))
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

function render(element: Parameters<typeof renderToStaticMarkup>[0], swr: Record<string, Loaded> = {}, { locale = "en", role = "SUPER_ADMIN" }: { locale?: "en" | "ar"; role?: string } = {}) {
    Object.assign(state, { swr, locale, role, keys: [], menus: [] })
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(element)
    } finally {
        vi.unstubAllGlobals()
    }
}
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))

const ROLE_TEMPLATES = "/api/role-templates"
const grants = (n: number) => Array.from({ length: n }, (_, i) => ({ permission: `p${i}`, scope: "COMPANY" }))
const roleTemplate = (r: Record<string, unknown> = {}) => ({ id: "t1", name: "Accountant", description: "Pays costs and runs payroll.", baseRole: "EMPLOYEE", grants: grants(3), ...r })
const roleTemplates = async (swr: Record<string, Loaded>, options?: { locale?: "en" | "ar"; role?: string }) => {
    const { default: RoleTemplatesPage } = await import("@/app/(dashboard)/dashboard/role-templates/page")
    return render(h(RoleTemplatesPage), swr, options)
}

const POLICY_TEMPLATES = "/api/policy-templates"
const policyBody = (b: Record<string, unknown> = {}) => ({
    workWeek: [0, 1, 2, 3, 4],
    lateness: { enabled: true, graceMinutes: 15, mode: "PER_MINUTE", bands: [], freePerMonth: 0, monthlyCapDays: null },
    earlyLeave: { enabled: false, graceMinutes: 0, mode: "PER_MINUTE", bands: [], freePerMonth: 0, monthlyCapDays: null },
    overtime: { enabled: false, multipliers: { workday: 1.35, restDay: 1.7, holiday: 2 }, requiresApproval: true },
    absence: { multiplier: 1 },
    permissionHours: { enabled: true, monthlyAllowanceMinutes: 120 },
    ...b,
})
const policyTemplate = (p: Record<string, unknown> = {}) => ({ id: "p1", name: "Standard office", nameAr: "مكتب قياسي", description: "Five days, Friday and Saturday off.", body: policyBody(), ...p })
const policyTemplates = async (swr: Record<string, Loaded>, options?: { locale?: "en" | "ar"; role?: string }) => {
    const { default: PolicyTemplatesPage } = await import("@/app/(dashboard)/dashboard/policy-templates/page")
    return render(h(PolicyTemplatesPage), swr, options)
}

describe("Role templates", () => {
    it("has a page header that names it, says what it's for, and holds New template", async () => {
        const top = header(await roleTemplates({ [ROLE_TEMPLATES]: ok([]) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.role_templates_title}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.role_templates_hint)}</p>`)
        expect(top).toMatch(new RegExp(`<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary">.*${en.role_templates_new}</button></div>`))
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await roleTemplates({ [ROLE_TEMPLATES]: ok([roleTemplate()]) }, { role: "ADMIN" })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("says while the templates load, and when they didn't, with the server's reason and Try again", async () => {
        expect(await roleTemplates({})).toContain(`<div class="ui-panel" role="status">`)
        const html = await roleTemplates({ [ROLE_TEMPLATES]: failed })
        expect(html).toContain(esc(en.role_templates_load_failed))
        expect(html).toContain("Database unavailable")
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("lists each template as a row: its name, what it's based on and how many permissions, what it's for, and a menu named for it", async () => {
        const html = await roleTemplates({ [ROLE_TEMPLATES]: ok([roleTemplate(), roleTemplate({ id: "t2", name: "Driver", description: null, baseRole: "TEAM_LEADER", grants: grants(1) })]) })
        expect(html).toContain(`<ul class="ui-panel ui-rows" aria-label="${en.role_templates_title}">`)
        expect(html).toContain('<span class="ui-item-title"><bdi>Accountant</bdi></span>')
        expect(html).toContain(`<span class="ui-item-detail"><span><bdi>${en.roles_based_on.replace("{role}", en.role_employee)}</bdi>, <bdi>3 permissions</bdi></span></span>`)
        expect(html).toContain('<span class="ui-item-note"><bdi>Pays costs and runs payroll.</bdi></span>')
        // One, as the language counts it; and no note where there's nothing to say.
        expect(html).toContain("<bdi>1 permission</bdi>")
        expect(html.match(/ui-item-note/g)).toHaveLength(1)
        expect(html).toContain('aria-label="More actions for Accountant"')
    })

    it("offers Edit, Offer this change and Delete on each, Delete last in the danger colour", async () => {
        await roleTemplates({ [ROLE_TEMPLATES]: ok([roleTemplate()]) })
        expect(state.menus[0].items.map(i => i.label)).toEqual([en.roles_edit, en.template_offer, en.roles_delete])
        expect(state.menus[0].items.at(-1)?.danger).toBe(true)
    })

    it("says when there are none yet", async () => {
        const html = await roleTemplates({ [ROLE_TEMPLATES]: ok([]) })
        expect(html).toContain(`class="ui-empty-title">${en.role_templates_empty}<`)
        expect(html).not.toContain("<ul")
    })
})

describe("deleting a template", () => {
    it("asks first in the building blocks' dialog, named for it, saying what becomes of the companies' copies", async () => {
        const { default: DeleteTemplateDialog } = await import("@/components/DeleteTemplateDialog")
        const html = render(h(DeleteTemplateDialog, { name: "Accountant", body: en.role_templates_delete_body, busy: false, onCancel: () => {}, onConfirm: () => {} }))
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`class="ui-dialog-title">${en.roles_delete_title.replace("{name}", "Accountant")}</h2>`)
        expect(html).toContain(`<p>${esc(en.role_templates_delete_body)}</p>`)
        expect(html).toMatch(new RegExp(`<button type="button" class="ui-btn ui-btn-secondary">${en.cancel}</button><button type="button" class="ui-btn ui-btn-danger">.*${en.delete}</button>`))
    })

    it("stays open, its button busy, until the delete is done", async () => {
        const { default: DeleteTemplateDialog } = await import("@/components/DeleteTemplateDialog")
        const html = render(h(DeleteTemplateDialog, { name: "Accountant", body: "x", busy: true, onCancel: () => {}, onConfirm: () => {} }))
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-secondary" disabled="">/)
        expect(html).toMatch(/class="ui-btn ui-btn-danger"[^>]*aria-busy="true"/)
    })
})

describe("offering a role template's change to its companies", () => {
    const PUSH = "/api/role-templates/push?id=t1"
    const offer = async (swr: Record<string, Loaded>, locale: "en" | "ar" = "en") => {
        const { default: TemplateOfferModal } = await import("@/components/TemplateOfferModal")
        return render(h(TemplateOfferModal, { template: { id: "t1", name: "Accountant" }, onClose: () => {} }), swr, { locale })
    }
    const roles = [
        { id: "r1", name: "Accountants", companyName: "Delta Sites", holders: 2, difference: { added: ["employees.view"], removed: [], rescoped: [{ permission: "employees.create", from: "TEAM", to: "COMPANY" }] } },
        { id: "r2", name: "Finance", companyName: "Nile Works", holders: 1, difference: { added: [], removed: [], rescoped: [] } },
    ]

    it("is the building blocks' dialog, named for the template, with a box for each company role copied from it", async () => {
        const html = await offer({ [PUSH]: ok({ roles }) })
        expect(html).toContain('role="dialog"')
        expect(html).toContain(`class="ui-dialog-title">${en.template_offer_title_named.replace("{name}", "Accountant")}</h2>`)
        expect(html).toContain(`<p>${esc(en.template_offer_hint)}</p>`)
        expect(html).toContain(`<legend class="ui-label">${en.template_offer_legend}</legend>`)
        expect(html).toMatch(/<input type="checkbox" class="ui-check" name="role" value="r1"/)
        expect(html).toContain("<bdi>Delta Sites</bdi>, <bdi>Accountants</bdi>, 2 employees")
    })

    it("says what applying it changes in each, in words, and greys one already the same", async () => {
        const html = await offer({ [PUSH]: ok({ roles }) })
        expect(html).toContain(en.template_offer_added.replace("{list}", en.perm_employees_view))
        expect(html).toContain(en.template_offer_rescoped.replace("{list}", en.template_offer_rescoped_one.replace("{permission}", en.perm_employees_create).replace("{from}", en.scope_TEAM).replace("{to}", en.scope_COMPANY)))
        expect(html).not.toContain("→")
        expect(html.match(/<input[^>]*value="r2"[^>]*>/)![0]).toContain('disabled=""')
        expect(html).toContain(en.template_offer_same)
    })

    it("says while the roles load, when they didn't, and when there are none", async () => {
        expect(await offer({})).toContain(`role="status">${en.loading}<`)
        const broken = await offer({ [PUSH]: failed })
        expect(broken).toContain(esc(en.template_offer_load_failed))
        expect(broken).toContain(`>${en.try_again}</button>`)
        expect(await offer({ [PUSH]: ok({ roles: [] }) })).toContain(`<p>${en.template_offer_none}</p>`)
    })

    it("says on Apply when nothing is picked, where the button was off without a word", async () => {
        const { pickError } = await import("@/components/TemplateOfferModal")
        expect(pickError([])).toBe("template_offer_pick_required")
        expect(pickError(["r1"])).toBeNull()
        const html = await offer({ [PUSH]: ok({ roles }) })
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${en.template_offer_apply}</button>`))
        expect(html).toMatch(/<input type="checkbox" class="ui-check" name="applyNow"/)
    })
})

describe("Attendance policy templates", () => {
    it("has a page header that names it, says what it's for, and holds New template", async () => {
        const top = header(await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [] }) }))
        expect(top).toContain(`<h1 class="ui-page-title">${en.ptpl_title}</h1>`)
        expect(top).toContain(`<p class="ui-page-subtitle">${esc(en.ptpl_hint)}</p>`)
        expect(top).toMatch(new RegExp(`<div class="ui-page-actions"><button type="button" class="ui-btn ui-btn-primary">.*${en.ptpl_new}</button></div>`))
    })

    it("is the Super Admin's only, and asks the server nothing for anyone else", async () => {
        const html = await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [policyTemplate()] }) }, { role: "ADMIN" })
        // It says so, in place of the page (lib/access-denied-page.test.ts).
        expect(html).toContain(en.access_denied_super_admins)
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("says while the templates load, and when they didn't, with Try again", async () => {
        expect(await policyTemplates({})).toContain(`<div class="ui-panel" role="status">`)
        const html = await policyTemplates({ [POLICY_TEMPLATES]: failed })
        expect(html).toContain(esc(en.ptpl_load_failed))
        expect(html).toContain(`>${en.try_again}</button>`)
    })

    it("lists each template as a row: its name, its other name, the policy in words, what it's for, and a menu", async () => {
        const html = await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [policyTemplate()] }) })
        expect(html).toContain(`<ul class="ui-panel ui-rows" aria-label="${en.ptpl_title}">`)
        expect(html).toContain('<span class="ui-item-title"><bdi>Standard office</bdi></span>')
        const detail = html.match(/<span class="ui-item-detail">(.*?)<\/span><\/span>/)![1]
        expect(detail).toContain('<bdi lang="ar">مكتب قياسي</bdi>')
        expect(detail).toContain("<bdi>Sun Mon Tue Wed Thu</bdi>")
        expect(detail).toContain(`<bdi>${en.ptpl_lateness_line.replace("{minutes}", "15 minutes")}</bdi>`)
        expect(detail).toContain(`<bdi>${en.attendance_absence_line.replace("{days}", "1 day")}</bdi>`)
        expect(detail).toContain(`<bdi>${en.ptpl_permission_line.replace("{hours}", "2 hours")}</bdi>`)
        expect(detail).not.toContain(" · ")
        expect(html).toContain('<span class="ui-item-note"><bdi>Five days, Friday and Saturday off.</bdi></span>')
        expect(html).toContain('aria-label="More actions for Standard office"')
    })

    it("names each in the page's language, its numbers in its digits, and says a rule that's off", async () => {
        const body = policyBody({ lateness: { ...policyBody().lateness, enabled: false }, absence: { multiplier: 0 }, permissionHours: { enabled: false, monthlyAllowanceMinutes: 0 } })
        const html = await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [policyTemplate({ body })] }) }, { locale: "ar" })
        expect(html).toContain('<span class="ui-item-title"><bdi>مكتب قياسي</bdi></span>')
        expect(html).toContain('<bdi lang="en">Standard office</bdi>')
        expect(html).toContain(ar.ptpl_lateness_off)
        expect(html).toContain(ar.attendance_absence_none_line)
        expect(html).not.toContain(ar.ptpl_permission_line.split("{hours}")[1])
        const withRules = await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [policyTemplate()] }) }, { locale: "ar" })
        expect(withRules).toContain(ar.ptpl_lateness_line.replace("{minutes}", "١٥ دقيقة"))
    })

    it("offers Edit, Copy and Delete on each, Delete last in the danger colour", async () => {
        await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [policyTemplate()] }) })
        expect(state.menus[0].items.map(i => i.label)).toEqual([en.edit, en.ptpl_copy, en.delete])
        expect(state.menus[0].items.at(-1)?.danger).toBe(true)
    })

    it("says when there are none yet", async () => {
        const html = await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [] }) })
        expect(html).toContain(`class="ui-empty-title">${en.ptpl_none}<`)
    })
})

describe("a row's note", () => {
    it("is a line under the detail, in the detail's size and colour, for what an item is for", async () => {
        const { Row } = await import("@/components/ui")
        const html = render(h("ul", null, h(Row, { title: "Accountant", detail: "Based on Employee", note: "Pays costs." })))
        expect(html).toContain('<span class="ui-item-detail">Based on Employee</span><span class="ui-item-note">Pays costs.</span>')
        const css = readFileSync("components/ui/ui.css", "utf8")
        expect(css).toMatch(/\.ui-item-note \{[^}]*font-size: var\(--text-sm\);[^}]*color: var\(--muted\);/)
        expect(readFileSync("DESIGN.md", "utf8").replace(/\s+/g, " ")).toContain("a note under its detail line, such as what a template is for")
    })
})

describe("nothing of the old templates pages is left", () => {
    it("has no inline styles, old windows, spinner, header title or drawn arrows", () => {
        for (const file of ["app/(dashboard)/dashboard/role-templates/page.tsx", "app/(dashboard)/dashboard/policy-templates/page.tsx", "components/TemplateOfferModal.tsx", "components/DeleteTemplateDialog.tsx"]) {
            const source = readFileSync(file, "utf8")
            expect(source, file).not.toContain("style={")
            expect(source, file).not.toMatch(/@\/components\/(Modal|ConfirmModal|LoadingSpinner)'/)
            expect(source, file).not.toMatch(/className="(input|btn|glass)/)
            expect(source, file).not.toContain("useHeader")
            expect(source, file).not.toContain("→")
            expect(source, file).not.toContain(" · ")
        }
    })
})

describe("found in the browser and the audit (the Super Admin's pages part 1)", () => {
    it("keeps focus in the offer and delete dialogs after a busy button, so Escape and Tab still work in them", () => {
        // Apply, or a Delete that failed, turns busy, which turns it off, and
        // the browser drops focus to the page while the dialog stays open.
        // The building blocks' dialog takes it back on its next redraw, for
        // every dialog (lib/useDialog.ts, tested in dialog-semantics.test.ts;
        // the offer dialog's own fix gave way to it in the Codex review of #168).
        expect(readFileSync("components/ui/Dialog.tsx", "utf8")).toContain("useDialog(open, onClose)")
        expect(readFileSync("lib/useDialog.ts", "utf8")).toContain("regainFocus(ref.current, document.activeElement, document.body)")
        for (const file of ["components/TemplateOfferModal.tsx", "components/DeleteTemplateDialog.tsx"]) {
            expect(readFileSync(file, "utf8"), file).toMatch(/import \{[^}]*\bDialog\b[^}]*\} from '@\/components\/ui'/)
        }
    })

    it("lists the templates in a panel of rows, with no empty strip above the first", async () => {
        // A card with no title kept its padding above the rows.
        const roles = await roleTemplates({ [ROLE_TEMPLATES]: ok([roleTemplate()]) })
        expect(roles).toContain(`<ul class="ui-panel ui-rows" aria-label="${en.role_templates_title}">`)
        expect(roles).not.toContain("ui-card")
        const policies = await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [policyTemplate()] }) })
        expect(policies).toContain(`<ul class="ui-panel ui-rows" aria-label="${en.ptpl_title}">`)
        expect(policies).not.toContain("ui-card")
    })

    it("keeps a description in its own direction, so its full stop stays at its end in Arabic", async () => {
        expect(await roleTemplates({ [ROLE_TEMPLATES]: ok([roleTemplate()]) }, { locale: "ar" })).toContain('<span class="ui-item-note"><bdi>Pays costs and runs payroll.</bdi></span>')
        expect(await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [policyTemplate()] }) }, { locale: "ar" })).toContain('<span class="ui-item-note"><bdi>Five days, Friday and Saturday off.</bdi></span>')
    })

    it("counts lateness's minutes as each language counts them", async () => {
        // It read "٥ دقيقة", where Arabic says ٥ دقائق.
        const { countOf } = await import("@/lib/plural")
        const t = (key: string) => ar[key as keyof typeof ar] ?? key
        expect(countOf(t as never, "ar", 5, "minutes" as never)).toBe("٥ دقائق")
        expect(countOf(t as never, "ar", 15, "minutes" as never)).toBe("١٥ دقيقة")
        expect(countOf(t as never, "ar", 2, "minutes" as never)).toBe("دقيقتان")
        const five = policyTemplate({ body: policyBody({ lateness: { ...policyBody().lateness, graceMinutes: 5 } }) })
        expect(await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [five] }) }, { locale: "ar" })).toContain(ar.ptpl_lateness_line.replace("{minutes}", "٥ دقائق"))
        expect(await policyTemplates({ [POLICY_TEMPLATES]: ok({ templates: [five] }) })).toContain(en.ptpl_lateness_line.replace("{minutes}", "5 minutes"))
    })

    it("greys a company role already the same as the template, its words too, not only its box", async () => {
        const { default: TemplateOfferModal } = await import("@/components/TemplateOfferModal")
        const same = { id: "r2", name: "Finance", companyName: "Nile Works", holders: 1, difference: { added: [], removed: [], rescoped: [] } }
        const html = render(h(TemplateOfferModal, { template: { id: "t1", name: "Accountant" }, onClose: () => {} }), { "/api/role-templates/push?id=t1": ok({ roles: [same] }) })
        expect(html).toMatch(/<label class="ui-choice ui-choice-top" data-disabled="true"><input[^>]*value="r2"/)
    })
})
