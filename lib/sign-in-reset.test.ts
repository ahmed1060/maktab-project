import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * The sign-in page, part 2 (UI_PLAN.md §5 step 5, the pages left): Forgot
 * your password, two steps in the sign-in card (DESIGN.md §5.5, Sign-in).
 * It was a form of its own making, its words typed into the page in both
 * languages, its mistakes said at the top of the card in English, too many
 * tries a time to try again at in the server's own time zone, and once
 * reset it went back to signing in without a word.
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
// Loaded once, first: compiled cold, the steps take longer than a test may.
beforeAll(async () => {
    await import("@/components/sign-in/ResetPassword")
}, 60_000)

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const re = (text: string) => esc(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const render = (node: ReactNode) => renderToStaticMarkup(node as never)
const source = (path: string) => readFileSync(path, "utf8")
const RESET = () => source("components/sign-in/ResetPassword.tsx")
const PAGE = () => source("app/(auth)/login/page.tsx")

/** A field by its label, up to its end: its control, and its hint or its error. */
function field(html: string, label: string): string {
    const at = html.indexOf(`>${esc(label)}</label>`)
    expect(at, `no field labelled ${label}`).toBeGreaterThan(-1)
    const start = html.lastIndexOf('<div class="ui-field">', at)
    return html.slice(start, html.indexOf("</div>", at) + 6)
}
const input = (chunk: string) => chunk.match(/<input[^>]*>/)?.[0] ?? ""
/** The step's own buttons, as [kind, words]: not a password's eye button. */
const actions = (html: string) => [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/g)]
    .filter(m => m[1].includes("ui-btn"))
    .map(m => [m[1].match(/ui-btn-(\w+)/)?.[1], m[2].replace(/<[^>]+>/g, "")])

const emailStep = async (over: Record<string, unknown> = {}) => {
    const { ResetEmailStep } = await import("@/components/sign-in/ResetPassword")
    return render(h(ResetEmailStep, { email: "", error: undefined, message: null, busy: false, onEmail: () => {}, onSubmit: () => {}, onBack: () => {}, ...over } as never))
}
const codeStep = async (over: Record<string, unknown> = {}) => {
    const { ResetCodeStep } = await import("@/components/sign-in/ResetPassword")
    return render(h(ResetCodeStep, {
        code: "", newPassword: "", confirmPassword: "", errors: {}, message: null, busy: false, sending: false,
        onCode: () => {}, onNewPassword: () => {}, onConfirmPassword: () => {}, onSubmit: () => {}, onSendAgain: () => {}, onOtherEmail: () => {}, onBack: () => {},
        ...over,
    } as never))
}

describe("Forgot your password's first step", () => {
    it("asks for the account's email, focused, written left to right, its label saying what it is", async () => {
        const email = input(field(await emailStep({ email: "laila@example.com" }), en.email))
        for (const attr of ['name="email"', 'type="email"', 'dir="ltr"', 'autoComplete="username"', 'spellCheck="false"', 'autoCapitalize="none"', 'maxLength="254"', 'autofocus=""', 'value="laila@example.com"']) {
            expect(email, attr).toContain(attr)
        }
        expect(email).not.toContain("placeholder")
    })

    it("has Send code as its one primary button, busy while it sends, and Back to sign in quiet under it", async () => {
        expect(actions(await emailStep())).toEqual([["primary", en.forgot_send], ["quiet", en.sign_in_back]])
        expect((await emailStep({ busy: true })).match(/<button type="submit"[^>]*>/)?.[0]).toContain('aria-busy="true"')
    })

    it("says what's wrong with the email under it", async () => {
        const chunk = field(await emailStep({ error: en.security_email_invalid }), en.email)
        expect(input(chunk)).toContain('aria-invalid="true"')
        expect(chunk).toMatch(new RegExp(`<span id="[^"]+-error" class="ui-error">${re(en.security_email_invalid)}</span></div>$`))
    })

    it("says the server's answer above Send code", async () => {
        const html = await emailStep({ message: h("p", { className: "ui-error", role: "alert" }, "No") })
        expect(html).toContain(`<div class="ui-signin-actions"><p class="ui-error" role="alert">No</p><button type="submit"`)
    })
})

