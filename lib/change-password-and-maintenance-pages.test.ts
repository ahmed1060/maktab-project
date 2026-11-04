import { beforeAll, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Change password and the maintenance screen on the building blocks
 * (UI_PLAN.md §5 step 5, the pages left), the two screens that hold somebody
 * before the dashboard: cards of their own making, their sides chosen by hand
 * for each language, their words typed into the page in both languages,
 * Change password's mistakes said as toasts, and on the waiting page a wrench
 * emoji and a ring that turned by itself.
 */

const state = { locale: "en" as "en" | "ar", viewer: { id: "u1", role: "EMPLOYEE", mustChangePassword: true } as Record<string, unknown> }

vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: state.viewer }, status: "authenticated", update: async () => null }) }))
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))

const CHANGE = "app/(dashboard)/dashboard/change-password/page.tsx"
const WAIT = "app/(dashboard)/dashboard/maintenance/page.tsx"
/** As React writes text into the page. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const literal = (text: string) => esc(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const input = (attrs: Record<string, string>) =>
    new RegExp(`<input${Object.entries(attrs).map(([k, v]) => `(?=[^>]*${k}="${v}")`).join("")}[^>]*>`)
const label = (text: string) => new RegExp(`<label for="[^"]+" class="ui-label">${literal(text)}</label>`)

let ChangePassword: () => ReactElement
let Maintenance: () => ReactElement
beforeAll(async () => {
    ChangePassword = (await import("@/app/(dashboard)/dashboard/change-password/page")).default
    Maintenance = (await import("@/app/(dashboard)/dashboard/maintenance/page")).default
})
const render = (page: () => ReactElement, locale: "en" | "ar" = "en") => {
    state.locale = locale
    return renderToStaticMarkup(h(page))
}

describe("Change password on the building blocks", () => {
    it("has nothing left of its own making: no inline styles, sides, card, or words typed into the page", () => {
        const src = readFileSync(CHANGE, "utf8")
        expect(src).not.toContain("style=")
        expect(src).not.toContain("direction")
        expect(src).not.toContain("glass-card")
        expect(src).not.toContain('className="input"')
        expect(src).not.toContain('className="btn"')
        expect(src).not.toMatch(/isAr \?/)
        expect(src).not.toMatch(/[؀-ۿ]/)
    })

    it("is named by its page header, in both languages", () => {
        const html = render(ChangePassword)
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.change_password_title)}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.change_password_subtitle)}</p>`)
        const arabic = render(ChangePassword, "ar")
        expect(arabic).toContain(`<h1 class="ui-page-title">${esc(ar.change_password_title)}</h1>`)
        expect(arabic).toContain(`<p class="ui-page-subtitle">${esc(ar.change_password_subtitle)}</p>`)
    })

    it("asks for the new password twice, each a password field that can be shown, filled in as a new one", () => {
        const html = render(ChangePassword)
        expect(html).toMatch(label(en.change_password_new))
        expect(html).toMatch(label(en.change_password_confirm))
        expect(html).toMatch(input({ name: "newPassword", type: "password", autoComplete: "new-password", maxLength: "72" }))
        expect(html).toMatch(input({ name: "confirmPassword", type: "password", autoComplete: "new-password", maxLength: "72" }))
        expect(html.match(/aria-label="Show password"/g)).toHaveLength(2)
        // How long it must be, as the new one's hint (DESIGN.md §5.3).
        expect(html).toMatch(new RegExp(`<span id="[^"]+-hint" class="ui-hint">${literal(en.change_password_new_hint)}</span>`))
        expect(html).toMatch(new RegExp(`<button type="submit" class="ui-btn ui-btn-primary">${literal(en.change_password_save)}</button>`))
    })

    it("says what's wrong under the field it's about, in the reader's language, where it was a toast", async () => {
        const { NEW_PASSWORD_FIELDS, newPasswordErrors } = await import("@/lib/new-password-form")
        expect(newPasswordErrors({ newPassword: "short", confirmPassword: "short" })).toEqual({ newPassword: "change_password_short" })
        expect(newPasswordErrors({ newPassword: "a-long-password-1", confirmPassword: "a-long-password-2" })).toEqual({ confirmPassword: "change_password_mismatch" })
        expect(newPasswordErrors({ newPassword: "a-long-password-1", confirmPassword: "" })).toEqual({ confirmPassword: "change_password_mismatch" })
        expect(newPasswordErrors({ newPassword: "short", confirmPassword: "" })).toEqual({ newPassword: "change_password_short", confirmPassword: "change_password_mismatch" })
        expect(newPasswordErrors({ newPassword: "a-long-password-1", confirmPassword: "a-long-password-1" })).toEqual({})
        // The first wrong one, as the form reads, takes the focus.
        expect(NEW_PASSWORD_FIELDS).toEqual(["newPassword", "confirmPassword"])
        for (const key of ["change_password_short", "change_password_mismatch", "change_password_failed", "change_password_done"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
        // And the server's refusal above the button, as Add employee's is.
        const src = readFileSync(CHANGE, "utf8")
        expect(src).toContain('<p className="ui-error" role="alert">')
        expect(src).toContain("apiErrorText(")
        expect(src).not.toMatch(/showToast\([^)]*'error'\)/)
    })

    it("changes the password of whoever the layout says is signed in, not of an id still loading", () => {
        const src = readFileSync(CHANGE, "utf8")
        expect(src).toContain("useViewer()")
        expect(src).not.toContain("session?.user?.id")
    })

    it("opens the dashboard once it's changed, where it came back to this page (browser flows on PR 187)", () => {
        // Signing in went to the dashboard, which was turned to this page,
        // and the app kept that answer: going to the dashboard again within
        // the app came straight back here, asking the server nothing, with
        // the password changed. Loaded afresh, the gate reads the new session.
        const src = readFileSync(CHANGE, "utf8")
        expect(src).toContain("window.location.replace('/dashboard')")
        expect(src).not.toContain("router.replace(")
    })
})

describe("The maintenance screen on the building blocks", () => {
    it("has nothing left of its own making: no inline styles, sides, emoji, or a ring turning by itself", () => {
        const src = readFileSync(WAIT, "utf8")
        expect(src).not.toContain("style=")
        expect(src).not.toContain("direction")
        expect(src).not.toMatch(/🔧/u)
        expect(src).not.toContain("animation")
        // Things move only when somebody acts (DESIGN.md §8): the ring said
        // only "Checking...", which the page says in words.
        expect(src).not.toContain("maintenance_page_checking")
        expect("maintenance_page_checking" in en).toBe(false)
        expect("maintenance_page_checking" in ar).toBe(false)
    })

    it("names itself in its page header, in sentence case, and says they'll be taken back by themselves", () => {
        expect(en.maintenance_page_title).toBe("The system is under maintenance")
        expect(en.maintenance_page_subtitle).not.toContain("—")
        const html = render(Maintenance)
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.maintenance_page_title)}</h1>`)
        expect(html).toContain(`<p class="ui-page-subtitle">${esc(en.maintenance_page_subtitle)}</p>`)
        const arabic = render(Maintenance, "ar")
        expect(arabic).toContain(`<h1 class="ui-page-title">${esc(ar.maintenance_page_title)}</h1>`)
        expect(arabic).toContain(`<p class="ui-page-subtitle">${esc(ar.maintenance_page_subtitle)}</p>`)
    })

    it("shows the Super Admins' message as they typed it, under that line, where it took that line's place", () => {
        const src = readFileSync(WAIT, "utf8")
        // The page's own line stays, whatever the message.
        expect(src).toContain("subtitle={t('maintenance_page_subtitle')}")
        expect(src).toContain("<Card title={t('maintenance_page_note')}")
        // Text somebody typed keeps its own direction (DESIGN.md §7).
        expect(src).toContain('<p dir="auto">{message}</p>')
        // With none, there's no card.
        expect(render(Maintenance)).not.toContain(esc(en.maintenance_page_note))
    })
})
