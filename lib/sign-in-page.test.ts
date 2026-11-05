import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The sign-in page, part 1 (UI_PLAN.md §5 step 5, the pages left): its
 * screen, signing in and the two-factor code, on the building blocks
 * (DESIGN.md §5.5, Sign-in). It was a glass card of its own making over a
 * moving gradient, its checkboxes drawn by hand and its words typed into the
 * page in both languages, and on a phone the switches pinned to the screen's
 * corners covered Sign in and the legal links.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key, setLanguage: () => {}, isChangingLocale: false }),
}))
vi.mock("@/context/ThemeContext", () => ({ useTheme: () => ({ theme: "light", setTheme: () => {} }) }))
vi.mock("next-auth/react", () => ({ signIn: async () => ({ ok: true }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/lib/client-error-report", () => ({ reportClientError: async () => null }))
beforeEach(() => { state.locale = "en" })
// Loaded once, first: compiled cold, the page takes longer than a test may.
beforeAll(async () => {
    await import("@/components/sign-in/SignInScreen")
    await import("@/components/sign-in/CredentialsStep")
    await import("@/components/sign-in/CodeStep")
    await import("@/app/(auth)/login/page")
}, 60_000)

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const re = (text: string) => esc(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const render = (node: ReactNode) => renderToStaticMarkup(node as never)
const source = (path: string) => readFileSync(path, "utf8")
const PAGE = () => source("app/(auth)/login/page.tsx")
const FOLDER = "components/sign-in"
const css = () => source("components/ui/ui.css")
const rule = (selector: string) => {
    const all = css()
    const at = all.indexOf(`\n${selector} {`)
    expect(at, `no rule for ${selector}`).toBeGreaterThan(-1)
    return all.slice(at, all.indexOf("}", at))
}

/** A field by its label, up to its end: its control, and its hint or its error. */
function field(html: string, label: string): string {
    const at = html.indexOf(`>${esc(label)}</label>`)
    expect(at, `no field labelled ${label}`).toBeGreaterThan(-1)
    const start = html.lastIndexOf('<div class="ui-field">', at)
    return html.slice(start, html.indexOf("</div>", at) + 6)
}
const input = (chunk: string) => chunk.match(/<input[^>]*>/)?.[0] ?? ""
const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(m => ({ attrs: m[1], text: m[2].replace(/<[^>]+>/g, "") }))

const screen = async (props: { title: string; subtitle?: string }) => {
    const { SignInScreen } = await import("@/components/sign-in/SignInScreen")
    return render(h(SignInScreen, { ...props, children: h("p", null, "the step") }))
}
const credentials = async (over: Record<string, unknown> = {}) => {
    const { CredentialsStep } = await import("@/components/sign-in/CredentialsStep")
    return render(h(CredentialsStep, {
        identifier: "", password: "", staySignedIn: false, errors: {}, message: null, busy: false,
        onIdentifier: () => {}, onPassword: () => {}, onStaySignedIn: () => {}, onSubmit: () => {}, onForgot: () => {}, ...over,
    } as never))
}
const codeStep = async (over: Record<string, unknown> = {}) => {
    const { CodeStep } = await import("@/components/sign-in/CodeStep")
    return render(h(CodeStep, {
        kind: "app", code: "", rememberDevice: false, error: undefined, message: null, busy: false, sending: false,
        onCode: () => {}, onRememberDevice: () => {}, onSubmit: () => {}, onEmailCode: () => {}, onUseApp: () => {}, onBack: () => {}, ...over,
    } as never))
}
const message = async (over: Record<string, unknown> = {}) => {
    const { SignInMessage } = await import("@/components/sign-in/SignInMessage")
    return render(h(SignInMessage, { hold: null, error: "", notice: "", onHoldOver: () => {}, ...over } as never))
}

describe("the sign-in screen", () => {
    it("is a card on the page, its title saying what's done here", async () => {
        const html = await screen({ title: en.sign_in_title })
        expect(en.sign_in_title).toBe("Sign in to Nizmo")
        expect(ar.sign_in_title).toBe("تسجيل الدخول إلى Nizmo")
        expect(html).toMatch(new RegExp(`^<div class="ui-signin"><main class="ui-signin-main"><div class="ui-panel ui-signin-card"><div class="ui-signin-head"><h1 class="ui-page-title">${re(en.sign_in_title)}</h1></div><p>the step</p></div></main>`))
    })

    it("has a line under the title on what to type, for a step that needs one", async () => {
        const html = await screen({ title: en.sign_in_code_title, subtitle: en.sign_in_code_app_hint })
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.sign_in_code_title)}</h1><p class="ui-page-subtitle">${esc(en.sign_in_code_app_hint)}</p></div>`)
    })

    it("is flat behind: no gradient, glass, or anything moving, and no styles of its own making", () => {
        for (const file of readdirSync(FOLDER)) {
            const src = source(`${FOLDER}/${file}`)
            for (const made of ["style={{", "linear-gradient", "backdropFilter", "animation"]) expect(src, `${file}: ${made}`).not.toContain(made)
        }
        expect(rule(".ui-signin")).toContain("background: var(--page);")
        expect(rule(".ui-signin")).toContain("min-height: 100dvh;")
    })

    it("is a card 400px wide at most, with 32px inside, 24px on phones", () => {
        expect(rule(".ui-signin-card")).toContain("max-width: 400px;")
        expect(rule(".ui-signin-card")).toContain("padding: var(--space-8);")
        const phone = css().slice(css().indexOf("/* Sign-in on phones"))
        expect(phone).toMatch(/^\/\* Sign-in on phones[^]*?@media \(max-width: 767px\) \{\s*\.ui-signin-card \{\s*padding: var\(--space-6\);/)
    })

    it("puts the legal links and the switches under the card, as part of the page, never over it", async () => {
        const html = await screen({ title: en.sign_in_title })
        const foot = html.slice(html.indexOf("</main>"))
        expect(foot).toMatch(/^<\/main><footer class="ui-signin-foot"><div class="ui-signin-links">/)
        expect(foot).toContain(`<a href="/privacy">${esc(en.privacy_policy)}</a><a href="/terms">${esc(en.terms_of_service)}</a>`)
        expect(foot).toContain(`<div class="ui-signin-switches"><div role="group" aria-label="${esc(en.theme_label)}"`)
        expect(foot).toContain(`aria-label="${esc(en.toggle_language)}"`)
        expect(rule(".ui-signin-foot")).toContain("flex-wrap: wrap;")
        expect(css().slice(css().indexOf("/* ── Sign-in"), css().indexOf("/* Sign-in on phones"))).not.toContain("position: fixed")
        // Pinned to the corners, they covered Sign in on a phone.
        expect(existsSync("components/PreferenceBar.tsx")).toBe(false)
    })

    // Tall enough to tap on a phone (DESIGN.md §9): the account menu's
    // switches, kept until the app shell replaces them, were 30px there
    // (web interface audit).
    it("makes the switches' options tall enough to tap on a phone", () => {
        const phone = css().slice(css().indexOf("/* Sign-in on phones"))
        expect(phone.slice(0, phone.indexOf("\n}\n"))).toMatch(/\.ui-signin-switches button \{\s*min-height: 44px;\s*\}/)
    })

    it("is in the building blocks' font", () => {
        expect(css().slice(0, css().indexOf("font-family: var(--font-ui);"))).toContain(".ui-signin,")
    })
})

describe("signing in", () => {
    it("asks for the email or username, written left to right in both languages, each field with its label", async () => {
        const html = await credentials()
        const account = input(field(html, en.sign_in_identifier))
        for (const attr of ['name="identifier"', 'type="text"', 'dir="ltr"', 'autoComplete="username"', 'spellCheck="false"', 'autoCapitalize="none"', 'maxLength="254"']) {
            expect(account, attr).toContain(attr)
        }
        // The label says what it is: the placeholder repeated it, and in
        // Arabic it was cut short at its start.
        expect(account).not.toContain("placeholder")
    })

    it("asks for the password with its eye button", async () => {
        const html = await credentials()
        const password = field(html, en.password)
        for (const attr of ['type="password"', 'name="password"', 'autoComplete="current-password"', 'maxLength="72"']) expect(input(password), attr).toContain(attr)
        expect(input(password)).not.toContain("placeholder")
        expect(password).toContain(`aria-label="${esc(en.show_password)}"`)
    })

    it("offers Forgot your password? as a quiet button under the password", async () => {
        const html = await credentials()
        const after = html.slice(html.indexOf(field(html, en.password)) + field(html, en.password).length)
        expect(after).toMatch(new RegExp(`^<button type="button" class="ui-btn ui-btn-quiet ui-signin-forgot">${re(en.sign_in_forgot)}</button>`))
        expect(en.sign_in_forgot).toBe("Forgot your password?")
    })

    it("has Stay signed in as a checkbox with its label", async () => {
        expect(await credentials()).toContain(`<label class="ui-choice"><input type="checkbox" class="ui-check" name="staySignedIn"/>${esc(en.stay_signed_in)}</label>`)
        expect(await credentials({ staySignedIn: true })).toContain(`<input type="checkbox" class="ui-check" name="staySignedIn" checked=""/>`)
    })

    it("has Sign in as its one primary button, busy while it signs in", async () => {
        const html = await credentials()
        expect(en.sign_in).toBe("Sign in")
        expect(html.match(/ui-btn-primary/g)).toHaveLength(1)
        expect(html).toContain(`<button type="submit" class="ui-btn ui-btn-primary">${esc(en.sign_in)}</button>`)
        expect(await credentials({ busy: true })).toContain(`<button type="submit" class="ui-btn ui-btn-primary" disabled="" aria-busy="true">${esc(en.sign_in)}</button>`)
    })

    it("says what's missing under its field", async () => {
        const html = await credentials({ errors: { identifier: en.sign_in_identifier_needed, password: en.sign_in_password_needed } })
        for (const [label, error] of [[en.sign_in_identifier, en.sign_in_identifier_needed], [en.password, en.sign_in_password_needed]]) {
            const chunk = field(html, label)
            expect(input(chunk), label).toContain('aria-invalid="true"')
            expect(chunk, label).toMatch(new RegExp(`<span id="[^"]+-error" class="ui-error">${re(error)}</span></div>$`))
        }
    })

    it("says the server's answer above Sign in", async () => {
        const said = await message({ error: en.error_invalid_credentials })
        const html = await credentials({ message: h("p", { className: "ui-error", role: "alert" }, en.error_invalid_credentials) })
        expect(html).toContain(`<div class="ui-signin-actions">${said}<button type="submit"`)
    })
})

describe("what the server answered", () => {
    it("is heard by screen readers, a problem as an alert", async () => {
        expect(await message({ error: en.error_invalid_credentials })).toBe(`<p class="ui-error" role="alert">${esc(en.error_invalid_credentials)}</p>`)
        expect(await message({ notice: en.sign_in_wait_over })).toBe(`<p class="ui-hint" role="status">${esc(en.sign_in_wait_over)}</p>`)
        expect(await message()).toBe("")
    })

    it("counts down an account held back, in even-width digits, in place of anything else", async () => {
        const html = await message({ hold: { kind: "pause", until: Date.now() + 30_000 }, error: "x", notice: "y" })
        expect(html).toMatch(new RegExp(`^<p class="ui-error ui-num" role="alert">${re(en.sign_in_paused_wait.split("{time}")[0])}<span role="timer" aria-live="off">0:(30|29)</span>`))
    })
})

describe("the two-factor code", () => {
    it("asks for the code from the authenticator app, focused, its six digits left to right", async () => {
        const html = await codeStep()
        const code = input(field(html, en.sign_in_code))
        for (const attr of ['name="code"', 'inputMode="numeric"', 'autoComplete="one-time-code"', 'maxLength="6"', 'spellCheck="false"', 'dir="ltr"', 'autofocus=""']) expect(code, attr).toContain(attr)
    })

    it("offers to remember the device, as a checkbox with its label", async () => {
        expect(await codeStep()).toContain(`<label class="ui-choice"><input type="checkbox" class="ui-check" name="rememberDevice"/>${esc(en.sign_in_remember_device)}</label>`)
        // With an emailed code too: ticked before choosing it, it was hidden
        // there and still remembered the device.
        expect(await codeStep({ kind: "email", rememberDevice: true })).toContain(`<input type="checkbox" class="ui-check" name="rememberDevice" checked=""/>`)
    })

    it("has Verify as its one primary button, and the others quiet under it", async () => {
        const app = buttons(await codeStep()).filter(b => b.attrs.includes("ui-btn"))
        expect(app.map(b => [b.attrs.match(/ui-btn-(\w+)/)?.[1], b.text])).toEqual([
            ["primary", en.sign_in_verify], ["quiet", en.sign_in_email_code], ["quiet", en.sign_in_back],
        ])
        const email = buttons(await codeStep({ kind: "email" })).filter(b => b.attrs.includes("ui-btn"))
        expect(email.map(b => [b.attrs.match(/ui-btn-(\w+)/)?.[1], b.text])).toEqual([
            ["primary", en.sign_in_verify], ["quiet", en.sign_in_email_code_again], ["quiet", en.sign_in_use_app], ["quiet", en.sign_in_back],
        ])
        expect((await codeStep({ busy: true })).match(/<button type="submit"[^>]*>/)?.[0]).toContain('aria-busy="true"')
        expect((await codeStep({ sending: true })).match(new RegExp(`<button[^>]*>${re(en.sign_in_email_code)}`))?.[0]).toContain('aria-busy="true"')
    })

    it("says where an emailed code may be, under the code", async () => {
        const chunk = field(await codeStep({ kind: "email" }), en.sign_in_code)
        expect(chunk).toMatch(new RegExp(`<span id="[^"]+-hint" class="ui-hint">${re(en.sign_in_code_spam)}</span></div>$`))
        expect(field(await codeStep(), en.sign_in_code)).not.toContain("ui-hint")
    })

    it("says a code that isn't right under the code", async () => {
        const chunk = field(await codeStep({ error: en.security_mfa_code_wrong }), en.sign_in_code)
        expect(input(chunk)).toContain('aria-invalid="true"')
        expect(chunk).toMatch(new RegExp(`<span id="[^"]+-error" class="ui-error">${re(en.security_mfa_code_wrong)}</span></div>$`))
    })

    it("says the server's answer above Verify", async () => {
        const html = await codeStep({ message: h("p", { className: "ui-error", role: "alert" }, "No") })
        expect(html).toContain(`<div class="ui-signin-actions"><p class="ui-error" role="alert">No</p><button type="submit"`)
    })
})

describe("what's checked before anything is sent", () => {
    it("is an email or username, and a password", async () => {
        const { signInErrors } = await import("@/lib/sign-in-form")
        expect(signInErrors({ identifier: "", password: "" })).toEqual({ identifier: "sign_in_identifier_needed", password: "sign_in_password_needed" })
        expect(signInErrors({ identifier: "   ", password: "x" })).toEqual({ identifier: "sign_in_identifier_needed" })
        expect(signInErrors({ identifier: "laila", password: " " })).toEqual({})
    })

    it("is a code of six digits, said as where it came from says it", async () => {
        const { codeError } = await import("@/lib/sign-in-form")
        expect(codeError("12345", "app")).toBe("security_mfa_code_invalid")
        expect(codeError("12345", "email")).toBe("security_email_code_invalid")
        expect(codeError("12a456", "app")).toBe("security_mfa_code_invalid")
        expect(codeError(" 123456 ", "app")).toBeNull()
    })

    it("is checked by the page, with the focus on the first that's wrong", () => {
        expect(PAGE()).toMatch(/const wrong = signInErrors\(\{ identifier, password \}\)[^]{0,300}focusFirstWrong\(form\)/)
        expect(PAGE()).toMatch(/const wrong = codeError\(code, kind\)[^]{0,200}focusFirstWrong\(form\)/)
    })

    it("sends the email or username without spaces at its ends, as a phone's keyboard adds", () => {
        expect(PAGE().match(/email: identifier\.trim\(\)/g)).toHaveLength(3)
        expect(PAGE()).not.toMatch(/password: password\.trim\(\)|password\.trim\(\)/)
    })
})

describe("the code the server turned down", () => {
    it("is said under the code, as where it came from says it", async () => {
        const { codeErrorKey, isWrongCode } = await import("@/lib/login-errors")
        expect(codeErrorKey("INVALID_MFA_CODE", "app")).toBe("security_mfa_code_wrong")
        expect(codeErrorKey("INVALID_MFA_CODE", "email")).toBe("sign_in_email_code_wrong")
        expect(isWrongCode("INVALID_MFA_CODE")).toBe(true)
        expect(isWrongCode("Your account has been suspended or deleted.")).toBe(false)
        expect(PAGE()).toMatch(/if \(isWrongCode\(res\?\.error\)\) \{\s*setCodeErr\(t\(key\)\)\s*focusFirstWrong\(form\)/)
    })

    it("says why an account can't sign in at the code too, where it said something went wrong", async () => {
        const { codeErrorKey } = await import("@/lib/login-errors")
        expect(codeErrorKey("Your account has been suspended or deleted.", "app")).toBe("error_suspended")
        expect(codeErrorKey("CredentialsSignin", "app")).toBe("error_invalid_credentials")
        expect(codeErrorKey(undefined, "app")).toBe("error_generic")
    })
})

describe("emailing a code instead", () => {
    it("is answered by the server with codes beside its words", () => {
        const route = source("app/api/auth/mfa-recovery/request/route.ts")
        expect(route).toContain(`ApiResponse.refused(403, "Invalid credentials", "WRONG_PASSWORD")`)
        expect(route).toContain(`ApiResponse.refused(403, "MFA recovery is not available for this account", "NO_EMAIL_CODES")`)
        expect(route).toContain(`ApiResponse.refused(429, "Too many code requests — try again later", "TOO_MANY_CODES")`)
        // The hold is said as sign-in says it, so the page counts it down.
        expect(route).toContain("ApiResponse.error(holdMessage(tried), 429)")
    })

    it("says a refusal in the page's language, by its code", async () => {
        const { emailCodeRefusal } = await import("@/lib/sign-in-form")
        expect(emailCodeRefusal("WRONG_PASSWORD")).toBe("error_invalid_credentials")
        expect(emailCodeRefusal("NO_EMAIL_CODES")).toBe("sign_in_email_code_unavailable")
        expect(emailCodeRefusal("TOO_MANY_CODES")).toBe("security_code_too_many")
        expect(emailCodeRefusal("toString")).toBeNull()
        expect(emailCodeRefusal(undefined)).toBeNull()
        expect(PAGE()).toMatch(/const key = emailCodeRefusal\(data\.code\)\s*setError\(key \? t\(key\) : apiErrorText\(text, t\('sign_in_failed'\)\)\)/)
    })

    // Turned busy, Send a new code lost the focus, which was left on the page
    // (browser flows, the sign-in page's part 2).
    it("says so when a new one is sent, and asks for it, the focus on the code", () => {
        expect(PAGE()).toMatch(/if \(stage === 'email'\) \{\s*setNotice\(t\('sign_in_email_code_sent'\)\)\s*focusNext\('input\[name="code"\]'\)/)
    })
})

describe("the page", () => {
    it("opens on signing in, on the building blocks", async () => {
        const { default: LoginPage } = await import("@/app/(auth)/login/page")
        const html = render(h(LoginPage))
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.sign_in_title)}</h1>`)
        expect(html).toContain(`>${esc(en.sign_in_identifier)}</label>`)
        expect(html).toContain('<footer class="ui-signin-foot">')
    })

    it("names each step and what to type at the code", () => {
        expect(PAGE()).toContain("<SignInScreen title={t('sign_in_title')}>")
        expect(PAGE()).toContain("<SignInScreen title={t('sign_in_code_title')} subtitle={t(stage === 'app' ? 'sign_in_code_app_hint' : 'sign_in_code_email_hint')}>")
        // Remounted for each, so its code field takes the focus again.
        expect(PAGE()).toContain("<CodeStep key={stage}")
    })

    // Ticked at a code, then Back to sign in and another account without
    // two-factor, the device was trusted for that one, which took no code
    // (found reading the code).
    it("trusts the device only at the end of a sign-in that took a code", () => {
        expect(PAGE()).toMatch(/const finishLogin = async \(trustDevice: boolean\) => \{\s*if \(trustDevice\) \{/)
        expect(PAGE()).toMatch(/\} else if \(res\?\.ok\) \{\s*await finishLogin\(false\)/)
        expect(PAGE()).toMatch(/if \(res\?\.ok\) \{\s*await finishLogin\(rememberDevice\)/)
        expect(PAGE().match(/finishLogin\(/g)).toHaveLength(2)
    })

    it("readies the password to type again after a wrong one, where the focus was lost", () => {
        expect(PAGE()).toMatch(/if \(key === 'error_invalid_credentials'\) \{[^}]*select\(\)/)
    })

    it("says a failure nothing answered for in the page's language, with its reference", () => {
        expect(PAGE()).toContain("setError(ref ? t('sign_in_failed_ref').replace('{ref}', ref) : t('sign_in_failed'))")
        expect(PAGE()).not.toContain("friendlyErrorMessage")
        expect(en.sign_in_failed_ref).toContain("{ref}")
    })
})

describe("the words", () => {
    const keys = [
        "sign_in_title", "sign_in", "sign_in_identifier_needed", "sign_in_password_needed", "sign_in_forgot", "stay_signed_in",
        "sign_in_code_title", "sign_in_code_app_hint", "sign_in_code_email_hint", "sign_in_code", "sign_in_code_spam",
        "sign_in_remember_device", "sign_in_verify", "sign_in_email_code", "sign_in_email_code_again", "sign_in_email_code_sent",
        "sign_in_use_app", "sign_in_back", "sign_in_email_code_wrong", "sign_in_email_code_unavailable", "sign_in_failed", "sign_in_failed_ref",
    ] as const

    it("are in both languages, in sentence case, with an ellipsis where one is meant", () => {
        for (const key of keys) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(en[key], key).not.toContain("...")
            expect(ar[key], key).not.toContain("...")
        }
        expect(en.sign_in_code_title).toBe("Confirm it's you")
        expect(en.sign_in_back).toBe("Back to sign in")
    })

    // The app never speaks as "we": it says what was done, as "Couldn't load
    // your trusted devices" does (web interface audit).
    it("speak to the reader, never as \"we\"", () => {
        for (const key of keys) expect(en[key], key).not.toMatch(/\bwe\b/i)
    })

    it("ask nothing of anyone in the masculine, in Arabic", () => {
        // As words of their own: "المحاولة" asks nothing, "حاول" does.
        for (const key of keys) {
            for (const word of ["أدخل", "تحقق", "قم", "اختر", "انتظر", "حاول", "تذكر", "تأكد"]) {
                expect(ar[key], `${key}: ${word}`).not.toMatch(new RegExp(`(^|[\\s،.؟])${word}([\\s،.؟]|$)`))
            }
        }
        expect(ar.stay_signed_in).toBe("إبقاء تسجيل الدخول")
        expect(ar.sign_in_verify).toBe("التحقق")
    })

    it("write their numbers in Arabic's digits", () => {
        for (const key of keys) expect(ar[key], key).not.toMatch(/[0-9]/)
        expect(ar.sign_in_remember_device).toContain("٣٠")
        expect(ar.sign_in_code_app_hint).toContain("٦")
    })

    it("leave the old ones behind", () => {
        for (const key of ["welcome_back", "sign_in_subtitle", "sign_in_identifier_placeholder", "signing_in", "error_invalid_code"]) {
            expect(key in en, key).toBe(false)
            expect(key in ar, key).toBe(false)
        }
    })
})
