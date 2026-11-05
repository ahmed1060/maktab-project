import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A person's profile, part 4 (UI_PLAN.md §5 step 5, PR 194): its role field
 * on the building blocks, its label above it and what's wrong under it
 * (DESIGN.md §5.3). Whoever may give a role picks one, and the day an acting
 * one ends; whoever may only ask for one (ROLES_PLAN.md §6.12) picks one too,
 * and saving sends it for approval, or asks from their details. It was a
 * select of its own making with a button of its own beside it, its date and
 * notes styled by hand, and its refusals said in a toast, in English.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (key: string) => words()[key] ?? key }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("next/image", () => ({ default: (p: { src: string; alt: string }) => h("img", { src: p.src, alt: p.alt }) }))
beforeEach(() => { state.locale = "en" })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const FORM = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
const FIELDS = () => readFileSync("components/profile/RoleFields.tsx", "utf8")
const DIALOG = () => readFileSync("components/profile/RoleRequestDialog.tsx", "utf8")

const ROLES = [
    { id: "r-emp", name: "Employee", baseRole: "EMPLOYEE", builtIn: "EMPLOYEE", isDefault: true },
    { id: "r-tl", name: "Team Leader", baseRole: "TEAM_LEADER", builtIn: "TEAM_LEADER", isDefault: false },
    { id: "r-acc", name: "Accountant", baseRole: "EMPLOYEE", builtIn: null, isDefault: false },
]
const HELD = { id: "r-emp", name: "Employee", builtIn: "EMPLOYEE" }
const WAITING = { id: "rq1", role: { name: "Accountant", builtIn: null } }

const fieldProps = (over: Record<string, unknown> = {}) => ({
    how: "assign", superAdmin: false, roles: ROLES, current: HELD, value: "r-emp", onChange: () => {},
    actingUntil: "", onActingUntil: () => {}, actingFrom: "2026-11-05", acting: null, waiting: null, errors: {}, busy: false, ...over,
})
async function fields(over: Record<string, unknown> = {}) {
    const { RoleFields } = await import("@/components/profile/RoleFields")
    return renderToStaticMarkup(h(RoleFields, fieldProps(over) as never))
}
/** A field by its label, up to its end: its control, and its hint or its error. */
function field(html: string, label: string): string {
    const at = html.indexOf(`>${esc(label)}</label>`)
    expect(at, `no field labelled ${label}`).toBeGreaterThan(-1)
    const start = html.lastIndexOf('<div class="ui-field">', at)
    return html.slice(start, html.indexOf("</div>", at) + 6)
}
const tag = (chunk: string, element = "input") => chunk.match(new RegExp(`<${element}[^>]*>`))?.[0] ?? ""
const hint = (chunk: string) => chunk.match(/<span id="[^"]+" class="ui-hint">(.*?)<\/span><\/div>$/)?.[1] ?? null
const wrong = (chunk: string) => chunk.match(/<span id="[^"]+" class="ui-error">(.*?)<\/span>/)?.[1] ?? null
const options = (chunk: string) => [...chunk.matchAll(/<option value="([^"]*)"[^>]*>(.*?)<\/option>/g)].map(m => [m[1], m[2]])

