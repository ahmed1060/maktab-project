import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A page someone can't open, on the building blocks (UI_PLAN.md §5 step 5,
 * the pages left; DESIGN.md §5.5): it was a page of its own making, in
 * English only, titled "Access Restricted" under a no-entry emoji, saying
 * the same to everyone, and on the dashboard itself it sent them back to
 * the dashboard.
 */

const state = {
    locale: "en" as "en" | "ar",
    viewer: null as Record<string, unknown> | null,
    path: "/dashboard/records",
}
vi.mock("@/lib/useCan", () => ({ useViewer: () => state.viewer }))
vi.mock("next/navigation", () => ({ usePathname: () => state.path }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const SOURCE = "components/AccessDenied.tsx"
let AccessDenied: (props: { superAdmins?: boolean; notInPackage?: boolean }) => ReactElement
beforeAll(async () => { AccessDenied = (await import("@/components/AccessDenied")).default as never })
beforeEach(() => {
    state.locale = "en"
    state.viewer = { id: "u1", role: "EMPLOYEE", companyId: "c1", userStatus: "ACTIVE" }
    state.path = "/dashboard/records"
})
const render = (props: { superAdmins?: boolean; notInPackage?: boolean } = {}) => renderToStaticMarkup(h(AccessDenied, props))
/** As React writes text into the page. */
const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const words = (locale: "en" | "ar", key: keyof typeof en) => (locale === "ar" ? ar : en)[key] as string
/** The building blocks' button to the dashboard, its attributes in either order. */
const DASHBOARD_LINK = /<a (?=[^>]*href="\/dashboard")(?=[^>]*class="ui-btn )[^>]*>/

describe("A page someone can't open", () => {
    it("has nothing left of its own making: no inline styles, emoji or words typed in", () => {
        const src = readFileSync(SOURCE, "utf8")
        expect(src).not.toMatch(/style=\{/)
        expect(src).not.toMatch(/\p{Extended_Pictographic}/u)
        expect(src).not.toContain("Access Restricted")
        expect(src).not.toMatch(/btn-primary|className="btn\b/)
        expect(src).toMatch(/from ['"]@\/components\/ui['"]/)
    })

    it("says so in its page header, in the page's language", () => {
        for (const locale of ["en", "ar"] as const) {
            state.locale = locale
            const html = render()
            expect(html, locale).toContain(`<h1 class="ui-page-title">${esc(words(locale, "access_denied_title"))}</h1>`)
            expect(html, locale).toContain(`<p class="ui-page-subtitle">${esc(words(locale, "access_denied_role"))}</p>`)
            expect(html, locale).toContain(`>${esc(words(locale, "access_denied_dashboard"))}</a>`)
        }
    })

    it("says why, and who can change it", () => {
        const subtitle = (html: string) => html.match(/<p class="ui-page-subtitle">([^<]*)<\/p>/)?.[1]
        // A role that doesn't include it: an Admin can add it.
        expect(subtitle(render())).toBe(esc(en.access_denied_role))
        // A page only a Super Admin opens: nobody's role changes that, an Admin's included.
        state.viewer = { id: "a1", role: "ADMIN", companyId: "c1", userStatus: "ACTIVE" }
        expect(subtitle(render({ superAdmins: true }))).toBe(esc(en.access_denied_super_admins))
        // A module the company's package doesn't include (lib/features/guard.tsx), whoever asks.
        expect(subtitle(render({ notInPackage: true }))).toBe(esc(en.access_denied_package))
        // A Super Admin on a company's own page.
        state.viewer = { id: "s1", role: "SUPER_ADMIN" }
        expect(subtitle(render())).toBe(esc(en.access_denied_company))
        // An account that can't open pages for now, whatever the page.
        state.viewer = { id: "u1", role: "EMPLOYEE", companyId: "c1", userStatus: "SUSPENDED" }
        expect(subtitle(render())).toBe(esc(en.access_denied_account))
        state.viewer = { id: "u1", role: "EMPLOYEE", companyId: "c1", userStatus: "ACTIVE", companyBanned: true }
        expect(subtitle(render())).toBe(esc(en.access_denied_account))
    })

    it("goes to the dashboard, except where it would only be told the same again", () => {
        expect(render()).toMatch(DASHBOARD_LINK)
        expect(render({ superAdmins: true })).toMatch(DASHBOARD_LINK)
        expect(render({ notInPackage: true })).toMatch(DASHBOARD_LINK)
        // On the dashboard itself.
        state.path = "/dashboard"
        expect(render()).not.toContain('href="/dashboard"')
        // For an account that can't open pages: every page says this.
        state.path = "/dashboard/records"
        state.viewer = { id: "u1", role: "EMPLOYEE", companyId: "c1", userStatus: "SUSPENDED" }
        expect(render()).not.toContain('href="/dashboard"')
    })

    it("is said, on every page only a Super Admin opens, to be one", () => {
        const files = (dir: string): string[] => readdirSync(dir).flatMap(name => {
            const path = join(dir, name)
            return statSync(path).isDirectory() ? files(path) : /\.tsx$/.test(name) ? [path] : []
        })
        const onlySuperAdmins = /(!isSuperAdmin|role !== ['"]SUPER_ADMIN['"])\)( \{)?\s*(\/\/[^\n]*\n\s*)*return <AccessDenied\b([^>]*)\/>/g
        const said: string[] = []
        for (const file of [...files("app"), ...files("components")]) {
            for (const m of readFileSync(file, "utf8").matchAll(onlySuperAdmins)) {
                expect(m[4].trim(), file).toBe("superAdmins")
                said.push(file)
            }
        }
        expect(said.length).toBe(17)
        // And no page says it of a page others open.
        for (const file of [...files("app"), ...files("components")]) {
            const src = readFileSync(file, "utf8")
            const saying = src.match(/<AccessDenied superAdmins \/>/g)?.length ?? 0
            expect(saying, file).toBe(said.filter(f => f === file).length)
        }
    })

    it("says nothing in Arabic in the masculine, and never speaks as \"we\"", () => {
        const keys = ["access_denied_title", "access_denied_role", "access_denied_super_admins", "access_denied_package", "access_denied_company", "access_denied_account", "access_denied_dashboard"] as const
        for (const key of keys) {
            expect(en[key], key).not.toMatch(/\b(we|our|us)\b/i)
            expect(ar[key], key).not.toMatch(/(^|\s)(تحقق|امسح|أدخل|اختر|حاول|انتظر|اطلب|اكتب|أكّد|انسخ|اتركه|قم|تواصل|راجع)(\s|$)|هل أنت متأكد|أنك تريد|هل تريد|سن[أتني]|نحن/)
        }
        // The glossary's names for the two roles (UI_PLAN.md §3.2).
        expect(ar.access_denied_role).toContain(ar.role_admin)
        expect(ar.access_denied_super_admins).toContain(ar.role_super_admin)
        expect(en.access_denied_role).toContain(en.role_admin)
        expect(en.access_denied_super_admins).toContain(en.role_super_admin)
    })
})
