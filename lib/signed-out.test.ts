import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Two leftovers from a new password ending sessions (PR 228, PR 229):
 *
 * - Save on the Change password page did nothing to the session when it was
 *   pressed before the page had loaded it: next-auth's update() does nothing
 *   then, so the token still said the password had to be changed, and the
 *   page came back, though it had been.
 * - A browser the server signed out, its session ended, came back to sign in
 *   with nothing said (DESIGN.md §5.5, Sign-in).
 */

const SECRET = "signed-out-test-secret-0123456789abcdef"
vi.stubEnv("NEXTAUTH_SECRET", SECRET)

const state = { locale: "en" as "en" | "ar", search: "", session: null as any }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }),
}))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(state.search), useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))

const db = { users: {} as Record<string, any>, superAdmins: {} as Record<string, any> }
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: { findUnique: async ({ where }: any) => db.users[where.id] ?? null },
        superAdmin: { findUnique: async ({ where }: any) => db.superAdmins[where.id] ?? null },
        systemSettings: { findUnique: async () => null },
    },
}))

const source = (path: string) => readFileSync(path, "utf8")
beforeEach(() => { state.locale = "en"; state.search = ""; state.session = null; db.users = {}; db.superAdmins = {} })

describe("Save on the Change password page, pressed before the page has loaded its session", () => {
    const PAGE = () => source("app/(dashboard)/dashboard/change-password/page.tsx")

    it("asks the server for the session's new state itself, not through the session hook's update()", () => {
        expect(PAGE()).not.toMatch(/\bupdate\(/)
        expect(PAGE()).not.toContain("useSession")
        expect(PAGE()).toContain("await refreshSession({ mustChangePassword: false })")
        expect(PAGE().indexOf("await refreshSession(")).toBeLessThan(PAGE().indexOf("window.location.replace('/dashboard')"))
    })

    it("is sent whether or not the page's session has loaded, as next-auth's update() would send it", async () => {
        const { refreshSession } = await import("@/lib/refresh-session")
        const sent: { url: string; init: RequestInit }[] = []
        vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
            sent.push({ url, init })
            if (url.endsWith("/api/auth/csrf")) return new Response(JSON.stringify({ csrfToken: "the-token" }), { status: 200, headers: { "Content-Type": "application/json" } })
            return new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200, headers: { "Content-Type": "application/json" } })
        })
        try {
            expect(await refreshSession({ mustChangePassword: false })).toBe(true)
            const update = sent.find(s => s.url.endsWith("/api/auth/session"))!
            expect(update.init.method).toBe("POST")
            expect(JSON.parse(String(update.init.body))).toEqual({ csrfToken: "the-token", data: { mustChangePassword: false } })
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it("says no when the server doesn't take it", async () => {
        const { refreshSession } = await import("@/lib/refresh-session")
        vi.stubGlobal("fetch", async (url: string) => url.endsWith("/api/auth/csrf")
            ? new Response(JSON.stringify({ csrfToken: "t" }), { status: 200, headers: { "Content-Type": "application/json" } })
            : new Response("", { status: 500 }))
        try {
            expect(await refreshSession({ mustChangePassword: false })).toBe(false)
            vi.stubGlobal("fetch", async () => { throw new TypeError("Failed to fetch") })
            expect(await refreshSession({ mustChangePassword: false })).toBe(false)
        } finally {
            vi.unstubAllGlobals()
        }
    })

    // And should the session be left saying so anyway, the minute's check
    // catches it up with the account, as it does the rest (lib/auth.ts).
    it("leaves a session that still says so caught up at its next check", async () => {
        const { authOptions } = await import("@/lib/auth")
        const { CATALOGUE_VERSION } = await import("@/lib/permissions/catalogue")
        const jwt = (token: any) => authOptions.callbacks!.jwt!({ token } as any) as Promise<any>
        const due = (token: Record<string, unknown>) => ({ sid: "mine", sessionVersion: 0, checkedAt: 0, grants: "", catalogue: CATALOGUE_VERSION, ...token })
        db.users.u1 = { sessionVersion: 0, keptSession: null, status: "ACTIVE", role: "EMPLOYEE", roleId: null, assignedRole: null, actingUntil: null, company: null, emailVerifiedAt: new Date(), mfaEnabled: false, mustChangePassword: false }
        expect((await jwt(due({ sub: "u1", role: "EMPLOYEE", mustChangePassword: true }))).mustChangePassword).toBe(false)
        db.superAdmins.sa1 = { sessionVersion: 0, keptSession: null, isProtected: false, emailVerifiedAt: new Date(), mfaEnabled: true, mustChangePassword: false }
        expect((await jwt(due({ sub: "sa1", role: "SUPER_ADMIN", mustChangePassword: true }))).mustChangePassword).toBe(false)
        // Not before the check is due.
        expect((await jwt(due({ sub: "u1", role: "EMPLOYEE", mustChangePassword: true, checkedAt: Date.now() }))).mustChangePassword).toBe(true)
    })
})