describe("what's checked before it's sent", () => {
    it("asks for an acting role to end after today, and for the whole date, where it's offered", async () => {
        const { profileErrors } = await import("@/lib/profile-form")
        const ok = { firstName: "Mona", lastName: "Ali", password: "", actingFrom: "2026-11-05" }
        // Left empty, the change is for good.
        expect(profileErrors({ ...ok, actingUntil: "" })).toEqual({})
        expect(profileErrors({ ...ok, actingUntil: "2026-11-05" })).toEqual({})
        expect(profileErrors({ ...ok, actingUntil: "2026-11-04" })).toEqual({ actingUntil: "profile_acting_past" })
        // A date the browser couldn't read reads as empty, which would make it for good.
        expect(profileErrors({ ...ok, actingUntil: "", unreadable: ["actingUntil"] })).toEqual({ actingUntil: "profile_acting_incomplete" })
        // Not offered, as with no other role picked: not checked.
        expect(profileErrors({ ...ok, actingUntil: undefined, unreadable: ["actingUntil"] })).toEqual({})
    })

    it("offers tomorrow where the person is as the first day it may end on, as the server reads the date in the company's calendar", async () => {
        const { dayAfter } = await import("@/lib/profile-form")
        expect(dayAfter(new Date(2026, 10, 4, 0, 30))).toBe("2026-11-05")
        expect(dayAfter(new Date(2026, 11, 31, 23, 30))).toBe("2027-01-01")
        // It was UTC's, which is a day out for part of every day east or west of it.
        expect(FORM).toContain("const [tomorrow] = useState(() => dayAfter(new Date()))")
        expect(FORM).not.toContain("toISOString().slice(0, 10)")
    })

    it("asks, from their details, for a role that isn't theirs already", async () => {
        const { roleAskErrors } = await import("@/lib/profile-form")
        const ask = { current: "r-emp", actingFrom: "2026-11-05", actingUntil: "", unreadable: false }
        expect(roleAskErrors({ ...ask, roleId: "r-tl" })).toEqual({})
        expect(roleAskErrors({ ...ask, roleId: "r-emp" })).toEqual({ roleId: "profile_role_same" })
        expect(roleAskErrors({ ...ask, roleId: "r-tl", actingUntil: "2026-11-01" })).toEqual({ actingUntil: "profile_acting_past" })
        expect(roleAskErrors({ ...ask, roleId: "r-tl", unreadable: true })).toEqual({ actingUntil: "profile_acting_incomplete" })
    })

    it("focuses the role, then its date, after the fields before them", async () => {
        const { PROFILE_FIELDS } = await import("@/lib/profile-form")
        expect(PROFILE_FIELDS.slice(-3)).toEqual(["password", "roleId", "actingUntil"])
    })
})

describe("the server's refusals, said under the role or its date", () => {
    it("are read by their codes, in the reader's language", async () => {
        const { refusedField } = await import("@/lib/profile-form")
        for (const [code, key] of [
            ["FORBIDDEN_ROLE_ASSIGNMENT", "profile_role_not_given"],
            ["ROLE_EXCEEDS_YOURS", "profile_role_exceeds"],
            ["ROLE_NOT_IN_COMPANY", "requests_role_gone"],
            ["ADMIN_IS_SUPER_ADMINS", "profile_role_admin"],
            ["SAME_ROLE", "profile_role_same"],
            ["ALREADY_PENDING", "profile_role_already_asked"],
            ["LAST_ADMIN", "profile_role_last_admin"],
        ]) expect(refusedField({ error: "said in English", code }), code).toEqual({ field: "roleId", key })
        expect(refusedField({ error: "An acting role must end in the future", code: "ACTING_END_IN_PAST" })).toEqual({ field: "actingUntil", key: "profile_acting_past" })
        // About whom, not which role: said above the buttons, as it comes.
        for (const code of ["FORBIDDEN", "USER_NOT_FOUND", "OWN_ROLE"]) expect(refusedField({ error: "said in English", code }), code).toBeNull()
    })

    it("come with their codes from the profile's save too, as they do from asking for a role", async () => {
        const { adminRefusal, roleRequestRefusal } = await import("@/lib/role-errors")
        for (const [code, status] of [["LAST_ADMIN", 400], ["ADMIN_IS_SUPER_ADMINS", 403]] as const) {
            const res = adminRefusal(new Error(code))!
            expect(res.status, code).toBe(status)
            expect(await res.json(), code).toMatchObject({ success: false, code })
            expect(await roleRequestRefusal(new Error(code))!.json(), code).toMatchObject({ code })
        }
        expect(adminRefusal(new Error("SOMETHING_ELSE"))).toBeNull()
        const route = readFileSync("app/api/users/route.ts", "utf8")
        const put = route.slice(route.indexOf("export const PUT"), route.indexOf("export const DELETE"))
        expect(put).toContain("const refusedAdmin = adminRefusal(error)")
        expect(put).not.toContain("if (error.message === 'LAST_ADMIN')")
        expect(put).not.toContain("if (error.message === 'ADMIN_IS_SUPER_ADMINS')")
    })
})

