import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Security settings on the building blocks (UI_PLAN.md §5 step 5, the pages
 * left): the email gate, the email, two-factor authentication and the
 * trusted devices. Cards of their own making, their sides chosen by hand for
 * each language, every word typed into the page in both languages, a title
 * set into the old top bar, and trusted devices that said there were none
 * when they didn't load.
 */

type Loaded = { data?: unknown; error?: unknown; isValidating?: boolean }
const state = {
    locale: "en" as "en" | "ar",
    viewer: {} as Record<string, unknown>,
    swr: {} as Record<string, Loaded>,
    keys: [] as (string | null)[],
}

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: state.viewer }, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        state.keys.push(key)
        const loaded: Loaded = key ? state.swr[key] ?? {} : {}
        return { data: undefined, error: undefined, isValidating: false, mutate: async () => {}, ...loaded }
    },
}))

const PAGE = "app/(dashboard)/dashboard/security-settings/page.tsx"
const EMAIL = "components/security/EmailSection.tsx"
const MFA = "components/security/MfaSection.tsx"
const DEVICES = "/api/account/mfa/trusted-devices"
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const literal = (text: string) => esc(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const input = (attrs: Record<string, string>) =>
    new RegExp(`<input${Object.entries(attrs).map(([k, v]) => `(?=[^>]*${k}="${v}")`).join("")}[^>]*>`)
const button = (text: string, cls: string, extra = "") => new RegExp(`<button type="(button|submit)" class="${cls}"${extra}>${literal(text)}</button>`)

const person = { id: "u1", role: "EMPLOYEE", email: "desk@shots.test", emailVerified: true, mfaEnabled: false }
const DEVICE_LIST = [
    { id: "d1", label: "Chrome on Windows", createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: "2026-11-03T10:00:00.000Z", expiresAt: "2026-12-03T10:00:00.000Z" },
    { id: "d2", label: null, createdAt: "2026-10-02T10:00:00.000Z", lastUsedAt: "2026-11-01T10:00:00.000Z", expiresAt: "2026-12-01T10:00:00.000Z" },
]

let Page: () => ReactElement
beforeAll(async () => { Page = (await import("@/app/(dashboard)/dashboard/security-settings/page")).default })
beforeEach(() => {
    state.locale = "en"
    state.viewer = { ...person }
    state.swr = {}
    state.keys = []
})
const render = (viewer: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
    state.viewer = { ...person, ...viewer }
    state.locale = locale
    return renderToStaticMarkup(h(Page))
}

describe("Security settings on the building blocks", () => {
    it("has nothing left of its own making: no inline styles, sides, cards, top-bar title or words typed into the page", () => {
        for (const path of [PAGE, EMAIL, MFA]) {
            const src = readFileSync(path, "utf8")
            expect(src, path).not.toContain("style=")
            expect(src, path).not.toContain("direction")
            expect(src, path).not.toContain("glass-card")
            expect(src, path).not.toContain('className="btn"')
            expect(src, path).not.toContain('className="input"')
            expect(src, path).not.toContain("useHeader")
            expect(src, path).not.toMatch(/isAr \?/)
            expect(src, path).not.toMatch(/[؀-ۿ]/)
        }
    })

    it("reads who is looking from the layout on the first paint, where it showed the email gate while the session loaded", () => {
        for (const path of [PAGE, EMAIL, MFA]) {
            const src = readFileSync(path, "utf8")
            expect(src, path).toContain("useViewer()")
            expect(src, path).not.toMatch(/session\?\.user\?\.(emailVerified|mfaEnabled|isProtected|email)/)
        }
    })
})

describe("the email gate", () => {
    it("is named by its page header, and asks for the email alone", () => {
        const html = render({ emailVerified: false })
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.verify_email_required_title)}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.verify_email_required_message)}</p>`)
        expect(html).toMatch(input({ name: "email", type: "email", autoComplete: "email", spellCheck: "false", dir: "ltr", value: "desk@shots.test" }))
        expect(html).toMatch(button(en.send_code_button, "ui-btn ui-btn-primary"))
        // Nothing else to look at until it's done.
        expect(html).not.toContain(esc(en.security_mfa_title))
        expect(html).not.toContain(esc(en.security_settings_nav))
    })

    it("lets a protected Super Admin verify the address they can't change, saying why it can't be", () => {
        const html = render({ role: "SUPER_ADMIN", isProtected: true, emailVerified: false })
        expect(html).toMatch(/<input(?=[^>]*name="email")(?=[^>]*disabled="")[^>]*>/)
        expect(html).toMatch(new RegExp(`<span id="[^"]+-hint" class="ui-hint">${literal(en.email_protected_note)}</span>`))
        expect(html).toMatch(button(en.send_code_button, "ui-btn ui-btn-primary"))
    })

    it("opens the dashboard afresh once verified, where it came back to this page (as Change password did, PR 187)", () => {
        const src = readFileSync(EMAIL, "utf8")
        expect(src).toContain("window.location.replace('/dashboard')")
        expect(src).not.toContain("router.replace(")
    })

    it("says where the code went, the address left to right in either language", () => {
        const src = readFileSync(EMAIL, "utf8")
        expect(src).toContain('<bdi dir="ltr" translate="no">{sentTo}</bdi>')
        expect(en.security_code_sent).toContain("{email}")
        expect(ar.security_code_sent).toContain("{email}")
        // The code: digits, filled in from the message where the phone offers it.
        expect(src).toMatch(/name="code"[^>]*inputMode="numeric"[^>]*autoComplete="one-time-code"/)
    })

    it("breaks a long address to fit, where one with no hyphen ran past the card and pushed a phone sideways (web interface audit, PR 188)", () => {
        // Up to 254 characters, said in the card's note: with no hyphen in it,
        // an address has nowhere to break.
        const src = readFileSync(EMAIL, "utf8")
        expect(src).toContain('<p className="ui-card-note" role="status">{before}<bdi dir="ltr" translate="no">{sentTo}</bdi>{after}</p>')
        const css = readFileSync("components/ui/ui.css", "utf8")
        const start = css.indexOf(".ui-card-note {")
        const note = css.slice(start, css.indexOf("}", start))
        expect(note).toContain("overflow-wrap: anywhere")
    })
})

