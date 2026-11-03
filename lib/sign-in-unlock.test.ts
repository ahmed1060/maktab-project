import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { AUDIT_ACTIONS } from "./audit-codes"

/**
 * Unlocking somebody's sign-in (decided 2026-11-03): the lock is the
 * account's, so a Super Admin, or a company's Admin for their own people, can
 * lift it, where nobody could and it was the address's anyway.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))

const read = (path: string) => readFileSync(path, "utf8")
const ROUTE = "app/api/users/[id]/unlock-sign-in/route.ts"

beforeEach(() => { state.locale = "en" })

describe("unlocking somebody's sign-in", () => {
    it("is for whoever may reset their password, in their own company, and is recorded", () => {
        const src = read(ROUTE)
        expect(src).toContain(`can(session.user, "employees.reset_password")`)
        expect(src).toContain(`verifyResourceAccess(session, id, 'USER')`)
        expect(src).toContain("await unlockSignIn(id)")
        expect(src).toContain("AuditLogService.log('UNLOCK_SIGN_IN', 'USER', id,")
        expect(AUDIT_ACTIONS).toContain("UNLOCK_SIGN_IN")
        expect(en.audit_action_UNLOCK_SIGN_IN).toBeTruthy()
        expect(ar.audit_action_UNLOCK_SIGN_IN).toBeTruthy()
    })

    it("is shown in the people list to whoever may unlock, with when it lifts on its own", () => {
        const src = read("app/api/users/route.ts")
        expect(src).toContain(`can(session.user, "employees.reset_password") ? await lockedUntil(users.map(u => u.id)) : null`)
        expect(src).toContain("signInLockedUntil: locks?.get(user.id)?.toISOString() ?? null")
    })

    it("is offered on Employees and on All users, beside the person's status", () => {
        for (const path of ["app/(dashboard)/dashboard/employees/page.tsx", "app/(dashboard)/dashboard/all-users/page.tsx"]) {
            expect(read(path), path).toContain("<SignInLock ")
        }
    })

    it("sweeps the counts whose window has passed, daily, as every email typed has one", () => {
        expect(read("app/api/cron/prune/route.ts")).toContain("sweepExpiredCounts()")
    })

    it("says on the sign-in page that it's the account that's locked, and how it's lifted", () => {
        expect(en.error_too_many_attempts).not.toContain("network")
        expect(en.error_too_many_attempts).toContain("account")
        expect(ar.error_too_many_attempts).not.toContain("الشبكة")
    })

    it("says so in Arabic without telling a man or a woman what to do (found in the browser, PR 183)", () => {
        // انتظر and اطلب are said to a man; the lock lifting on its own, or
        // being lifted by the company's Admin, is said to anybody.
        for (const word of ["انتظر", "اطلب"]) expect(ar.error_too_many_attempts).not.toContain(word)
        expect(en.error_too_many_attempts).toContain("15 minutes")
        expect(ar.error_too_many_attempts).toContain("١٥ دقيقة")
    })
})

describe("the lock beside somebody's status", () => {
    it("says until when, in the language's own time, and offers Unlock named for the person", async () => {
        const { SignInLock } = await import("@/components/SignInLock")
        const until = "2026-11-03T17:05:00.000Z"
        const html = renderToStaticMarkup(h(SignInLock, { personId: "u1", name: "Mona Adel", until, onUnlocked: () => {} }))
        const time = new Date(until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
        expect(html).toContain(en.sign_in_locked_until.replace("{time}", time))
        expect(html).toContain(`aria-label="${en.sign_in_unlock_for.replace("{name}", "Mona Adel")}"`)
        expect(html).toContain(`>${en.sign_in_unlock}</button>`)
        state.locale = "ar"
        const arTime = new Date(until).toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
        expect(renderToStaticMarkup(h(SignInLock, { personId: "u1", name: "Mona Adel", until, onUnlocked: () => {} }))).toContain(ar.sign_in_locked_until.replace("{time}", arTime))
    })

    it("shows nothing for somebody who isn't locked", async () => {
        const { SignInLock } = await import("@/components/SignInLock")
        expect(renderToStaticMarkup(h(SignInLock, { personId: "u1", name: "Mona Adel", until: null, onUnlocked: () => {} }))).toBe("")
    })

    it("has its words in both languages", () => {
        for (const key of ["sign_in_locked_until", "sign_in_unlock", "sign_in_unlock_for", "sign_in_unlocked"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })
})