describe("the role field, to whoever gives a role", () => {
    it("is a labelled select of the roles theirs may give, with theirs picked", async () => {
        const role = field(await fields(), en.role_label)
        expect(tag(role, "select")).toContain('name="roleId"')
        expect(tag(role, "select")).not.toContain("disabled")
        expect(options(role)).toEqual([["r-emp", en.role_employee], ["r-tl", en.role_team_leader], ["r-acc", "Accountant"]])
        expect(role).toMatch(/<option value="r-emp" selected="">/)
        expect(hint(role)).toBeNull()
    })

    it("keeps theirs to pick, where it isn't one the viewer may give", async () => {
        const role = field(await fields({ current: { id: "r-chief", name: "Chief", builtIn: null }, value: "r-chief" }), en.role_label)
        expect(options(role)[0]).toEqual(["r-chief", "Chief"])
        expect(options(role)).toHaveLength(4)
    })

    it("asks until when, once another role is picked, from tomorrow", async () => {
        expect(await fields()).not.toContain(`>${esc(en.acting_until_label)}</label>`)
        const html = await fields({ value: "r-tl", actingUntil: "2026-12-05" })
        const until = field(html, en.acting_until_label)
        expect(tag(until)).toContain('type="date"')
        expect(tag(until)).toContain('name="actingUntil"')
        expect(tag(until)).toContain('min="2026-11-05"')
        expect(tag(until)).toContain('value="2026-12-05"')
        expect(hint(until)).toBe(esc(en.acting_until_hint))
        // After the role, which it's about.
        expect(html.indexOf(`>${esc(en.acting_until_label)}</label>`)).toBeGreaterThan(html.indexOf(`>${en.role_label}</label>`))
    })

    it("says under it until when they're acting in it, until another is picked", async () => {
        const acting = "Acting until 5 December 2026, then back to Team Leader"
        expect(hint(field(await fields({ acting }), en.role_label))).toBe(acting)
        // Another picked, its date says what follows instead.
        expect(hint(field(await fields({ acting, value: "r-tl" }), en.role_label))).toBeNull()
    })

    it("says what's wrong under the role and under its date, each marked wrong", async () => {
        const html = await fields({ value: "r-tl", errors: { roleId: "Not this one.", actingUntil: "Not that day." } })
        const role = field(html, en.role_label)
        expect(wrong(role)).toBe("Not this one.")
        expect(tag(role, "select")).toContain('aria-invalid="true"')
        expect(wrong(field(html, en.acting_until_label))).toBe("Not that day.")
    })

    it("is off while the form is sent", async () => {
        const html = await fields({ value: "r-tl", busy: true })
        expect(tag(field(html, en.role_label), "select")).toContain('disabled=""')
        expect(tag(field(html, en.acting_until_label))).toContain('disabled=""')
    })
})

describe("the role field, to whoever may only ask for one", () => {
    it("says the role picked is sent for approval, and asks until when too", async () => {
        const html = await fields({ how: "ask", value: "r-tl" })
        expect(hint(field(html, en.role_label))).toBe(esc(en.profile_role_will_ask))
        expect(html).toContain(`>${esc(en.acting_until_label)}</label>`)
        // Not before another is picked.
        expect(hint(field(await fields({ how: "ask" }), en.role_label))).toBeNull()
    })

    it("is off while a change waits, and says which, linked to it on the Requests page", async () => {
        const role = field(await fields({ how: "ask", waiting: WAITING }), en.role_label)
        expect(tag(role, "select")).toContain('disabled=""')
        const [before, after] = en.role_requests_pending_for.split("{role}")
        expect(hint(role)).toBe(`<a href="/dashboard/requests?kind=role&amp;highlight=rq1">${esc(before)}<bdi>Accountant</bdi>${esc(after)}</a>`)
    })
})

