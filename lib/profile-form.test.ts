import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A person's profile, part 3 (UI_PLAN.md §5 step 5, PR 193): its form on the
 * building blocks, each field's label above it and what's wrong under it, the
 * first one wrong focused (DESIGN.md §5.3). It was fields of their own making,
 * each side chosen by hand for each language, their mistakes said one at a
 * time in a toast, the email's describing a rule the server had dropped. A
 * field that can't be changed is off, and says why.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
beforeEach(() => { state.locale = "en" })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const FORM = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
const SRC = () => readFileSync("components/profile/ProfileForm.tsx", "utf8")

const ACCESS = {
    own: false, edit: true, company: false, salary: true, dayOffCredit: true, resetPassword: true, role: false, ownTeamLeader: false,
    teamLeader: true, status: true, endContract: true, changeEmail: true, changeUsername: false, changeSalary: true, changeDayOffCredit: true,
    nameByRequest: false, changePassword: true,
}
const VALUES = {
    firstName: "Mona", lastName: "Ali", gender: "FEMALE", email: "mona@delta.test", username: "ds7",
    salary: "12500", dayOffCredit: "21", password: "", status: "ACTIVE", teamLeaderId: "tl1",
}
const props = (over: Record<string, unknown> = {}) => ({
    values: VALUES, set: () => {}, errors: {}, error: null, access: ACCESS, company: null, ownTeamLeader: null,
    leaders: [{ id: "tl1", name: "Rania Fahmy" }, { id: "tl2", name: "Omar Said" }], busy: false, onSubmit: () => {}, cancelHref: "/dashboard/employees/u1?mode=view", ...over,
})
async function form(over: Record<string, unknown> = {}) {
    const { ProfileForm } = await import("@/components/profile/ProfileForm")
    return renderToStaticMarkup(h(ProfileForm, props(over) as never))
}
/** A field by its label, up to its end: its control, and its hint or its error. */
function field(html: string, label: string): string {
    const at = html.indexOf(`>${esc(label)}</label>`)
    expect(at, `no field labelled ${label}`).toBeGreaterThan(-1)
    const start = html.lastIndexOf('<div class="ui-field">', at)
    return html.slice(start, html.indexOf("</div>", at) + 6)
}
/** A choice between a few options, by its group label. */
function choice(html: string, legend: string): string {
    const at = html.indexOf(`<legend class="ui-label">${esc(legend)}</legend>`)
    expect(at, `no choice ${legend}`).toBeGreaterThan(-1)
    return html.slice(html.lastIndexOf("<fieldset", at), html.indexOf("</fieldset>", at) + 11)
}
const tag = (chunk: string, element = "input") => chunk.match(new RegExp(`<${element}[^>]*>`))?.[0] ?? ""
/** A radio button by its value, whatever order its attributes are in. */
const radio = (group: string, value: string) => group.match(new RegExp(`<input [^>]*value="${value}"[^>]*>`))?.[0] ?? ""
const hint = (chunk: string) => chunk.match(/<span id="[^"]+" class="ui-hint">(.*?)<\/span>/)?.[1] ?? null
const wrong = (chunk: string) => chunk.match(/<span id="[^"]+" class="ui-error">(.*?)<\/span>/)?.[1] ?? null