describe("its second step", () => {
    it("asks for the code sent, focused, its six digits left to right, with where it may be", async () => {
        const chunk = field(await codeStep(), en.sign_in_code)
        for (const attr of ['name="code"', 'inputMode="numeric"', 'autoComplete="one-time-code"', 'maxLength="6"', 'spellCheck="false"', 'dir="ltr"', 'autofocus=""']) {
            expect(input(chunk), attr).toContain(attr)
        }
        expect(chunk).toMatch(new RegExp(`<span id="[^"]+-hint" class="ui-hint">${re(en.sign_in_code_spam)}</span></div>$`))
    })

    it("asks for the new password twice, as Change password does, its hint saying how long it must be", async () => {
        const html = await codeStep()
        const first = field(html, en.change_password_new)
        for (const attr of ['type="password"', 'name="newPassword"', 'autoComplete="new-password"', 'maxLength="72"']) expect(input(first), attr).toContain(attr)
        expect(first).toContain(`aria-label="${esc(en.show_password)}"`)
        expect(first).toMatch(new RegExp(`<span id="[^"]+-hint" class="ui-hint">${re(en.change_password_new_hint)}</span></div>$`))
        const again = field(html, en.change_password_confirm)
        for (const attr of ['type="password"', 'name="confirmPassword"', 'autoComplete="new-password"', 'maxLength="72"']) expect(input(again), attr).toContain(attr)
        expect(again).not.toContain("ui-hint")
    })

    it("has Save new password as its one primary button, and the others quiet under it", async () => {
        expect(actions(await codeStep())).toEqual([
            ["primary", en.change_password_save], ["quiet", en.sign_in_email_code_again], ["quiet", en.forgot_other_email], ["quiet", en.sign_in_back],
        ])
        expect((await codeStep({ busy: true })).match(/<button type="submit"[^>]*>/)?.[0]).toContain('aria-busy="true"')
        expect((await codeStep({ sending: true })).match(new RegExp(`<button[^>]*>${re(en.sign_in_email_code_again)}`))?.[0]).toContain('aria-busy="true"')
    })

    it("says what's wrong under each field", async () => {
        const html = await codeStep({ errors: { code: en.sign_in_email_code_wrong, newPassword: en.change_password_short, confirmPassword: en.change_password_mismatch } })
        for (const [label, error] of [[en.sign_in_code, en.sign_in_email_code_wrong], [en.change_password_new, en.change_password_short], [en.change_password_confirm, en.change_password_mismatch]]) {
            const chunk = field(html, label)
            expect(input(chunk), label).toContain('aria-invalid="true"')
            expect(chunk, label).toMatch(new RegExp(`<span id="[^"]+-error" class="ui-error">${re(error)}</span></div>$`))
        }
    })

    it("says the server's answer above Save new password", async () => {
        const html = await codeStep({ message: h("p", { className: "ui-error", role: "alert" }, "No") })
        expect(html).toContain(`<div class="ui-signin-actions"><p class="ui-error" role="alert">No</p><button type="submit"`)
    })

    it("names the email the code was sent to, as typed, if it's on an account", async () => {
        const { ResetSentTo } = await import("@/components/sign-in/ResetPassword")
        const [before, after] = en.forgot_code_hint.split("{email}")
        expect(render(h(ResetSentTo, { email: "laila@example.com" }))).toBe(`${esc(before)}<bdi>laila@example.com</bdi>${esc(after)}`)
        // Written left to right in the Arabic sentence, as an email is.
        state.locale = "ar"
        const [start, end] = ar.forgot_code_hint.split("{email}")
        expect(render(h(ResetSentTo, { email: "laila@example.com" }))).toBe(`${esc(start)}<bdi>laila@example.com</bdi>${esc(end)}`)
    })
})