describe("a role that isn't changed here", () => {
    it("is a Super Admin's, shown off, and says so", async () => {
        const role = field(await fields({ superAdmin: true, how: null, current: null, value: "" }), en.role_label)
        expect(tag(role)).toContain(`value="${en.role_super_admin}"`)
        expect(tag(role)).toContain('disabled=""')
        expect(hint(role)).toBe(esc(en.profile_role_super_admin))
    })

    it("is an Admin's, to anyone but the Super Admin, shown off, and says who changes it", async () => {
        const role = field(await fields({ how: null, current: { id: "r-adm", name: "Admin", builtIn: "ADMIN" }, value: "r-adm" }), en.role_label)
        expect(tag(role, "select")).toContain('disabled=""')
        expect(options(role)[0]).toEqual(["r-adm", en.role_admin])
        expect(hint(role)).toBe(esc(en.profile_role_admin))
    })
})

describe("the role field in Arabic", () => {
    it("says each role, and what picking one means, in Arabic", async () => {
        state.locale = "ar"
        const html = await fields({ how: "ask", value: "r-tl" })
        const role = field(html, ar.role_label)
        expect(options(role).map(([, label]) => label)).toEqual([ar.role_employee, ar.role_team_leader, "Accountant"])
        expect(hint(role)).toBe(esc(ar.profile_role_will_ask))
        expect(hint(field(html, ar.acting_until_label))).toBe(esc(ar.acting_until_hint))
    })
})

describe("asking for another role from their details", () => {
    const details = (html: string) => [...html.matchAll(/<div class="ui-detail"><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/g)].map(m => [m[1], m[2]])
    const ACCESS = { own: false, edit: false, company: false, salary: false, dayOffCredit: false, resetPassword: false, role: true, ownTeamLeader: false, teamLeader: false, status: false, endContract: false }
    const FACTS = { email: "mona@delta.test", username: "ds7", gender: "FEMALE", company: null, role: "Employee", acting: null as string | null, teamLeader: null, status: "ACTIVE", salary: "", dayOffCredit: "" }
    async function view(over: Record<string, unknown> = {}) {
        const { ProfileView } = await import("@/components/profile/ProfileView")
        return Object.fromEntries(details(renderToStaticMarkup(h(ProfileView, { name: "Mona Ali", photo: null, access: ACCESS, facts: FACTS, onResetPassword: () => {}, onEndContract: () => {}, ...over } as never))))
    }

    it("is a small button beside the role", async () => {
        const got = await view({ roleAsk: { waiting: null, onAsk: () => {} } })
        expect(got[en.role_label]).toBe(`<span class="ui-detail-act">Employee<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">${en.profile_role_ask}</button></span>`)
    })

    it("is the change waiting, under the role, linked to it on the Requests page, while one waits", async () => {
        const got = await view({ roleAsk: { waiting: WAITING, onAsk: () => {} }, facts: { ...FACTS, acting: "Acting until 5 December 2026" } })
        const [before, after] = en.role_requests_pending_for.split("{role}")
        expect(got[en.role_label]).toBe(`Employee<span class="ui-detail-note">Acting until 5 December 2026</span><span class="ui-detail-note"><a href="/dashboard/requests?kind=role&amp;highlight=rq1">${esc(before)}<bdi>Accountant</bdi>${esc(after)}</a></span>`)
    })

    it("is nothing beside the role to whoever may not ask", async () => {
        expect((await view())[en.role_label]).toBe("Employee")
    })
})