describe("what's checked before anything is sent", () => {
    it("asks for a first and a last name, of up to 15 characters, as the server takes them", async () => {
        const { profileErrors } = await import("@/lib/profile-form")
        const ok = { firstName: "Mona", lastName: "Ali", password: "" }
        expect(profileErrors(ok)).toEqual({})
        expect(profileErrors({ ...ok, firstName: "  ", lastName: "" })).toEqual({ firstName: "profile_first_name_invalid", lastName: "profile_last_name_invalid" })
        // One a typed limit can't stop: loaded as it was, longer than the route now takes.
        expect(profileErrors({ ...ok, firstName: "Abdelrahmanovich" })).toEqual({ firstName: "profile_first_name_invalid" })
    })

    it("checks only what may be changed: an email, a changed username, a new password, pay and day off credit", async () => {
        const { profileErrors } = await import("@/lib/profile-form")
        const ok = { firstName: "Mona", lastName: "Ali", password: "" }
        // Not given, not checked: a field that's off can't be put right.
        expect(profileErrors({ ...ok, email: undefined, username: undefined, salary: undefined, dayOffCredit: undefined })).toEqual({})
        expect(profileErrors({ ...ok, email: "mona@" })).toEqual({ email: "emp_new_email_invalid" })
        expect(profileErrors({ ...ok, username: "-x" })).toEqual({ username: "username_invalid" })
        expect(profileErrors({ ...ok, password: "short-one" })).toEqual({ password: "emp_new_password_short" })
        expect(profileErrors({ ...ok, password: "a-long-enough-one" })).toEqual({})
    })

    it("takes pay of 0 or more, up to its limit, and day off credit of 0 or more, either left empty", async () => {
        const { profileErrors, SALARY_MAX } = await import("@/lib/profile-form")
        const ok = { firstName: "Mona", lastName: "Ali", password: "" }
        for (const salary of ["", "0", "12500.50", String(SALARY_MAX)]) expect(profileErrors({ ...ok, salary }), salary).toEqual({})
        expect(profileErrors({ ...ok, salary: "-1" })).toEqual({ salary: "emp_new_salary_invalid" })
        expect(profileErrors({ ...ok, salary: "lots" })).toEqual({ salary: "emp_new_salary_invalid" })
        expect(profileErrors({ ...ok, salary: String(SALARY_MAX + 1) })).toEqual({ salary: "salary_limit_error" })
        for (const dayOffCredit of ["", "0", "2.5"]) expect(profileErrors({ ...ok, dayOffCredit }), dayOffCredit).toEqual({})
        expect(profileErrors({ ...ok, dayOffCredit: "-0.5" })).toEqual({ dayOffCredit: "emp_new_day_off_invalid" })
    })

    it("knows its fields' order, so the first one wrong is the one focused", async () => {
        const { PROFILE_FIELDS } = await import("@/lib/profile-form")
        expect(PROFILE_FIELDS).toEqual(["firstName", "lastName", "email", "username", "salary", "dayOffCredit", "password"])
    })
})

describe("what the server refuses, under the field it's about", () => {
    it("says a username somebody has, or one that's another company's code, under the username", async () => {
        const { refusedField } = await import("@/lib/profile-form")
        expect(refusedField({ error: "Username in use" })).toEqual({ field: "username", key: "username_in_use" })
        expect(refusedField({ error: "Username follows another company's username code" })).toEqual({ field: "username", key: "username_reserved" })
    })

    it("says an email somebody else has under the email", async () => {
        const { refusedField } = await import("@/lib/profile-form")
        expect(refusedField({ error: "Email in use" })).toEqual({ field: "email", key: "emp_new_email_taken" })
    })

    it("says a field the route found wrong under it", async () => {
        const { refusedField } = await import("@/lib/profile-form")
        const details = (field: string) => ({ error: "Validation Error", details: { [field]: { _errors: ["Too long"] } } })
        expect(refusedField(details("firstName"))).toEqual({ field: "firstName", key: "profile_first_name_invalid" })
        expect(refusedField(details("lastName"))).toEqual({ field: "lastName", key: "profile_last_name_invalid" })
        expect(refusedField(details("email"))).toEqual({ field: "email", key: "emp_new_email_invalid" })
        expect(refusedField(details("username"))).toEqual({ field: "username", key: "username_invalid" })
        expect(refusedField(details("password"))).toEqual({ field: "password", key: "emp_new_password_short" })
        expect(refusedField(details("salary"))).toEqual({ field: "salary", key: "emp_new_salary_invalid" })
        expect(refusedField(details("baseDayOffCredit"))).toEqual({ field: "dayOffCredit", key: "emp_new_day_off_invalid" })
    })

    it("leaves anything else to be said above the buttons", async () => {
        const { refusedField } = await import("@/lib/profile-form")
        expect(refusedField({ error: "A company must keep at least one Admin at work." })).toBeNull()
        expect(refusedField(null)).toBeNull()
    })
})

