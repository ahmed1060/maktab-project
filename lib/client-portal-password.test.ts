import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * Change password in the client's area (CLIENT_PORTAL_PLAN.md §5.3, §12
 * step 7d-2; PR 335), as for the company's people: from the account menu, on
 * a page of the area's own, the current password and the new one twice; the
 * area's own route, which answers a wrong current password and too many
 * tries in their own words; and the session it's changed from kept, at the
 * version that ended the others. lib/client-password-change.db.test.ts has
 * the change itself, against a real Postgres.
 */

const state = {
    session: null as any,
    token: null as any,
    calls: [] as any[],
    fails: null as string | null,
    account: null as any,
    locale: "en" as "en" | "ar",
}
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("next-auth/jwt", () => ({ getToken: async () => state.token }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: { clientAccount: { findUnique: async () => state.account } },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { logSystemError: async () => "REF1", friendlyErrorMessage: (ref: string) => `Something went wrong (${ref}).` },
}))
vi.mock("@/lib/client-password-change", async importOriginal => ({
    ...(await importOriginal<typeof import("@/lib/client-password-change")>()),
    changeClientPassword: async (...args: any[]) => {
        state.calls.push(args)
        if (state.fails) throw new Error(state.fails)
    },
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({
        locale: state.locale,
        t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key,
        setLanguage: () => {},
        isChangingLocale: false,
    }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("next-auth/react", () => ({ signOut: async () => {}, useSession: () => ({ data: null }) }))
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
    usePathname: () => "/portal/password",
    useSearchParams: () => new URLSearchParams(),
    redirect: (path: string) => { throw new Error(`REDIRECT ${path}`) },
}))

const CLIENT = { id: "acct-1", role: "CLIENT_ACCOUNT", name: "Maha Adel", clientId: "client-1", clientName: "Nile Trading", companyId: "co-1" }
const PERSON = { id: "u1", role: "ADMIN", companyId: "co-1", grants: "" }
const SUPER = { id: "sa1", role: "SUPER_ADMIN" }
const NEW = "a-new-password-1"
const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { state.locale = locale; return renderToStaticMarkup(el) }
/** As React writes text into the page. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
// React writes some attributes in camel case (autoComplete, maxLength).
const input = (attrs: Record<string, string>) =>
    new RegExp(`<input${Object.entries(attrs).map(([k, v]) => `(?=[^>]*${k}="${v}")`).join("")}[^>]*>`, "i")

beforeEach(() => {
    state.session = null
    state.token = null
    state.calls = []
    state.fails = null
    state.account = null
    state.locale = "en"
})

describe("what the page sends", () => {
    const sent = async (body: unknown) => (await import("./client-password-change")).sentPasswordChange(body)

    it("the current password, and the new one twice, as typed", async () => {
        expect(await sent({ currentPassword: " old one ", newPassword: ` ${NEW} `, confirmPassword: ` ${NEW} ` })).toEqual({ current: " old one ", password: ` ${NEW} ` })
    })

    it("asks for the current password", async () => {
        for (const currentPassword of [undefined, "", 5, null]) {
            expect(await sent({ currentPassword, newPassword: NEW, confirmPassword: NEW }), String(currentPassword)).toEqual({ problem: "current" })
        }
        expect(await sent(null)).toEqual({ problem: "current" })
    })

    it("a new one of 12 to 72 characters, the same twice, as every password in Nizmo is", async () => {
        const base = { currentPassword: "old" }
        expect(await sent({ ...base, newPassword: "x".repeat(11), confirmPassword: "x".repeat(11) })).toEqual({ problem: "short" })
        expect(await sent({ ...base, newPassword: "x".repeat(12), confirmPassword: "x".repeat(12) })).toEqual({ current: "old", password: "x".repeat(12) })
        expect(await sent({ ...base, newPassword: "x".repeat(72), confirmPassword: "x".repeat(72) })).toEqual({ current: "old", password: "x".repeat(72) })
        expect(await sent({ ...base, newPassword: "x".repeat(73), confirmPassword: "x".repeat(73) })).toEqual({ problem: "long" })
        expect(await sent({ ...base, newPassword: NEW, confirmPassword: `${NEW}x` })).toEqual({ problem: "mismatch" })
        expect(await sent({ ...base, newPassword: 5, confirmPassword: 5 })).toEqual({ problem: "short" })
    })
})

describe("the area's route", () => {
    const post = async (body: unknown) => {
        const { POST } = await import("@/app/api/portal/password/route")
        const res = await POST(new Request("http://localhost/api/portal/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
        return { status: res.status, body: await res.json() }
    }
    const body = { currentPassword: "old-password-12", newPassword: NEW, confirmPassword: NEW }

    it("changes the password of the session's own account, from the session named in its cookie", async () => {
        state.session = { user: CLIENT }
        state.token = { sub: "acct-1", sid: "sid-a", sessionVersion: 2 }
        const res = await post({ ...body, id: "someone-else" })
        expect(res).toEqual({ status: 200, body: { success: true, data: { changed: true } } })
        expect(state.calls).toEqual([["acct-1", state.token, { ...body, id: "someone-else" }]])
    })

    it("is one of the area's routes alone: a person's or Super Admin's session is refused, and nothing is changed", async () => {
        for (const user of [PERSON, SUPER]) {
            state.session = { user }
            expect((await post(body)).status, user.role).toBe(403)
        }
        expect(state.calls).toEqual([])
    })

    it("says a wrong current password is wrong, by its code", async () => {
        state.session = { user: CLIENT }
        state.fails = "CURRENT_PASSWORD_WRONG"
        const { CURRENT_PASSWORD_WRONG } = await import("./own-password")
        expect(await post(body)).toEqual({ status: 403, body: { success: false, code: "CURRENT_PASSWORD_WRONG", error: CURRENT_PASSWORD_WRONG } })
    })

    it("says too many wrong tries in its own words: no one at the office can lift them for a client's person", async () => {
        state.session = { user: CLIENT }
        state.fails = "OWN_PASSWORD_TRIES"
        const res = await post(body)
        expect(res).toEqual({ status: 429, body: { success: false, code: "OWN_PASSWORD_TRIES", error: "Too many wrong tries for this account. You can try again within 15 minutes." } })
        expect(res.body.error).not.toContain("Admin")
    })

    it("answers each refusal the change throws with what it is", async () => {
        state.session = { user: CLIENT }
        const answers: Record<string, [number, string]> = {
            CURRENT_PASSWORD_MISSING: [400, "Your current password is needed to set a new one."],
            NEW_PASSWORD_SHORT: [400, "The password needs at least 12 characters."],
            NEW_PASSWORD_LONG: [400, "A password can have up to 72 characters."],
            NEW_PASSWORD_MISMATCH: [400, "The two passwords aren't the same."],
            CLIENT_ACCOUNT_GONE: [404, "This account isn't there any more."],
        }
        for (const [code, [status, error]] of Object.entries(answers)) {
            state.fails = code
            const res = await post(body)
            expect(res.status, code).toBe(status)
            expect(res.body.error, code).toBe(error)
        }
    })
})

describe("the minute's check of a client account's session", () => {
    const portal = { hasCompanyManagement: true, hasHR: false, hasClientPortal: true }
    const account = (sessionVersion: number, keptSession: string | null) => ({
        id: "acct-1", name: "Maha Adel", email: "maha@client.co", language: "en", sessionVersion, keptSession, companyId: "co-1", clientId: "client-1",
        client: { id: "client-1", name: "Nile Trading", archivedAt: null },
        company: {
            name: "Nile Works", createdAt: new Date("2026-01-01"), trialPreset: null, trialExtensionDays: 0, isBanned: false, package: portal,
            payments: [{ endDate: new Date(Date.now() + 90 * 86_400_000), graceExtensionHours: 0 }],
        },
    })
    const stands = async (token: Record<string, unknown>) => (await import("./client-sign-in")).clientSessionStands({ sub: "acct-1", ...token } as any)

    it("reads the session the account kept", async () => {
        const { CLIENT_SESSION } = await import("./client-sign-in")
        expect(CLIENT_SESSION).toMatchObject({ sessionVersion: true, keptSession: true })
    })

    it("keeps the session a new password was set from, at the version that ended the others", async () => {
        state.account = account(3, "3:sid-a")
        const token = { sid: "sid-a", sessionVersion: 2 }
        expect(await stands(token)).toBe(true)
        const caught = { sub: "acct-1", sid: "sid-a", sessionVersion: 2 } as any
        await (await import("./client-sign-in")).clientSessionStands(caught)
        expect(caught.sessionVersion).toBe(3)
    })

    it("ends every other session behind the account's version", async () => {
        state.account = account(3, "3:sid-a")
        expect(await stands({ sid: "sid-b", sessionVersion: 2 })).toBe(false)
        expect(await stands({ sessionVersion: 2 })).toBe(false)
    })

    it("ends one kept by an earlier change, once the account has moved on again", async () => {
        state.account = account(4, "3:sid-a")
        expect(await stands({ sid: "sid-a", sessionVersion: 3 })).toBe(false)
    })

    it("leaves a session at the account's version as it is", async () => {
        state.account = account(3, null)
        expect(await stands({ sid: "sid-b", sessionVersion: 3 })).toBe(true)
    })
})

describe("the page's rules, before anything is sent", () => {
    const form = async () => await import("./portal-password-form")

    it("asks for the current password, then the new one as Change password does, each under its field", async () => {
        const { portalPasswordErrors, PORTAL_PASSWORD_FIELDS } = await form()
        expect(PORTAL_PASSWORD_FIELDS).toEqual(["currentPassword", "newPassword", "confirmPassword"])
        expect(portalPasswordErrors({ currentPassword: "", newPassword: "short", confirmPassword: "other" })).toEqual({
            currentPassword: "portal_password_current_needed",
            newPassword: "change_password_short",
            confirmPassword: "change_password_mismatch",
        })
        expect(portalPasswordErrors({ currentPassword: "old", newPassword: NEW, confirmPassword: NEW })).toEqual({})
    })

    it("says the server's refusals in the page's language: a wrong current password under its field", async () => {
        const { portalPasswordRefusal } = await form()
        expect(portalPasswordRefusal({ code: "CURRENT_PASSWORD_WRONG" })).toEqual({ field: "currentPassword", key: "incorrect_password" })
        expect(portalPasswordRefusal({ code: "OWN_PASSWORD_TRIES" })).toEqual({ key: "portal_password_tries" })
        expect(portalPasswordRefusal({ code: "SOMETHING_ELSE" })).toEqual({ key: "change_password_failed" })
        expect(portalPasswordRefusal(null)).toEqual({ key: "change_password_failed" })
    })

    it("words for them in both languages, too many tries without the company's Admin", () => {
        for (const words of [en, ar]) {
            for (const key of ["portal_password_title", "portal_password_subtitle", "portal_password_current", "portal_password_current_needed", "portal_password_tries"] as const) {
                expect(words[key], key).toBeTruthy()
            }
        }
        expect(en.portal_password_tries).toBe("Too many wrong tries for this account. You can try again within 15 minutes.")
        expect(ar.portal_password_tries).not.toContain("مسؤول")
    })
})

describe("the page", () => {
    const page = async (locale: "en" | "ar" = "en") => {
        const { PortalPassword } = await import("@/components/portal/PortalPassword")
        return render(h(PortalPassword), locale)
    }

    it("is named by its page header, under a way back to Tax position, in both languages", async () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = await page(locale)
            expect(html, locale).toContain(`<h1 class="ui-page-title">${esc(words.portal_password_title)}</h1>`)
            expect(html, locale).toContain(`<p class="ui-page-subtitle">${esc(words.portal_password_subtitle)}</p>`)
            expect(html, locale).toMatch(new RegExp(`<a class="ui-back-link" href="/portal">[\\s\\S]*?${words.tax_position}</a>`))
        }
    })

    it("asks for the current password first, focused, then the new one twice with its hint", async () => {
        const html = await page()
        expect(html).toMatch(input({ name: "currentPassword", type: "password", autocomplete: "current-password" }))
        expect(html).toMatch(/<input(?=[^>]*name="currentPassword")[^>]*autofocus=""/i)
        expect(html).toMatch(input({ name: "newPassword", type: "password", autocomplete: "new-password", maxlength: "72" }))
        expect(html).toMatch(input({ name: "confirmPassword", type: "password", autocomplete: "new-password", maxlength: "72" }))
        const at = (text: string) => html.indexOf(`>${esc(text)}</label>`)
        expect(at(en.portal_password_current)).toBeGreaterThan(-1)
        expect(at(en.portal_password_current)).toBeLessThan(at(en.change_password_new))
        expect(at(en.change_password_new)).toBeLessThan(at(en.change_password_confirm))
        expect(html).toContain(esc(en.change_password_new_hint))
        expect(html).toMatch(new RegExp(`<button type="submit"[^>]*>[\\s\\S]*?${esc(en.change_password_save)}[\\s\\S]*?</button>`))
    })

    it("in Arabic too", async () => {
        const html = await page("ar")
        for (const key of ["portal_password_current", "change_password_new", "change_password_confirm", "change_password_save"] as const) expect(html, key).toContain(ar[key])
    })

    it("is on the building blocks: no styles, sides or words of its own", () => {
        const src = stripComments(readFileSync("components/portal/PortalPassword.tsx", "utf8"))
        expect(src).not.toContain("style=")
        expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
        expect(src).not.toMatch(/[؀-ۿ]/)
        expect(src).not.toMatch(/\b(left|right)\b/)
    })

    it("sends to the area's route, and goes back to Tax position saying the password was changed", () => {
        const src = stripComments(readFileSync("components/portal/PortalPassword.tsx", "utf8"))
        expect(src).toMatch(/fetch\(['"]\/api\/portal\/password['"]/)
        expect(src).toContain("showToast(t('change_password_done'), 'success')")
        expect(src).toMatch(/router\.push\(['"]\/portal['"]\)/)
    })
})

describe("the page's address", () => {
    const open = async () => {
        const { default: Page } = await import("@/app/(portal)/portal/password/page")
        try { return render(await Page()) } catch (e) { return (e as Error).message }
    }

    it("is one of a client's people's, under the area", async () => {
        state.session = { user: CLIENT }
        expect(await open()).toContain(`<h1 class="ui-page-title">${en.portal_password_title}</h1>`)
    })

    it("sends anyone else on, and an ended session to sign in", async () => {
        state.session = { user: PERSON }
        expect(await open()).toBe("REDIRECT /dashboard")
        state.session = null
        const { SESSION_ENDED_PATH } = await import("./session-ended")
        expect(await open()).toBe(`REDIRECT ${SESSION_ENDED_PATH}`)
    })
})

describe("the account menu", () => {
    const person = { name: "Maha Adel", client: "Nile Trading" }
    const menu = async (locale: "en" | "ar" = "en") => {
        const { PortalAccountMenu } = await import("@/components/portal/PortalTopBar")
        return render(h(PortalAccountMenu, { id: "m1", person, onClose: () => {}, onSignOut: () => {}, signingOut: false }), locale)
    }

    it("has Change password after the person, then Sign out after a hairline, in both languages", async () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = await menu(locale)
            expect(html, locale).toMatch(new RegExp(
                `</div><div class="ui-menu-rule"></div><a class="ui-menu-item" href="/portal/password"><svg[^>]*>[\\s\\S]*?</svg>${words.portal_password_title}</a>` +
                `<div class="ui-menu-rule"></div><button type="button" class="ui-menu-item"`))
        }
    })

    it("closes as it's followed, as the company's people's menu items do", () => {
        const src = stripComments(readFileSync("components/portal/PortalTopBar.tsx", "utf8"))
        expect(src).toMatch(/href="\/portal\/password" onClick=\{onClose\}/)
        expect(src).toMatch(/onClose=\{\(\) => setOpen\(false\)\}/)
    })
})