describe("a browser the server signed out", () => {
    it("goes to sign in by an address that says so, from a page", async () => {
        const { SESSION_ENDED_SIGN_IN } = await import("@/lib/session-ended")
        expect(SESSION_ENDED_SIGN_IN).toBe("/login?session=ended")
        const { GET } = await import("@/app/api/auth/ended/route")
        const { NextRequest } = await import("next/server")
        const res = await GET(new NextRequest("https://nizmo.test/api/auth/ended", { headers: { cookie: "next-auth.session-token=a" } }))
        expect(res.headers.get("location")).toBe("https://nizmo.test/login?session=ended")
    })

    it("and from a request of its own the server refused", () => {
        const interceptor = source("components/AuthInterceptor.tsx")
        expect(interceptor).toContain("signOut({ callbackUrl: SESSION_ENDED_SIGN_IN })")
        expect(interceptor).not.toContain("callbackUrl: '/login'")
    })

    it("but not when the person signs out themselves, nor when suspended, which says so on its own screen", () => {
        expect(source("components/DashboardHeader.tsx")).not.toContain("SESSION_ENDED_SIGN_IN")
        expect(source("components/UserHeartbeat.tsx")).not.toContain("SESSION_ENDED_SIGN_IN")
    })
})

describe("the sign-in page, for a browser the server signed out", () => {
    const message = async (props: Record<string, unknown>) => {
        const { SignInMessage } = await import("@/components/sign-in/SignInMessage")
        return renderToStaticMarkup(h(SignInMessage, { hold: null, error: "", notice: "", onHoldOver: () => {}, ...props } as never))
    }

    it("says its session ended, above the primary button, as a note screen readers hear, in the page's language", async () => {
        state.search = "session=ended"
        expect(await message({ untouched: true })).toBe(`<p class="ui-hint" role="status">${en.sign_in_session_ended}</p>`)
        state.locale = "ar"
        expect(await message({ untouched: true })).toBe(`<p class="ui-hint" role="status">${ar.sign_in_session_ended}</p>`)
    })

    it("says nothing at an ordinary sign-in", async () => {
        expect(await message({ untouched: true })).toBe("")
        state.search = "callbackUrl=%2Fdashboard"
        expect(await message({ untouched: true })).toBe("")
    })

    it("until something else is said there, or anything is sent", async () => {
        state.search = "session=ended"
        expect(await message({ untouched: true, error: "Wrong password" })).toBe(`<p class="ui-error" role="alert">Wrong password</p>`)
        expect(await message({ untouched: true, notice: "Code sent" })).toBe(`<p class="ui-hint" role="status">Code sent</p>`)
        expect(await message({ untouched: false })).toBe("")
        expect(await message({})).toBe("")
    })

    it("is told until it sends anything, and the page renders without waiting for the address", () => {
        const page = source("app/(auth)/login/page.tsx")
        expect(page).toContain("untouched={!sent}")
        const clear = page.slice(page.indexOf("const clearMessages"), page.indexOf("}", page.indexOf("const clearMessages")))
        expect(clear).toContain("setSent(true)")
        expect(page).not.toContain("useSearchParams")
        // Read where it's said, behind its own Suspense, so the sign-in card is
        // still in the first HTML (next/navigation's useSearchParams).
        const note = source("components/sign-in/SignInMessage.tsx")
        expect(note).toMatch(/<Suspense fallback=\{null\}><SessionEndedNote \/><\/Suspense>/)
    })
})

describe("its words", () => {
    it("are in both languages, asking nothing in the masculine", () => {
        expect(en.sign_in_session_ended).toBe("You were signed out because your session ended, as it does when your password or your role changes. Please sign in again.")
        expect(ar.sign_in_session_ended).toBe("تم تسجيل الخروج لانتهاء الجلسة، كما يحدث عند تغيير كلمة المرور أو الدور. يُرجى تسجيل الدخول مرة أخرى.")
        expect(ar.sign_in_session_ended).not.toMatch(/(^|\s)(أدخل|اختر|حاول|اكتب|انسخ|تحقق|انتظر|اطلب|سجّل|سجل)(\s|$)|هل أنت متأكد|هل تريد/)
    })
})