describe("the form, on the building blocks", () => {
    it("is a form the browser doesn't check, its fields one under the other, Save first", async () => {
        const html = await form()
        expect(html).toMatch(/^<form class="ui-form" novalidate="">/i)
        expect(html).toMatch(/<div class="ui-form-actions"><button type="submit" class="ui-btn ui-btn-primary">[^<]*<\/button><a [^>]*>[^<]*<\/a><\/div><\/form>$/)
        expect(html).toContain(`>${en.save}</button>`)
        expect(html).toContain(`>${en.cancel}</a>`)
        // Their order, as the profile reads.
        const order = [en.first_name_label, en.last_name_label, en.gender_label, en.email, en.username_label, en.monthly_base_salary_label, en.day_off_credit_assigned, en.new_password_optional_label, en.team_leader_label, en.status_label]
        const at = order.map(label => html.indexOf(`>${esc(label)}</`))
        expect(at.every(n => n > -1), JSON.stringify(at)).toBe(true)
        expect([...at].sort((a, b) => a - b)).toEqual(at)
    })

    it("names each field as it's sent, says how much of a name it takes, and keeps a name's own direction", async () => {
        const html = await form()
        const first = field(html, en.first_name_label)
        expect(tag(first)).toMatch(/name="firstName"/)
        expect(tag(first)).toMatch(/maxLength="15"/i)
        expect(tag(first)).toContain('dir="auto"')
        expect(hint(first)).toBe("4 of 15 characters")
        state.locale = "ar"
        expect(hint(field(await form(), ar.first_name_label))).toBe("٤ من ١٥ حرف")
    })

    it("asks for one's own name to be approved, where it is, before the names", async () => {
        const html = await form({ access: { ...ACCESS, own: true, nameByRequest: true } })
        const note = html.indexOf(`<p class="ui-hint">${esc(en.profile_name_by_request)}</p>`)
        expect(note).toBeGreaterThan(-1)
        expect(note).toBeLessThan(html.indexOf(`>${en.first_name_label}</label>`))
        expect(await form()).not.toContain(esc(en.profile_name_by_request))
    })

    it("offers a gender as two radio buttons under its label, the one they have picked", async () => {
        const group = choice(await form(), en.gender_label)
        for (const value of ["MALE", "FEMALE"]) expect(radio(group, value), value).toMatch(/^<input type="radio" class="ui-radio" .*name="gender"/)
        expect(radio(group, "FEMALE")).toContain('checked=""')
        expect(radio(group, "MALE")).not.toContain("checked")
        expect(group).toContain(`>${en.female}</label>`)
        expect(group).toContain(`>${en.male}</label>`)
    })

    it("keeps an email and a username left to right, never spell-checked, a username never translated or capitalised", async () => {
        const html = await form()
        const email = tag(field(html, en.email))
        for (const a of ['type="email"', 'name="email"', 'dir="ltr"', 'spellCheck="false"']) expect(email.toLowerCase(), a).toContain(a.toLowerCase())
        const username = tag(field(html, en.username_label))
        for (const a of ['name="username"', 'dir="ltr"', 'spellCheck="false"', 'autoCapitalize="none"', 'autoComplete="off"', 'translate="no"']) expect(username.toLowerCase(), a).toContain(a.toLowerCase())
    })

    it("takes pay and day off credit as numbers, day off credit in halves", async () => {
        const html = await form()
        const salary = tag(field(html, en.monthly_base_salary_label))
        for (const a of ['type="number"', 'name="salary"', 'inputMode="decimal"', 'min="0"']) expect(salary.toLowerCase(), a).toContain(a.toLowerCase())
        const credit = tag(field(html, en.day_off_credit_assigned))
        for (const a of ['type="number"', 'name="dayOffCredit"', 'inputMode="decimal"', 'min="0"', 'step="0.5"']) expect(credit.toLowerCase(), a).toContain(a.toLowerCase())
    })

    it("takes a new password in the building blocks' password field, saying how long and that empty keeps it", async () => {
        const password = field(await form(), en.new_password_optional_label)
        expect(password).toContain('class="ui-control has-end-button"')
        for (const a of ['type="password"', 'name="password"', 'autoComplete="new-password"', 'maxLength="72"']) expect(tag(password).toLowerCase(), a).toContain(a.toLowerCase())
        expect(hint(password)).toBe(esc(en.profile_new_password_hint))
    })

    it("offers a new password only to whoever may set it", async () => {
        expect(await form({ access: { ...ACCESS, changePassword: false } })).not.toContain(esc(en.new_password_optional_label))
    })

    it("offers the team leaders by name, or none", async () => {
        const select = field(await form(), en.team_leader_label)
        expect(select).toContain('name="teamLeaderId"')
        expect(select).toContain(`<option value="">${esc(en.team_leader_none)}</option>`)
        expect(select).toMatch(/<option value="tl1" selected="">Rania Fahmy<\/option><option value="tl2">Omar Said<\/option>/)
        expect(hint(select)).toBe(esc(en.team_leader_hint))
    })

    it("offers a status as radio buttons, said as the badge says it", async () => {
        const group = choice(await form(), en.status_label)
        expect(group.match(/name="status"/g)).toHaveLength(3)
        expect(radio(group, "ACTIVE")).toContain('checked=""')
        for (const word of [en.status_online, en.status_suspended, en.status_offline]) expect(group).toContain(`>${word}</label>`)
        // It said ACTIVE in capitals, where the badge says Online.
        expect(group).not.toContain(">ACTIVE<")
    })

    it("keeps an ended contract's status as it is, and says where they're reinstated", async () => {
        const group = choice(await form({ values: { ...VALUES, status: "ARCHIVED" } }), en.status_label)
        expect(group.match(/<input [^>]*disabled=""/g)).toHaveLength(4)
        expect(radio(group, "ARCHIVED")).toContain('checked=""')
        expect(radio(group, "ARCHIVED")).toContain('disabled=""')
        expect(group).toContain(esc(en.profile_status_archived))
    })

    it("puts the role where it's chosen, between the password and the team", async () => {
        const html = await form({ role: h("div", { id: "the-role" }) })
        const at = html.indexOf('<div id="the-role"></div>')
        expect(at).toBeGreaterThan(html.indexOf(`>${en.new_password_optional_label}</label>`))
        expect(at).toBeLessThan(html.indexOf(`>${en.team_leader_label}</label>`))
    })
})