describe("Forgot your password, as a whole", () => {
    it("opens on the email, filled in from the one typed at signing in, in the sign-in card", async () => {
        const { ResetPassword } = await import("@/components/sign-in/ResetPassword")
        const html = render(h(ResetPassword, { email: "laila@example.com", onBack: () => {}, onDone: () => {} }))
        expect(html).toContain(`<h1 class="ui-page-title">${esc(en.forgot_title)}</h1><p class="ui-page-subtitle">${esc(en.forgot_email_hint)}</p>`)
        expect(input(field(html, en.email))).toContain('value="laila@example.com"')
        expect(html).toContain('<footer class="ui-signin-foot">')
    })

    it("says under its title what to type, and at the code, where it was sent", () => {
        expect(RESET()).toContain("<SignInScreen title={t('forgot_title')} subtitle={t('forgot_email_hint')}>")
        expect(RESET()).toContain("<SignInScreen title={t('forgot_title')} subtitle={<ResetSentTo email={email.trim()} />}>")
    })

    it("says what the server answered above the primary button, heard by screen readers", () => {
        expect(RESET()).toContain("<SignInMessage hold={hold} error={error} notice={notice}")
    })

    it("says a failure nothing answered for in the page's language", () => {
        expect(RESET()).toMatch(/const failed = async \(err: unknown, key: TranslationKey\) => \{\s*await reportClientError\(err, '\/login'\)\s*setError\(t\(key\)\)/)
        expect(RESET()).toContain("setError(apiErrorText(text, t(fallback)))")
    })
})

describe("what's checked before anything is sent", () => {
    it("is an email at the first step, with the focus on it", () => {
        expect(RESET()).toMatch(/const wrong = emailError\(email\)\s*if \(wrong\) \{\s*setEmailErr\(t\(wrong\)\)\s*focusFirstWrong\(form\)/)
    })

    it("is a code of six digits and the new password, as Change password checks it, at the second", async () => {
        const { resetErrors } = await import("@/lib/sign-in-form")
        expect(resetErrors({ code: "12345", newPassword: "short", confirmPassword: "other" })).toEqual({
            code: "security_email_code_invalid", newPassword: "change_password_short", confirmPassword: "change_password_mismatch",
        })
        const twelve = "a".repeat(12)
        expect(resetErrors({ code: " 123456 ", newPassword: twelve, confirmPassword: twelve })).toEqual({})
        // A password is never trimmed: spaces may be part of it.
        expect(resetErrors({ code: "123456", newPassword: " ".repeat(12), confirmPassword: " ".repeat(12) })).toEqual({})
        expect(RESET()).toMatch(/const wrong = resetErrors\(\{ code, newPassword, confirmPassword \}\)[^]{0,300}focusFirstWrong\(form\)/)
    })

    it("sends the email without spaces at its ends, as signing in does, and the new password as typed", () => {
        expect(RESET().match(/email: email\.trim\(\)/g)).toHaveLength(2)
        expect(RESET()).toContain("JSON.stringify({ email: email.trim(), code: code.trim(), newPassword })")
        expect(RESET()).not.toContain("newPassword.trim()")
    })
})

describe("the server's answers", () => {
    it("carry their codes, and never a time written on the server", () => {
        const asked = source("app/api/auth/forgot-password/request/route.ts")
        const used = source("app/api/auth/forgot-password/confirm/route.ts")
        expect(asked).toContain(`ApiResponse.refused(400, "Validation Error", "NOT_AN_EMAIL")`)
        expect(used).toContain(`ApiResponse.refused(400, "Invalid or expired code", "CODE_WRONG")`)
        for (const route of [asked, used]) {
            expect(route).toContain("if (limited) return resetHeldBack(resetAt)")
            // Written on the server, the time was the server's own, and in English.
            expect(route).not.toContain("toLocaleTimeString")
        }
    })

    it("say how long is left of too many tries, in seconds counted on the server", async () => {
        const { resetHeldBack } = await import("@/lib/password-reset")
        const now = 1_700_000_000_000
        const res = resetHeldBack(now + 14 * 60_000 + 31_400, now)
        expect(res.status).toBe(429)
        expect(await res.json()).toEqual({ success: false, error: "Too many attempts. Please try again later.", code: "TOO_MANY_TRIES", wait: 872 })
        expect(await resetHeldBack(now, now).json()).toMatchObject({ wait: 1 })
    })

    it("can say more about a refusal than its code, never in place of it", async () => {
        const { ApiResponse } = await import("@/lib/api-response")
        expect(await ApiResponse.refused(429, "No", "SOME_CODE", { wait: 3, code: "OTHER", success: true }).json()).toEqual({ success: false, error: "No", code: "SOME_CODE", wait: 3 })
        expect(await ApiResponse.refused(403, "No", "SOME_CODE").json()).toEqual({ success: false, error: "No", code: "SOME_CODE" })
    })

    it("are said in the page's language, under their field or counted down", async () => {
        const { resetRefusal } = await import("@/lib/sign-in-form")
        expect(resetRefusal({ code: "NOT_AN_EMAIL" })).toEqual({ field: "email", key: "security_email_invalid" })
        expect(resetRefusal({ code: "CODE_WRONG" })).toEqual({ field: "code", key: "sign_in_email_code_wrong" })
        expect(resetRefusal({ code: "TOO_MANY_TRIES", wait: 872 })).toEqual({ wait: 872 })
        // Anything else is said as the server put it.
        expect(resetRefusal({ code: "TOO_MANY_TRIES" })).toBeNull()
        expect(resetRefusal({ code: "toString" })).toBeNull()
        expect(resetRefusal(null)).toBeNull()
    })

    it("count too many tries down, as signing in does, and say when it's over", async () => {
        expect(RESET()).toContain("setHold({ kind: 'reset', until: Date.now() + refusal.wait * 1000 })")
        expect(RESET()).toContain("setNotice(t('forgot_wait_over'))")
        const { SignInWait } = await import("@/components/SignInWait")
        const html = render(h(SignInWait, { kind: "reset", until: Date.now() + 15 * 60_000, onOver: () => {} }))
        expect(html).toContain(esc(en.forgot_wait.split("{time}")[0]))
        expect(html).toMatch(/<span role="timer" aria-live="off">1[45]:\d\d<\/span>/)
    })
})

describe("a new code", () => {
    it("is sent again from the second step, said as sent if the email is on an account, and asked for again", () => {
        expect(RESET()).toMatch(/setNotice\(t\('forgot_sent_again'\)\)\s*setCode\(''\)/)
        // Turned busy, the button lost the focus: it goes to the code.
        expect(RESET()).toContain(`document.querySelector<HTMLInputElement>('input[name="code"]')?.focus()`)
    })

    it("can go to a different email, kept as typed to put right", () => {
        expect(RESET()).toContain("onOtherEmail={() => { clearMessages(); setStep('email') }}")
    })
})

describe("the sign-in page around it", () => {
    it("carries the email typed at signing in over to it", () => {
        expect(PAGE()).toContain("<ResetPassword email={forgotEmail} onBack={resetBack} onDone={resetDone} />")
    })

    it("goes back to signing in once reset, the email filled in and the password focused, saying so", () => {
        expect(PAGE()).toMatch(/const resetDone = \(email: string\) => \{\s*setIdentifier\(email\)\s*setPassword\(''\)\s*setNotice\(t\('forgot_done'\)\)\s*setMode\('login'\)\s*focusNext\('input\[name="password"\]'\)/)
    })

    it("puts the focus back on Forgot your password? when it's left", () => {
        expect(PAGE()).toMatch(/const resetBack = \(\) => \{\s*setMode\('login'\)\s*focusNext\('\.ui-signin-forgot'\)/)
    })

    it("focuses what's next once it's on screen, after the step it's in has been put there", () => {
        expect(PAGE()).toContain("const focusNext = (selector: string) => setFocusOn(was => ({ selector, n: (was?.n ?? 0) + 1 }))")
        expect(PAGE()).toMatch(/useEffect\(\(\) => \{\s*if \(focusOn\) document\.querySelector<HTMLElement>\(focusOn\.selector\)\?\.focus\(\)\s*\}, \[focusOn\]\)/)
    })

    it("types nothing of its own into the page in either language", () => {
        expect(PAGE()).not.toContain("isAr")
        expect(PAGE()).not.toMatch(/[؀-ۿ]/)
        expect(RESET()).not.toMatch(/[؀-ۿ]/)
        for (const old of ["Reset password", "Sending...", "Invalid or expired code", "Something went wrong", "we've sent"]) expect(PAGE(), old).not.toContain(old)
    })
})

describe("the words", () => {
    const keys = [
        "forgot_title", "forgot_email_hint", "forgot_send", "forgot_code_hint", "forgot_sent_again", "forgot_other_email",
        "forgot_wait", "forgot_wait_over", "forgot_send_failed", "forgot_done",
    ] as const

    it("are in both languages, in sentence case, with their places for the email and the time", () => {
        for (const key of keys) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(en[key], key).not.toContain("...")
        }
        expect(en.forgot_title).toBe("Reset your password")
        expect(ar.forgot_title).toBe("إعادة تعيين كلمة المرور")
        expect(en.forgot_send).toBe("Send code")
        for (const dictionary of [en, ar]) {
            expect(dictionary.forgot_code_hint.split("{email}")).toHaveLength(2)
            expect(dictionary.forgot_wait.split("{time}")).toHaveLength(2)
        }
    })

    it("never say whether the email is on an account", () => {
        for (const key of ["forgot_code_hint", "forgot_sent_again"] as const) {
            expect(en[key], key).toMatch(/^If /)
            expect(ar[key], key).toMatch(/^إذا كان /)
        }
    })

    it("speak to the reader, never as \"we\"", () => {
        for (const key of keys) expect(en[key], key).not.toMatch(/\b(we|we've|our|us)\b/i)
    })

    it("ask nothing of anyone in the masculine, in Arabic", () => {
        // As words of their own: "إرسال" asks nothing, "أرسل" does.
        for (const key of keys) {
            for (const word of ["أدخل", "تحقق", "قم", "اختر", "انتظر", "حاول", "اكتب", "اطلب", "أرسل", "استخدم"]) {
                expect(ar[key], `${key}: ${word}`).not.toMatch(new RegExp(`(^|[\\s،.؟])${word}([\\s،.؟]|$)`))
            }
        }
    })

    it("write their numbers in Arabic's digits", () => {
        for (const key of keys) expect(ar[key], key).not.toMatch(/[0-9]/)
        expect(ar.forgot_code_hint).toContain("٦")
    })
})
