import { beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A person's profile, part 2 (UI_PLAN.md §5 step 5, PR 192): someone else's,
 * seen, is their details (DESIGN.md §5.5, Details), where it was the form with
 * every field turned off. What can be done to a detail, such as resetting
 * their password or ending their contract, is beside it, and Edit is the page
 * header's. Confirming with one's own password is the building blocks' dialog,
 * where it was a window of its own making.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (key: string) => words()[key] ?? key }) }))
vi.mock("next/image", () => ({ default: (p: { src: string; alt: string }) => h("img", { src: p.src, alt: p.alt }) }))
beforeEach(() => { state.locale = "en" })

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const FORM = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
const DIALOG_SRC = () => readFileSync("components/profile/PasswordDialogs.tsx", "utf8")

const ALL = { own: false, edit: true, company: true, salary: true, dayOffCredit: true, resetPassword: true, role: true, ownTeamLeader: false, teamLeader: true, status: true, endContract: true }
const NONE = { own: false, edit: false, company: false, salary: false, dayOffCredit: false, resetPassword: false, role: false, ownTeamLeader: false, teamLeader: false, status: false, endContract: false }
const FACTS = {
    email: "mona@delta.test", username: "ds7", gender: "FEMALE", company: "Delta Sites", role: "Employee",
    acting: null as string | null, teamLeader: "Rania Fahmy" as string | null, status: "ACTIVE", salary: "12500", dayOffCredit: "21",
}
const props = (over: Record<string, unknown> = {}) => ({ name: "Mona Ali", photo: null, access: ALL, facts: FACTS, onResetPassword: () => {}, onEndContract: () => {}, ...over })
async function view(over: Record<string, unknown> = {}) {
    const { ProfileView } = await import("@/components/profile/ProfileView")
    return renderToStaticMarkup(h(ProfileView, props(over) as never))
}
/** The details, label and value, in the order they're shown. */
const details = (html: string) => [...html.matchAll(/<div class="ui-detail"><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/g)].map(m => [m[1], m[2]])

describe("someone else's profile, seen", () => {
    it("is their details in a card, under their photo, in the order a reader looks for them", async () => {
        const html = await view()
        expect(html).toMatch(/^<section class="ui-panel ui-card"><div class="ui-photo-row">/)
        expect(html).toContain('<dl class="ui-details">')
        expect(details(html).map(([label]) => label)).toEqual([
            en.email, en.username_label, en.role_label, en.team_leader_label, en.status_label, en.company_label,
            en.gender_label, esc(en.monthly_base_salary_label), en.day_off_credit_assigned, en.password,
        ])
    })

    it("keeps an email and a username left to right, as they're typed, and never translated", async () => {
        const got = Object.fromEntries(details(await view()))
        expect(got[en.email]).toBe('<bdi dir="ltr" translate="no">mona@delta.test</bdi>')
        expect(got[en.username_label]).toBe('<bdi dir="ltr" translate="no">ds7</bdi>')
    })

    it("says each fact in words: their gender, their status as the lists say it, their pay and day off credit counted", async () => {
        const got = Object.fromEntries(details(await view()))
        expect(got[en.gender_label]).toBe(en.female)
        expect(got[en.status_label]).toContain(`<span class="ui-badge ui-badge-good">${en.status_online}</span>`)
        expect(got[esc(en.monthly_base_salary_label)]).toBe('<span class="ui-num">12,500.00</span>')
        expect(got[en.day_off_credit_assigned]).toBe("21 days")
        expect(got[en.team_leader_label]).toBe("Rania Fahmy")
        expect(got[en.company_label]).toBe("Delta Sites")
    })

    it("says when there's nothing: no username, no team leader, no pay set", async () => {
        const got = Object.fromEntries(details(await view({ facts: { ...FACTS, username: "", teamLeader: null, salary: "" } })))
        expect(got[en.username_label]).toBe(esc(en.profile_none))
        expect(got[en.team_leader_label]).toBe(en.team_leader_none)
        expect(got[esc(en.monthly_base_salary_label)]).toBe(en.no_data_available)
    })

    it("says under the role until when they're acting in it", async () => {
        const got = Object.fromEntries(details(await view({ facts: { ...FACTS, acting: "Acting until 5 December 2026, then back to Team leader" } })))
        expect(got[en.role_label]).toBe('Employee<span class="ui-detail-note">Acting until 5 December 2026, then back to Team leader</span>')
    })

    it("says only what the person looking may see", async () => {
        expect(details(await view({ access: NONE })).map(([label]) => label)).toEqual([en.email, en.username_label, en.gender_label])
    })

    it("says so in Arabic, its amounts and counts in Arabic digits", async () => {
        state.locale = "ar"
        const got = Object.fromEntries(details(await view()))
        expect(got[ar.gender_label]).toBe(ar.female)
        expect(got[ar.monthly_base_salary_label]).toBe(`<span class="ui-num">${new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(12500)}</span>`)
        expect(got[ar.day_off_credit_assigned]).toBe("٢١ يومًا")
    })
})

