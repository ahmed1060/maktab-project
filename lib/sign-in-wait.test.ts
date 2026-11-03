import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { waitOf, waitText } from "./login-errors"
import { holdMessage } from "./sign-in-lock"

/**
 * The 30 seconds after five wrong tries, and the fifteen minutes after ten,
 * counted down on the sign-in page as they pass (decided 2026-11-03), where
 * it said "30 seconds" or "within 15 minutes" and left it to them to count.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
beforeEach(() => { state.locale = "en" })

const read = (path: string) => readFileSync(path, "utf8")

describe("how long is left, from the server", () => {
    it("is said in seconds, counted on the server, so a phone's clock being off doesn't matter", () => {
        const now = new Date("2026-11-03T12:00:00Z")
        const paused = holdMessage({ kind: "pause", until: new Date(now.getTime() + 27_400) }, now)
        expect(paused).toContain("Sign-in paused")
        expect(waitOf(paused)).toEqual({ kind: "pause", seconds: 28 })
        const locked = holdMessage({ kind: "lock", until: new Date(now.getTime() + 15 * 60_000) }, now)
        expect(locked).toContain("Too many login attempts")
        expect(waitOf(locked)).toEqual({ kind: "lock", seconds: 900 })
    })

    it("is said the same way by sign-in and by \"email me a code instead\"", () => {
        expect(read("lib/auth.ts")).toContain("throw new Error(holdMessage(tried))")
        expect(read("app/api/auth/mfa-recovery/request/route.ts")).toContain("ApiResponse.error(holdMessage(tried), 429)")
    })

    it("is nothing for any other error", () => {
        expect(waitOf("CredentialsSignin")).toBeNull()
        expect(waitOf("INVALID_MFA_CODE")).toBeNull()
        expect(waitOf(undefined)).toBeNull()
    })
})

describe("the time left, as the page shows it", () => {
    it("is minutes and seconds, in the language's digits", () => {
        expect(waitText(27_000, "en")).toBe("0:27")
        expect(waitText(14 * 60_000 + 32_000, "en")).toBe("14:32")
        expect(waitText(900_000, "en")).toBe("15:00")
        expect(waitText(27_000, "ar")).toBe("٠:٢٧")
        // Part of a second still to go is a second, so it never shows 0:00 while it's still on.
        expect(waitText(400, "en")).toBe("0:01")
        expect(waitText(0, "en")).toBe("0:00")
    })
})

describe("the count down on the sign-in page", () => {
    it("says how long is left, as a timer a screen reader doesn't read out every second", async () => {
        const { SignInWait } = await import("@/components/SignInWait")
        const html = renderToStaticMarkup(h(SignInWait, { kind: "pause", until: Date.now() + 30_000, onOver: () => {} }))
        const [before] = en.sign_in_paused_wait.split("{time}")
        expect(html).toContain(before)
        expect(html).toMatch(/<span role="timer" aria-live="off">0:(30|29)<\/span>/)
        const locked = renderToStaticMarkup(h(SignInWait, { kind: "lock", until: Date.now() + 15 * 60_000, onOver: () => {} }))
        expect(locked).toContain(en.sign_in_locked_wait.split("{time}")[0])
        expect(locked).toMatch(/>1[45]:\d\d<\/span>/)
        state.locale = "ar"
        expect(renderToStaticMarkup(h(SignInWait, { kind: "pause", until: Date.now() + 30_000, onOver: () => {} }))).toContain(ar.sign_in_paused_wait.split("{time}")[0])
    })

    it("is used for both steps and for \"email me a code instead\", and says when it's over", () => {
        const src = read("app/(auth)/login/page.tsx")
        for (const call of ["held(res.error)", "held(res?.error)", "held(data.error)"]) expect(src, call).toContain(call)
        expect(src).toContain("<SignInWait ")
        expect(src).toContain("setNotice(t('sign_in_wait_over'))")
    })

    it("has its words in both languages, said to anybody", () => {
        for (const key of ["sign_in_paused_wait", "sign_in_locked_wait", "sign_in_wait_over"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            for (const word of ["انتظر", "اطلب", "حاول "]) expect(ar[key], key).not.toContain(word)
        }
        expect(en.sign_in_paused_wait).toContain("{time}")
        expect(en.sign_in_locked_wait).toContain("{time}")
        expect(ar.sign_in_paused_wait).toContain("{time}")
        expect(ar.sign_in_locked_wait).toContain("{time}")
    })
})