describe("security settings once the email is verified", () => {
    it("is named by its page header, with the email card saying it's verified", () => {
        const html = render()
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.security_settings_nav)}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.security_settings_subtitle)}</p>`)
        expect(html).toContain(`<h2 class="ui-card-title">${esc(en.email)}</h2>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${esc(en.email_verified_badge)}</span>`)
        expect(html).toMatch(new RegExp(`<span id="[^"]+-hint" class="ui-hint">${literal(en.security_email_change_hint)}</span>`))
    })

    it("offers to send a code only once the address is changed, where it sent one to the address already verified", () => {
        const html = render()
        expect(html).toMatch(button(en.send_code_button, "ui-btn ui-btn-primary", ' disabled=""'))
        // A protected Super Admin's can't be changed: no button at all.
        const locked = render({ role: "SUPER_ADMIN", isProtected: true })
        expect(locked).toMatch(/<input(?=[^>]*name="email")(?=[^>]*disabled="")[^>]*>/)
        expect(locked).not.toContain(`>${esc(en.send_code_button)}</button>`)
    })

    it("offers to set up two-factor authentication while it's off, and shows no trusted devices", () => {
        const html = render()
        expect(html).toContain(`<h2 class="ui-card-title">${esc(en.security_mfa_title)}</h2>`)
        expect(html).toContain(`<span class="ui-badge ui-badge-neutral">${esc(en.security_mfa_off)}</span>`)
        expect(html).toContain(esc(en.security_mfa_off_note))
        expect(html).toMatch(button(en.security_mfa_set_up, "ui-btn ui-btn-primary"))
        expect(html).not.toContain(esc(en.security_devices_title))
        expect(state.keys.every(k => k === null)).toBe(true)
    })

    it("offers to turn it off while it's on, unless the account must keep it", () => {
        const html = render({ mfaEnabled: true })
        expect(html).toContain(`<span class="ui-badge ui-badge-good">${esc(en.security_mfa_on)}</span>`)
        expect(html).toContain(esc(en.security_mfa_on_note))
        expect(html).toMatch(button(en.security_mfa_turn_off, "ui-btn ui-btn-secondary"))
        const required = render({ role: "SUPER_ADMIN", isProtected: true, mfaEnabled: true })
        expect(required).toContain(esc(en.security_mfa_required_note))
        expect(required).not.toContain(esc(en.security_mfa_turn_off))
    })

    it("asks for the password in a dialog before turning it off, with the danger button", () => {
        const src = readFileSync(MFA, "utf8")
        expect(src).toContain("<Dialog")
        expect(src).toMatch(/<PasswordInput[^>]*autoComplete="current-password"/)
        expect(src).toMatch(/variant="danger"[^>]*>\{t\('security_mfa_off_confirm'\)\}/)
    })

    it("shows the QR code at its size, named, and the key to type left to right, never translated", () => {
        const src = readFileSync(MFA, "utf8")
        expect(src).toMatch(/<img[^>]*alt=\{t\('security_mfa_qr_alt'\)\}[^>]*width=\{200\}[^>]*height=\{200\}/)
        expect(src).toContain('<code dir="ltr" translate="no">{enrolment.secret}</code>')
    })
})

