import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Unlocking somebody's password tries (decided 2026-11-08): five wrong tries at
 * one's own password pause it for fifteen minutes (PR 229, lib/own-password.ts),
 * profile saves and an Admin's temporary passwords with it. Unlock, beside
 * the person's status, lifts it as it lifts a sign-in lock: for whoever may
 * reset their password, a Super Admin anywhere and a company's Admin for their
 * own people, never one's own.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))

const read = (path: string) => readFileSync(path, "utf8")
const ROUTE = "app/api/users/[id]/unlock-sign-in/route.ts"
beforeEach(() => { state.locale = "en" })

describe("Unlock lifts the password tries too", () => {
    it("with the sign-in lock, after the check that it isn't one's own", () => {
        const src = read(ROUTE)
        expect(src).toContain("await unpauseOwnPassword(id)")
        expect(src.indexOf("if (id === session.user.id)")).toBeLessThan(src.indexOf("await unpauseOwnPassword(id)"))
        expect(src.indexOf("verifyResourceAccess(session, id, 'USER')")).toBeLessThan(src.indexOf("await unpauseOwnPassword(id)"))
    })

    it("is recorded as lifting both", () => {
        expect(en.audit_action_UNLOCK_SIGN_IN).toBe("Unlocked sign-in and password tries")
        expect(ar.audit_action_UNLOCK_SIGN_IN).toBe("فتح تسجيل الدخول ومحاولات كلمة المرور")
    })

    it("is shown in the people list to whoever may unlock, with when it lifts on its own", () => {
        const src = read("app/api/users/route.ts")
        expect(src).toContain(`can(session.user, "employees.reset_password") ? await ownPasswordPausedUntil(users.map(u => u.id)) : null`)
        expect(src).toContain("ownPasswordPausedUntil: paused?.get(user.id)?.toISOString() ?? null")
    })

    it("is offered on Employees and on All users, for either", () => {
        for (const path of ["app/(dashboard)/dashboard/employees/page.tsx", "app/(dashboard)/dashboard/all-users/page.tsx"]) {
            const src = read(path)
            expect(src, path).toMatch(/<SignInLock [^>]*paused=\{\w+\.ownPasswordPausedUntil\}/)
            expect(src, path).toMatch(/\.\.\.\(\w+\.signInLockedUntil \|\| \w+\.ownPasswordPausedUntil \? \[/)
        }
    })
})

describe("the lock beside somebody's status, for their password tries", () => {
    const until = "2026-11-08T19:05:00.000Z"
    const time = (locale: string) => new Date(until).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })

    it("says until when their password tries are paused, and offers Unlock named for them", async () => {
        const { SignInLock } = await import("@/components/SignInLock")
        const html = renderToStaticMarkup(h(SignInLock, { personId: "u1", name: "Mona Adel", until: null, paused: until, onUnlocked: () => {} }))
        expect(html).toContain(en.own_password_paused_until.replace("{time}", time("en-GB")))
        expect(html).not.toContain(en.sign_in_locked_until.replace("{time}", time("en-GB")))
        expect(html).toContain(`aria-label="${en.own_password_unlock_for.replace("{name}", "Mona Adel")}"`)
        expect(html).toContain(`>${en.sign_in_unlock}</button>`)
        state.locale = "ar"
        expect(renderToStaticMarkup(h(SignInLock, { personId: "u1", name: "Mona Adel", until: null, paused: until, onUnlocked: () => {} })))
            .toContain(ar.own_password_paused_until.replace("{time}", time("ar-EG")))
    })

    it("says the sign-in lock where both are, which Unlock lifts with the other", async () => {
        const { SignInLock } = await import("@/components/SignInLock")
        const html = renderToStaticMarkup(h(SignInLock, { personId: "u1", name: "Mona Adel", until, paused: until, onUnlocked: () => {} }))
        expect(html).toContain(en.sign_in_locked_until.replace("{time}", time("en-GB")))
        expect(html).not.toContain(en.own_password_paused_until.replace("{time}", time("en-GB")))
    })

    it("shows nothing for somebody who's neither", async () => {
        const { SignInLock } = await import("@/components/SignInLock")
        expect(renderToStaticMarkup(h(SignInLock, { personId: "u1", name: "Mona Adel", until: null, paused: null, onUnlocked: () => {} }))).toBe("")
    })

    it("says what Unlock did, for their password tries", () => {
        const src = read("components/SignInLock.tsx")
        expect(src).toContain("t(lockedOut ? 'sign_in_unlocked' : 'own_password_unlocked').replace('{name}', name)")
    })
})

describe("its words", () => {
    it("are in both languages, asking nothing in the masculine", () => {
        for (const key of ["own_password_paused_until", "own_password_unlock_for", "own_password_unlocked"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
            expect(ar[key], key).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق|انتظر|اطلب)(\s|$)/)
        }
    })

    it("say, at too many tries, that the company's Admin can unlock it now, as signing in does", () => {
        expect(en.own_password_tries).toBe("Too many wrong tries for this account. You can try again within 15 minutes, or your company's Admin can unlock it now.")
        expect(ar.own_password_tries).toBe("محاولات خاطئة كثيرة لهذا الحساب. يمكن المحاولة مرة أخرى خلال ١٥ دقيقة، أو يمكن لمسؤول الشركة فتحه الآن.")
        expect(read("lib/own-password.ts")).toContain(`export const OWN_PASSWORD_TRIES = "${en.own_password_tries}"`)
    })
})