describe("what can be done to a detail, beside it", () => {
    it("offers Reset password beside the password, small and secondary", async () => {
        const got = Object.fromEntries(details(await view()))
        expect(got[en.password]).toBe(`<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">${en.profile_reset_password}</button>`)
    })

    // As an attendance agent's code is (company settings part 3c): it's typed
    // somewhere else, once.
    it("shows a temporary password once it's issued, in a dialog of its own, left to right and never translated", async () => {
        const { TemporaryPasswordDialog } = await import("@/components/profile/PasswordDialogs")
        expect(TemporaryPasswordDialog).toBeTypeOf("function")
        const src = DIALOG_SRC()
        expect(src).toContain('<p className="ui-code" dir="ltr" translate="no">{password}</p>')
        expect(src).toContain("actions={<Button variant=\"primary\" onClick={onClose}>{t('done')}</Button>}")
        expect(src).toMatch(/<p>\{t\('profile_temp_password_hint'\)\}<\/p>[\s\S]*<p className="ui-hint">\{t\('profile_temp_password_once'\)\}<\/p>/)
        // Shown once: nothing keeps it once the dialog's closed.
        expect(FORM).toContain("onClose={() => setIssuedTempPassword(null)}")
    })

    it("offers End contract beside the status, and Reinstate once it's ended", async () => {
        expect(Object.fromEntries(details(await view()))[en.status_label]).toBe(`<span class="ui-detail-act"><span class="ui-badge ui-badge-good">${en.status_online}</span><button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">${en.end_contract}</button></span>`)
        const ended = Object.fromEntries(details(await view({ facts: { ...FACTS, status: "ARCHIVED" } })))[en.status_label]
        expect(ended).toContain(`<span class="ui-badge ui-badge-neutral">${en.status_archived}</span>`)
        expect(ended).toContain(`>${en.reinstate}</button>`)
    })

    it("shows the status beside End contract to whoever may only end contracts", async () => {
        const status = Object.fromEntries(details(await view({ access: { ...NONE, endContract: true } })))[en.status_label]
        expect(status).toContain(`<span class="ui-badge ui-badge-good">${en.status_online}</span>`)
        expect(status).toContain(`>${en.end_contract}</button>`)
    })

    it("offers nothing to whoever may do nothing", async () => {
        expect(await view({ access: { ...ALL, resetPassword: false, endContract: false } })).not.toContain("<button")
    })

    it("lays the button beside its value, under it where they don't fit", () => {
        const css = readFileSync("components/ui/ui.css", "utf8")
        const at = css.search(/\n\.ui-detail-act \{/)
        expect(at).toBeGreaterThan(-1)
        const rule = css.slice(at, css.indexOf("}", at))
        for (const decl of ["display: flex;", "flex-wrap: wrap;", "align-items: center;", "gap: var(--space-2);"]) expect(rule, decl).toContain(decl)
        expect(css).toMatch(/\n\.ui-detail-note \{[^}]*display: block;[^}]*color: var\(--muted\);[^}]*font-size: var\(--text-sm\);/)
    })
})