describe("a field that can't be changed is off, and says why", () => {
    it("is their company, which a person stays in", async () => {
        const company = field(await form({ access: { ...ACCESS, company: true }, company: "Delta Sites" }), en.company_label)
        expect(tag(company)).toMatch(/value="Delta Sites"/)
        expect(tag(company)).toContain('disabled=""')
        expect(tag(company)).not.toContain("onChange")
        expect(hint(company)).toBe(esc(en.profile_company_stays))
    })

    it("is one's own email, changed in Security settings", async () => {
        const email = field(await form({ access: { ...ACCESS, own: true, changeEmail: false } }), en.email)
        expect(tag(email)).toContain('disabled=""')
        expect(hint(email)).toBe(esc(en.profile_email_own))
        expect(tag(field(await form(), en.email))).not.toContain("disabled")
    })

    it("is a username, which only the Super Admin changes", async () => {
        const username = field(await form(), en.username_label)
        expect(tag(username)).toContain('disabled=""')
        expect(hint(username)).toBe(esc(en.profile_username_locked))
        expect(tag(field(await form({ access: { ...ACCESS, changeUsername: true } }), en.username_label))).not.toContain("disabled")
    })

    it("is one's own pay and day off credit, which the company sets, and someone else's to a role that may only see them", async () => {
        const own = await form({ access: { ...ACCESS, own: true, changeSalary: false, changeDayOffCredit: false } })
        for (const label of [en.monthly_base_salary_label, en.day_off_credit_assigned]) {
            expect(tag(field(own, label)), label).toContain('disabled=""')
            expect(hint(field(own, label)), label).toBe(esc(en.profile_set_by_company))
        }
        const seen = await form({ access: { ...ACCESS, changeSalary: false, changeDayOffCredit: false } })
        for (const label of [en.monthly_base_salary_label, en.day_off_credit_assigned]) expect(hint(field(seen, label)), label).toBe(esc(en.profile_view_only))
    })

    it("is one's own team leader, whom the company assigns", async () => {
        const mine = field(await form({ access: { ...ACCESS, own: true, ownTeamLeader: true, teamLeader: false }, ownTeamLeader: "Rania Fahmy" }), en.team_leader_yours)
        expect(tag(mine)).toMatch(/value="Rania Fahmy"/)
        expect(tag(mine)).toContain('disabled=""')
        expect(hint(mine)).toBe(esc(en.profile_set_by_company))
        const none = field(await form({ access: { ...ACCESS, own: true, ownTeamLeader: true, teamLeader: false } }), en.team_leader_yours)
        expect(hint(none)).toBe(esc(en.team_leader_yours_none))
    })
})