describe("the dialog to ask in", () => {
    const dialogProps = (over: Record<string, unknown> = {}) => ({
        name: "Mona Ali", roles: ROLES, current: HELD, actingFrom: "2026-11-05", onCancel: () => {}, onSend: async () => null, ...over,
    })
    async function dialog(over: Record<string, unknown> = {}) {
        const { RoleRequestDialog } = await import("@/components/profile/RoleRequestDialog")
        // Its portal is a stand-in's here, which still asks where it goes.
        vi.stubGlobal("document", { body: {} })
        try {
            return renderToStaticMarkup(h(RoleRequestDialog, dialogProps(over) as never))
        } finally {
            vi.unstubAllGlobals()
        }
    }

    it("is the building blocks' dialog, a form: who it's for, the role, then Cancel and Send request", async () => {
        const html = await dialog()
        expect(html).toContain(`<h2 id="`)
        expect(html).toContain(`class="ui-dialog-title">${esc(en.profile_role_ask)}</h2>`)
        expect(html).toMatch(/<form class="ui-form" novalidate="">/i)
        const [before, after] = en.profile_role_ask_body.split("{name}")
        expect(html).toContain(`<p>${esc(before)}<bdi>Mona Ali</bdi>${esc(after)}</p>`)
        const role = field(html, en.role_label)
        expect(tag(role, "select")).toContain('name="roleId"')
        // Theirs to start from: what's asked for is another.
        expect(role).toMatch(/<option value="r-emp" selected="">/)
        expect(html).toMatch(new RegExp(`<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">${en.cancel}</button><button type="submit" class="ui-btn ui-btn-primary">${en.profile_role_ask_send}</button></div>`))
    })

    it("is the same role field, its date and its words, as the form's", () => {
        const src = DIALOG()
        expect(src).toContain("roleOptions(roles, current, t)")
        expect(src).toContain("const wrong = roleAskErrors({")
        expect(src).toContain("focusFirstWrong(form.current)")
        // Told what's wrong, it stays, with the field it's about.
        expect(src).toContain("const problem = await onSend({ roleId, actingUntil: changing ? actingUntil : '' })")
        expect(src).toContain("const cancel = () => { if (!busy) onCancel() }")
        expect(src).toContain('<TextInput {...p} name="actingUntil" type="date"')
    })
})

