import { afterEach, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { SignOutIcon, WrenchIcon } from "@phosphor-icons/react/ssr"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { LAYER } from "./layers"

/**
 * The code a high-risk action asks for (components/StepUpInterceptor.tsx) and
 * the screen over a page the app has to leave (components/UserHeartbeat.tsx),
 * on the building blocks (DESIGN.md §5.5, Dialog, and "A page the app has to
 * leave"; PR 217).
 *
 * The code was the last of the older pages' windows, its Cancel grey of its
 * own making. A code under six digits kept Confirm off without saying why, a
 * check that failed said the code was wrong, and its minutes were in Western
 * digits in Arabic, which asked one man to type it. When an account was
 * suspended or maintenance started, a dark screen with a turning ring covered
 * the page, titled in Title Case, and screen readers weren't told.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, update: async () => null }), signOut: async () => {} }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/dashboard" }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
beforeEach(() => {
    state.locale = "en"
    // The dialogs go to the page's body, as a portal (mocked above).
    vi.stubGlobal("document", { body: {} })
})
afterEach(() => { vi.unstubAllGlobals() })

const source = (path: string) => readFileSync(path, "utf8")
const UI = source("components/ui/ui.css")
/** A rule's body in ui.css, by its exact selector. */
const rule = (selector: string) => {
    const start = UI.indexOf(`\n${selector} {`)
    if (start < 0) throw new Error(`no rule for ${selector}`)
    return UI.slice(start, UI.indexOf("}", start))
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;")
const noop = () => {}

async function codeDialog(props: Partial<{ minutes: number; code: string; error: "invalid" | "wrong" | "unchecked" | null; checking: boolean }> = {}) {
    const { StepUpCodeDialog } = await import("@/components/StepUpInterceptor")
    return renderToStaticMarkup(h(StepUpCodeDialog, { minutes: 60, code: "", error: null, checking: false, onCode: noop, onSubmit: noop, onCancel: noop, ...props }))
}

describe("the code a high-risk action asks for", () => {
    it("is the building blocks' dialog, above every other one and under the toasts", async () => {
        const src = source("components/StepUpInterceptor.tsx")
        for (const old of ["@/components/Modal", "style={", 'className="btn', "LAYER", "<Link"]) expect(src, old).not.toContain(old)
        // Both of its dialogs: the code, and two-factor sign-in needed first.
        expect(src.match(/<Dialog open\b[^>]*\baboveAll\b/g)).toHaveLength(2)
        const { Dialog } = await import("@/components/ui")
        const html = renderToStaticMarkup(h(Dialog, { open: true, onClose: noop, title: "Confirm it's you", aboveAll: true, children: "x" }))
        expect(html).toContain('<div class="ui-dialog-backdrop is-above-all">')
        // Over a dialog opened from an older page's modal (10000), on the code's own layer, under the toasts.
        expect(rule(".ui-dialog-backdrop.is-above-all")).toContain(`z-index: ${LAYER.codePrompt};`)
        expect(rule(".ui-toasts")).toContain(`z-index: ${LAYER.codePrompt + 1};`)
    })

    it("is a form: why and for how long, the six digits left to right, then Cancel and Confirm", async () => {
        const html = await codeDialog()
        expect(html).toMatch(/<form class="ui-form" novalidate="">/i)
        expect(html).toContain(esc(en.step_up_hint.replace("{minutes}", "60 minutes")))
        expect(html).toContain(`>${esc(en.step_up_code)}</label>`)
        const input = html.match(/<input [^>]*>/)?.[0] ?? ""
        for (const attr of ['name="code"', 'inputMode="numeric"', 'autoComplete="one-time-code"', 'spellCheck="false"', 'dir="ltr"']) {
            expect(input.toLowerCase(), attr).toContain(attr.toLowerCase())
        }
        // Six digits at most by what's kept, not by the field: cut at six, "123 456" pasted lost its 6.
        expect(input.toLowerCase()).not.toContain("maxlength")
        // Its buttons in the form, so Enter and Confirm are the form's: Cancel first, the main one last.
        expect(html).toMatch(/<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">Cancel<\/button><button type="submit" class="ui-btn ui-btn-primary">Confirm<\/button><\/div><\/form>/)
    })

    it("says its minutes in the page's digits, and asks anyone in Arabic", async () => {
        state.locale = "ar"
        const html = await codeDialog({ minutes: 60 })
        expect(html).toContain("٦٠ دقيقة")
        expect(html).not.toContain("60")
        expect(await codeDialog({ minutes: 5 })).toContain("٥ دقائق")
        // Asked of anyone: يُرجى, not the masculine «أدخل», and not to one person («منك»).
        expect(ar.step_up_hint).toContain("يُرجى")
        for (const masculine of ["أدخل", "منك"]) expect(ar.step_up_hint, masculine).not.toContain(masculine)
        expect(ar.step_up_enrol_hint).toContain("يُرجى")
        for (const masculine of ["فعّلها", "ثم حاول"]) expect(ar.step_up_enrol_hint, masculine).not.toContain(masculine)
    })

    it("says what's wrong under the code: not six digits, not right, or not checked", async () => {
        const cases = [["invalid", en.security_mfa_code_invalid], ["wrong", en.security_mfa_code_wrong], ["unchecked", en.step_up_unchecked]] as const
        for (const [error, text] of cases) {
            const html = await codeDialog({ error })
            expect(html, error).toMatch(new RegExp(`<span id="[^"]+-error" class="ui-error">${esc(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span>`))
            expect(html, error).toContain('aria-invalid="true"')
        }
        // A check that couldn't be made says so, to try again: it was said as a wrong code.
        expect(en.step_up_unchecked).toBe("The code couldn't be checked. Please try again.")
        expect(ar.step_up_unchecked).toBe("تعذّر التحقق من الرمز. يُرجى المحاولة مرة أخرى.")
    })

    it("keeps a code's digits as typed or pasted, Arabic ones too, six at most", async () => {
        const { codeDigits } = await import("@/lib/security-forms")
        expect(codeDigits("123456")).toBe("123456")
        // As an app shows it, and as a phone's Arabic keyboard types it: the old field took none of these.
        expect(codeDigits("123 456")).toBe("123456")
        expect(codeDigits("١٢٣٤٥٦")).toBe("123456")
        expect(codeDigits("۱۲۳ ۴۵۶")).toBe("123456")
        expect(codeDigits("1234567")).toBe("123456")
        expect(codeDigits("12a-34")).toBe("1234")
        expect(source("components/StepUpInterceptor.tsx")).toContain("onCode={value => setCode(codeDigits(value))}")
    })

    it("turns Cancel off and Confirm busy while the code is checked", async () => {
        const html = await codeDialog({ code: "123456", checking: true })
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-secondary" disabled="">Cancel<\/button>/)
        expect(html).toMatch(/<button type="submit" class="ui-btn ui-btn-primary" disabled="" aria-busy="true">Confirm<\/button>/)
    })

    it("checks six digits before sending, and reads the answer without calling a check not made a wrong code", async () => {
        const { stepUpCheck } = await import("@/lib/step-up-check")
        // No session back from update(): offline, or the server failed.
        expect(stepUpCheck(null, 1)).toBe("unchecked")
        expect(stepUpCheck(undefined, null)).toBe("unchecked")
        // The same time as before: not confirmed, whatever this browser's clock says.
        expect(stepUpCheck({ user: { stepUpAt: 1 } }, 1)).toBe("wrong")
        expect(stepUpCheck({ user: { stepUpAt: null } }, null)).toBe("wrong")
        expect(stepUpCheck({ user: {} }, null)).toBe("wrong")
        expect(stepUpCheck({ user: { stepUpAt: 2 } }, 1)).toBe("confirmed")
        expect(stepUpCheck({ user: { stepUpAt: 2 } }, null)).toBe("confirmed")
        const src = source("components/StepUpInterceptor.tsx")
        // Six digits or nothing is sent; then the answer, read by stepUpCheck.
        expect(src.indexOf("if (!isCode(code))")).toBeGreaterThan(-1)
        expect(src.indexOf("if (!isCode(code))")).toBeLessThan(src.indexOf("updateRef.current({ stepUpCode:"))
        expect(src).toContain("stepUpCheck(session, previousRef.current)")
        // The old Confirm was off until six digits, without saying why.
        expect(src).not.toContain("code.trim().length < 6")
    })

    it("for an account without two-factor sign-in, says it's needed, with Cancel and a link to set it up", async () => {
        const { StepUpEnrolDialog } = await import("@/components/StepUpInterceptor")
        const html = renderToStaticMarkup(h(StepUpEnrolDialog, { onClose: noop }))
        expect(html).toContain(`>${esc(en.step_up_enrol_title)}</h2>`)
        expect(html).toContain(`<p>${esc(en.step_up_enrol_hint)}</p>`)
        expect(html).toMatch(/<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-secondary">Cancel<\/button><a class="ui-btn ui-btn-primary" href="\/dashboard\/security-settings">Open Security settings<\/a><\/div>/)
    })
})

describe("a page the app has to leave", () => {
    async function cover(props: { title: string; why?: string | null; next: string }) {
        const { LeavingCover } = await import("@/components/UserHeartbeat")
        return renderToStaticMarkup(h(LeavingCover, { icon: SignOutIcon, ...props }))
    }

    it("is a dialog with no buttons, which screen readers hear at once", async () => {
        const html = await cover({ title: en.account_suspended, why: en.suspension_msg, next: en.logging_out_msg })
        expect(html.startsWith('<div class="ui-cover">')).toBe(true)
        const panel = html.match(/<div [^>]*role="alertdialog"[^>]*>/)?.[0] ?? ""
        expect(panel).toContain('aria-modal="true"')
        expect(panel).toContain(`aria-label="${esc(en.account_suspended)}"`)
        expect(panel).toContain('tabindex="-1"')
        // Told what happened, why, and what's next: the empty state's lines, by their id.
        const described = panel.match(/aria-describedby="([^"]+)"/)?.[1]
        expect(described).toBeTruthy()
        expect(html).toContain(`<p class="ui-empty-detail"><span id="${described}"><span dir="auto">${esc(en.suspension_msg)}</span><br/>${esc(en.logging_out_msg)}</span></p>`)
        expect(html).toContain(`<p class="ui-empty-title">${esc(en.account_suspended)}</p>`)
        expect(html).not.toContain("<button")
        // With nothing to say why, as maintenance with no message, what's next alone.
        expect(await cover({ title: en.maintenance_detected_title, why: null, next: en.maintenance_saving_msg })).toContain(`<span id="${described}">${esc(en.maintenance_saving_msg)}</span>`)
    })

    it("covers the whole screen in the page's colour, above the dialogs and the toasts, with nothing turning", () => {
        const cover = rule(".ui-cover")
        // A long maintenance message scrolls inside it, on a phone too.
        for (const decl of ["position: fixed;", "inset: 0;", "z-index: 99998;", "background: var(--page);", "padding: var(--space-4);", "overflow-y: auto;"]) expect(cover, decl).toContain(decl)
        // Under the screen shown while the language changes (99999) only.
        expect(rule(".ui-switching")).toContain("z-index: 99999;")
        const heartbeat = source("components/UserHeartbeat.tsx")
        for (const old of ["style={", "animation", "spin", "🔧", "--scrim-deep", "<h1"]) expect(heartbeat, old).not.toContain(old)
        expect(heartbeat).toContain("<LeavingCover icon={SignOutIcon}")
        expect(heartbeat).toContain("<LeavingCover icon={WrenchIcon}")
        expect(heartbeat).toContain("document.body")
        expect(WrenchIcon).toBeTruthy()
    })

    it("scrolls a why longer than the screen from its top, breaks a long link in it, and draws no ring", () => {
        const cover = rule(".ui-cover")
        const panel = rule(".ui-cover-panel")
        // In the middle by its own margins: centred by the cover instead, one taller than the
        // screen, as a long maintenance message on a phone on its side, starts above its top,
        // out of the scroll's reach.
        for (const decl of ["align-items:", "justify-content:"]) expect(cover, decl).not.toContain(decl)
        expect(panel).toContain("margin: auto;")
        expect(cover).toContain("overscroll-behavior: contain;")
        // A link with no space in it breaks where it must, rather than run off the side.
        expect(panel).toContain("overflow-wrap: anywhere;")
        // Nothing on it can be used: no ring, the keyboard's included.
        expect(rule(".ui-cover-panel:focus")).toContain("outline: none;")
        expect(UI).not.toContain(".ui-cover-panel:focus:not(:focus-visible)")
    })

    it("says what happened in sentence case, and what's next as it happens", () => {
        expect([en.account_suspended, en.account_archived, en.company_banned, en.maintenance_detected_title])
            .toEqual(["Account suspended", "Account closed", "Company banned", "The system is under maintenance"])
        expect(en.logging_out_msg).toBe("Saving your work, then signing you out…")
        expect(en.maintenance_saving_msg).toBe("Saving your work, then taking you to the maintenance page…")
        expect(ar.logging_out_msg).toBe("جارٍ حفظ العمل، ثم تسجيل الخروج…")
        expect(ar.maintenance_saving_msg).toBe("جارٍ حفظ العمل، ثم الانتقال إلى صفحة الصيانة…")
        for (const text of [en.logging_out_msg, en.maintenance_saving_msg, ar.logging_out_msg, ar.maintenance_saving_msg]) expect(text).not.toContain("...")
    })

    it("says nothing of a beat that couldn't reach the server, as when the page is left mid-request", () => {
        const heartbeat = source("components/UserHeartbeat.tsx")
        // "Heartbeat failed: TypeError: Failed to fetch" was logged on every page change: the next beat asks again.
        expect(heartbeat).toMatch(/const res = await fetch\('\/api\/user\/activity', \{[^}]*method: 'POST'[\s\S]*?\}\)\.catch\(\(\) => null\)\s*(\/\/[^\n]*\n\s*)*if \(!res\?\.ok\) return/)
    })
})