describe("what's wrong, under its field", () => {
    it("says each field's mistake under it, marked for screen readers", async () => {
        const html = await form({ errors: { firstName: "Enter a first name.", salary: "Too much." } })
        const first = field(html, en.first_name_label)
        expect(wrong(first)).toBe("Enter a first name.")
        expect(tag(first)).toContain('aria-invalid="true"')
        expect(wrong(field(html, en.monthly_base_salary_label))).toBe("Too much.")
        expect(hint(first)).toBeNull()
    })

    it("says what isn't a field's above the buttons", async () => {
        const html = await form({ error: "Something went wrong" })
        expect(html).toContain('<p class="ui-error" role="alert">Something went wrong</p><div class="ui-form-actions">')
    })

    it("is off while it's saved, Save busy", async () => {
        const html = await form({ busy: true })
        expect(tag(field(html, en.first_name_label))).toContain('disabled=""')
        expect(html).toMatch(/<button type="submit" class="ui-btn ui-btn-primary" disabled="" aria-busy="true">/)
        expect(html).toContain(`${esc(en.saving)}</button>`)
    })

    it("has nothing of its own making: no styles, no fields of the old kind", () => {
        const src = SRC()
        expect(src).not.toMatch(/style=\{/)
        expect(src).not.toContain('className="input"')
        // Each side chosen by hand for each language, as the old fields did.
        expect(src).not.toContain("textAlign")
        expect(src).not.toMatch(/locale === 'ar' \? '(right|left)'/)
    })
})

describe("the profile, wired to its form", () => {
    it("checks the form before it asks for one's password, and focuses the first field wrong", () => {
        const submit = FORM.slice(FORM.indexOf("const handleSubmit"), FORM.indexOf("const executeSubmit"))
        expect(submit).toContain("const wrong = profileErrors({")
        expect(submit).toContain("password: access.changePassword ? password : '',")
        expect(submit.indexOf("wrongAt(")).toBeLessThan(submit.indexOf("setConfirming('UPDATE')"))
        expect(FORM).toContain("const first = firstError(errors as Record<string, string>, PROFILE_FIELDS) as ProfileField | null")
        expect(FORM).toContain('document.querySelector<HTMLElement>(`[name="${focusOn.field}"]`)?.focus()')
    })

    it("says a refusal under its field, or above the buttons, never in a toast", () => {
        const save = FORM.slice(FORM.indexOf("const executeSubmit"), FORM.indexOf("// The role keeps its own controls"))
        expect(save).toContain("const refused = refusedField(answer)")
        expect(save).toContain("if (refused) wrongAt({ [refused.field]: t(refused.key) })")
        expect(save).not.toMatch(/showToast\([^)]*'error'\)/)
        // The ones it said, said under their fields now.
        for (const gone of ["email_format_error", "t('username_invalid')", "t('salary_limit_error')", "text.includes('\"Username in use\"')"]) expect(save, gone).not.toContain(gone)
    })

    it("sends each field as the form may change it", () => {
        const payload = FORM.slice(FORM.indexOf("method: 'PUT'"), FORM.indexOf("reassignReportsTo: reassignTo"))
        for (const sent of [
            "firstName: access.nameByRequest ? undefined : firstName,",
            "lastName: access.nameByRequest ? undefined : lastName,",
            // One's own is changed in Security settings: it's not sent.
            "email: access.changeEmail ? email : undefined,",
            "salary: access.changeSalary ? parseFloat(salary) || 0 : undefined,",
            "baseDayOffCredit: access.changeDayOffCredit ? parseFloat(baseDayOffCredit) || 0 : undefined,",
            "username: access.changeUsername ? changedUsername(username, savedUsername) : undefined,",
            "status: access.status ? status : undefined,",
            "teamLeaderId: access.teamLeader ? (teamLeaderId || null) : undefined,",
            "password: access.changePassword && password ? password : undefined,",
        ]) expect(payload, sent).toContain(sent)
        expect(FORM).toContain("if (access.nameByRequest && isNameChanged) {")
    })

    // Reached at its address by someone who may not edit them, as the notice
    // of an acting role held back sends whoever decides roles, it was the
    // form to fill in, and its save was refused.
    it("is the view to whoever may not edit them, at the form's address too", () => {
        expect(FORM).toContain("const seeing = isViewMode || !access.edit")
        expect(FORM).toMatch(/if \(seeing\) \{[^}]*?return \(\s*<Page>[\s\S]*?<ProfileView/)
        expect(FORM).not.toContain("if (isViewMode) {")
        // Its header says what the page is from the start.
        expect(FORM).toContain("<ProfileHeader own={own} editing={!seeing} name={null} />")
    })

    // Cancel goes to their details at the same address with ?mode=view, and
    // the router kept the profile mounted across it: the details were what
    // had been typed, and Edit again brought it back to be saved (Codex
    // review, PR 193).
    it("shows their details as saved after Cancel, not as typed: the view and the form are each mounted afresh", () => {
        const page = readFileSync("app/(dashboard)/dashboard/employees/[id]/page.tsx", "utf8")
        expect(page).toMatch(/<EmployeeProfileForm\s+key=\{isViewMode \? 'view' : 'edit'\}/)
    })

    // As Add employee does; the profile didn't (web interface audit).
    it("asks before a reload or a closed tab loses what's typed, but not while it's sent, or once it's saved", () => {
        expect(FORM).toContain("if (!changed || saving || seeing) return")
        expect(FORM).toContain("window.addEventListener('beforeunload', warn)")
        expect(FORM).toContain("return () => window.removeEventListener('beforeunload', warn)")
        // Whatever's typed, the role and its return date too.
        const set = FORM.slice(FORM.indexOf("const set = (field: keyof ProfileValues"), FORM.indexOf("\n    }\n", FORM.indexOf("const set = (field: keyof ProfileValues")))
        expect(set).toContain("setChanged(true)")
        expect(FORM).toContain("onChange={(id, chosen) => { setRoleId(id); setChanged(true); if (chosen) setRole(chosen.baseRole) }}")
        expect(FORM).toContain("onChange={e => { setActingDate(e.target.value); setChanged(true) }}")
        // Saved, it's nothing to lose; refused, it's still there to lose.
        const saved = FORM.slice(FORM.indexOf("setHandoff(null)"), FORM.indexOf("} catch (err) {", FORM.indexOf("setHandoff(null)")))
        expect(saved.match(/setChanged\(false\)/g) ?? []).toHaveLength(1)
        expect(FORM.match(/setChanged\(false\)/g) ?? []).toHaveLength(1)
    })

    // Every other page form's Cancel is a link; this one went back, so in a
    // tab opened onto the form it did nothing (web interface audit).
    it("is the building blocks' form, and Cancel is a link to their details, as Add employee's is to Employees", async () => {
        expect(FORM).toContain("<ProfileForm")
        expect(FORM).toContain("cancelHref={`/dashboard/employees/${userId}?mode=view`}")
        expect(FORM).not.toContain("onCancel={() => { startNavigationProgress(); router.back() }}")
        const html = await form()
        expect(html).toMatch(new RegExp(`<a (?=[^>]*class="ui-btn ui-btn-secondary")(?=[^>]*href="/dashboard/employees/u1\\?mode=view")[^>]*>${en.cancel}</a>`))
        // Its eye was drawn by hand, and its fields chose their sides.
        expect(FORM).not.toContain("setShowNewPassword")
        expect(FORM).not.toContain("<svg")
        expect(FORM).not.toContain("'Enter salary'")
        expect(FORM).not.toContain("أدخل الراتب")
    })
})

describe("its words", () => {
    const KEYS = ["profile_first_name_invalid", "profile_last_name_invalid", "profile_name_by_request", "profile_email_own", "profile_username_locked",
        "profile_set_by_company", "profile_view_only", "profile_company_stays", "profile_new_password_hint", "profile_status_archived"] as const

    it("are in both languages, and the Arabic asks nothing in the masculine", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق)(\s|$)|هل أنت متأكد|هل تريد/)
            expect(en[key], key).not.toMatch(/\b(he|his|him|she|her)\b/i)
        }
    })

    // The profile says Add employee's mistakes too, and they asked in the
    // masculine (أدخل، اختر، اتركه): both forms ask neutrally now.
    it("share Add employee's mistakes, which ask nothing in the masculine in Arabic either", () => {
        const shared = Object.keys(ar).filter(key => key.startsWith("emp_new_")) as (keyof typeof ar)[]
        expect(shared.length).toBeGreaterThan(5)
        for (const key of shared) expect(ar[key], key).not.toMatch(/(^|\s)(أدخل|اختر|اتركه|اتركها|حاول|اكتب|انسخ|تحقق)(\s|$|[،.])/)
    })

    it("are in sentence case, where it said New Password", () => {
        expect(en.new_password_optional_label).toBe("New password (optional)")
    })

    it("take the old fields' with them", () => {
        for (const key of ["update_button", "updating_button", "email_format_error", "keep_current_password_placeholder"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