describe("the profile, wired to its role", () => {
    it("asks for the roles to pick from only where a role is picked: the form, or asking from their details", () => {
        expect(FORM).toContain("const picksRole = !!access.changeRole && (!seeing || access.changeRole === 'ask')")
        expect(FORM).toContain("const roles = useAssignableRoles(companyId, picksRole)")
        expect(FORM).toContain("role={access.role && (")
        expect(FORM).toContain("<RoleFields")
    })

    it("checks the date before one's password is asked for, and sends a request before the save", () => {
        const submit = FORM.slice(FORM.indexOf("const handleSubmit"), FORM.indexOf("const executeSubmit"))
        expect(submit).toContain("(['salary', 'dayOffCredit', 'actingUntil'] as const).filter(")
        expect(submit).toContain("actingUntil: roleChange ? actingDate : undefined,")
        expect(submit).toContain("actingFrom: tomorrow,")
        const save = FORM.slice(FORM.indexOf("const executeSubmit"), FORM.indexOf("// Their role, as the form may change it"))
        expect(save).toContain("if (access.changeRole === 'ask' && roleChange) {")
        expect(save.indexOf("await askForRole(")).toBeGreaterThan(-1)
        expect(save.indexOf("await askForRole(")).toBeLessThan(save.indexOf("method: 'PUT'"))
    })

    it("gives a role in the save only to whoever may give it, and never sends its kind", () => {
        const payload = FORM.slice(FORM.indexOf("method: 'PUT'"), FORM.indexOf("reassignReportsTo: reassignTo"))
        expect(payload).toContain("roleId: access.changeRole === 'assign' && roleChange ? roleId : undefined,")
        expect(payload).toContain("actingUntil: access.changeRole === 'assign' && roleChange && actingDate ? actingDate : undefined,")
        // Sent with every save, the kind was a change whenever the form's
        // was another's, as it stayed after picking back a role theirs
        // couldn't give.
        expect(payload).not.toMatch(/^\s*role,$/m)
    })

    it("puts back their kind, as loaded, when their own role is picked back", () => {
        expect(FORM).toContain("if (access.changeRole === 'assign') setRole(id === currentRole?.id ? savedRole : chosen?.baseRole ?? savedRole)")
    })

    it("asks for a role in the reader's language, and says what's refused under its field", () => {
        const ask = FORM.slice(FORM.indexOf("const askForRole"), FORM.indexOf("const executeSubmit"))
        expect(ask).toContain("fetch('/api/role-requests', {")
        expect(ask).toContain("const refused = refusedField(answer)")
        expect(ask).toContain("showToast(t('role_requests_sent'), 'success')")
        expect(ask).not.toMatch(/showToast\([^)]*'error'\)/)
        expect(ask).not.toContain("refusalOf(")
    })

    it("says a refusal about the role under it only when the save changed the role", () => {
        const save = FORM.slice(FORM.indexOf("const executeSubmit"), FORM.indexOf("// Their role, as the form may change it"))
        expect(save).toContain("if (refused && (refused.field !== 'roleId' || roleGiven)) wrongAt({ [refused.field]: t(refused.key) })")
        expect(save).toContain("else if (refused) setFormError(t(refused.key))")
    })

    it("asks from their details, and shows the change waiting, to whoever may only ask", () => {
        expect(FORM).toContain("access.changeRole === 'ask' ? `/api/role-requests?userId=${encodeURIComponent(userId)}&status=PENDING` : null")
        expect(FORM).toContain("roleAsk={access.changeRole === 'ask' ? { waiting: waitingRole, onAsk: () => setAsking(true) } : undefined}")
        expect(FORM).toContain("{asking && (")
        expect(FORM).toContain("<RoleRequestDialog")
    })

    it("leaves the old role controls behind: their own select and button, and the styles typed in", () => {
        expect(existsSync("components/RoleRequestControl.tsx")).toBe(false)
        expect(existsSync("components/RoleSelect.tsx")).toBe(false)
        for (const gone of ["RoleSelect", "RoleRequestControl", "style={{", 'className="input"', "textAlign"]) expect(FORM, gone).not.toContain(gone)
        for (const src of [FIELDS(), DIALOG()]) {
            expect(src).not.toContain("style={")
            expect(src).not.toMatch(/'left'|'right'/)
            expect(src).not.toContain('className="btn')
        }
    })
})

describe("its words", () => {
    const KEYS = ["profile_role_will_ask", "profile_role_super_admin", "profile_role_not_given", "profile_role_exceeds", "profile_role_admin",
        "profile_role_last_admin", "profile_role_same", "profile_role_already_asked", "profile_acting_past", "profile_acting_incomplete",
        "profile_role_ask", "profile_role_ask_body", "profile_role_ask_send", "acting_until_hint", "acting_now"] as const

    it("are in both languages, and the Arabic asks nothing in the masculine", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق|اتركه|اطلب)(\s|$)|هل أنت متأكد|هل تريد|يعود إلى دوره/)
            expect(en[key], key).not.toMatch(/\b(he|his|him|she|her)\b/i)
        }
    })

    it("are sentence case, and the old control's button is gone", () => {
        expect(en.profile_role_ask).toBe("Ask for another role")
        expect(en.profile_role_ask_send).toBe("Send request")
        expect(en).not.toHaveProperty("role_requests_ask")
        expect(ar).not.toHaveProperty("role_requests_ask")
    })
})