describe("trusted devices", () => {
    it("lists each, when it was last used and until when it's trusted, with a named Remove, and Remove all", () => {
        state.swr = { [DEVICES]: { data: { data: { devices: DEVICE_LIST } } } }
        const html = render({ mfaEnabled: true })
        expect(html).toContain(`<h2 class="ui-section-title">${esc(en.security_devices_title)}</h2>`)
        expect(html).toContain(`<ul class="ui-panel ui-rows" aria-label="${esc(en.security_devices_title)}">`)
        expect(html).toContain('<span dir="auto">Chrome on Windows</span>')
        expect(html).toContain(esc(en.security_device_unknown))
        expect(html).toContain(esc(en.security_device_last_used.replace("{date}", "3 Nov 2026")))
        expect(html).toContain(esc(en.security_device_until.replace("{date}", "3 Dec 2026")))
        expect(html).toMatch(button(en.remove, "ui-btn ui-btn-quiet ui-btn-sm", ` aria-label="${literal(en.security_device_remove_named.replace("{device}", "Chrome on Windows"))}"`))
        expect(html).toMatch(button(en.security_devices_remove_all, "ui-btn ui-btn-quiet ui-btn-sm"))
    })

    it("says when there are none, and offers nothing to remove", () => {
        state.swr = { [DEVICES]: { data: { data: { devices: [] } } } }
        const html = render({ mfaEnabled: true })
        expect(html).toContain(esc(en.security_devices_none))
        expect(html).not.toContain(esc(en.security_devices_remove_all))
    })

    it("says it's loading, as a status, and when it couldn't load, with Try again, where both said there were none", () => {
        expect(render({ mfaEnabled: true })).toMatch(/<div class="ui-panel" role="status">.*Loading…/)
        state.swr = { [DEVICES]: { error: new Error("down") } }
        const failed = render({ mfaEnabled: true })
        expect(failed).toContain(esc(en.security_devices_load_failed))
        expect(failed).toContain(">Try again</button>")
        expect(failed).not.toContain(esc(en.security_devices_none))
    })

    it("asks before removing one or all", () => {
        const src = readFileSync(MFA, "utf8")
        expect(src).toContain("t('security_device_remove_title')")
        expect(src).toContain("t('security_devices_remove_all_title')")
    })
})

describe("what's typed", () => {
    it("is checked before anything is sent, each mistake in the reader's language", async () => {
        const { emailError, isCode } = await import("@/lib/security-forms")
        expect(emailError("")).toBe("security_email_invalid")
        expect(emailError("desk@shots")).toBe("security_email_invalid")
        expect(emailError("  desk@shots.test ")).toBeNull()
        // Six digits, as the server takes them (lib/validations).
        expect(isCode("12345")).toBe(false)
        expect(isCode("12a456")).toBe(false)
        expect(isCode(" 123456 ")).toBe(true)
        for (const key of ["security_email_invalid", "security_email_code_invalid", "security_mfa_code_invalid", "security_mfa_password_missing"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })

    it("is asked for in Arabic without a masculine imperative", () => {
        const used = Object.entries(ar).filter(([key]) => key.startsWith("security_") || key.startsWith("verify_email_") || ["check_spam_note", "verify_code_button"].includes(key))
        expect(used.length).toBeGreaterThan(20)
        for (const [key, text] of used) expect(text, key).not.toMatch(/(^|[\s،.؟])(تحقق|امسح|أدخل|اختر|حاول|انتظر|اطلب|اكتب)(?=[\s،.؟]|$)/)
    })
})