describe("the profile, as the form draws it", () => {
    it("is the details when it's seen, where it was the form with every field off", () => {
        expect(FORM).toMatch(/if \(isViewMode\) \{[^}]*?return \(\s*<Page>[\s\S]*?<ProfileView/)
        expect(FORM).not.toMatch(/disabled=\{isViewMode/)
        expect(FORM).not.toMatch(/isViewMode \? \{ background: 'var\(--surface-sunk\)'/)
    })

    it("offers Edit in the page header, to whoever may edit them, where it had only Close", () => {
        expect(FORM).toContain("action={access.edit ? <ButtonLink variant=\"primary\" icon={PencilSimpleIcon} href={`/dashboard/employees/${userId}`} prefetch={false}>{t('edit')}</ButtonLink> : undefined}")
        // Close stays the form's, until part 3; the view goes back by its back link.
        expect(FORM.match(/t\('close_button'\)/g)).toHaveLength(1)
    })

    it("asks what may be seen and done in one place", () => {
        expect(FORM).toContain("const access = profileAccess({ can, viewer, person: { id: userId, role } })")
        for (const gate of ["access.salary && (", "access.dayOffCredit && (", "access.role && (", "access.ownTeamLeader && (", "access.teamLeader && (", "access.status && ("]) expect(FORM, gate).toContain(gate)
    })
})

describe("confirming with one's own password", () => {
    it("is the building blocks' dialog, a form with the password field and Confirm last", () => {
        const src = DIALOG_SRC()
        expect(src).toContain("<Dialog open={open} onClose={cancel} title={t('profile_verify_title')}>")
        expect(src).toContain('<form className="ui-form" noValidate onSubmit={submit}>')
        expect(src).toMatch(/<Field label=\{t\('profile_verify_password'\)\} error=\{error\}>\{p => \(\s*<PasswordInput \{\.\.\.p\} name="password" autoComplete="current-password"/)
        expect(src).toMatch(/<DialogActions>\s*<Button onClick=\{cancel\} disabled=\{busy\}>\{t\('cancel'\)\}<\/Button>\s*<Button type="submit" variant="primary" busy=\{busy\}>\{t\('confirm'\)\}<\/Button>\s*<\/DialogActions>/)
        // Busy, it stays open: what was sent can't be called off.
        expect(src).toContain("const cancel = () => { if (!busy) onCancel() }")
        // The window of its own making is gone, with its hand-drawn lock and eye.
        expect(FORM).not.toContain("modal-overlay")
        expect(FORM).not.toContain('className="animate-spin"')
        expect(FORM).toContain("<ConfirmPasswordDialog")
        expect(FORM).toContain("<TemporaryPasswordDialog")
    })

    // The check failing, as when the server does, isn't the password being wrong.
    it("says a password that couldn't be checked apart from a wrong one", () => {
        const save = FORM.slice(FORM.indexOf("const confirmAndSave"), FORM.indexOf("const handleSubmit"))
        expect(save).toContain("if (!res.ok || !result?.success) return t('profile_verify_failed')")
        expect(save).toContain("if (!result.data?.valid) return t('incorrect_password')")
        expect(save).not.toContain("error_generic")
    })

    it("says what's wrong under the field, in the page's language", async () => {
        const src = DIALOG_SRC()
        expect(src).toContain("if (!password) {\n            setError(t('profile_verify_empty'))")
        const { resetRefusal } = await import("@/lib/profile-password")
        expect(resetRefusal("Invalid admin password")).toBe("incorrect_password")
        expect(resetRefusal("This person's role holds access yours doesn't")).toBe("profile_reset_exceeds")
        expect(resetRefusal("Only the Super Admin resets an Admin's password")).toBe("profile_reset_admin_only")
        expect(resetRefusal(undefined)).toBe("profile_reset_failed")
        expect(resetRefusal("Something else")).toBe("profile_reset_failed")
    })
})

describe("its words", () => {
    const KEYS = ["profile_verify_title", "profile_verify_body", "profile_verify_password", "profile_verify_empty", "profile_reset_password", "profile_temp_password_title",
        "profile_temp_password_hint", "profile_temp_password_once", "profile_reset_exceeds", "profile_reset_admin_only", "profile_reset_failed", "profile_none", "profile_verify_failed"] as const

    it("are in both languages, and the Arabic asks nothing in the masculine", () => {
        for (const key of KEYS) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/(^|\s)(تحقق|أدخل|انسخ|اختر|حاول|اكتب)(\s|$)|هل أنت متأكد|هل تريد/)
        }
        // About the person seen: they, never he.
        for (const key of ["profile_temp_password_hint", "profile_temp_password_once"] as const) expect(en[key], key).not.toMatch(/\b(he|his|him|she|her)\b/i)
    })

    it("are in sentence case where they said End Contract and Assigned Day Off Credit", () => {
        expect(en.end_contract).toBe("End contract")
        expect(en.day_off_credit_assigned).toBe("Assigned day off credit")
        expect(en.profile_reset_password).toBe("Reset password")
    })

    it("take the old window's with them, and the toast's", () => {
        for (const key of ["verify_identity", "enter_password_confirm", "enter_your_password", "reset_password_button", "temp_password_warning", "password_reset_issued"]) {
            expect(en, key).not.toHaveProperty(key)
            expect(ar, key).not.toHaveProperty(key)
        }
    })
})
