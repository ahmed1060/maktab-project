import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The client's area's top bar (DESIGN.md §5.5; CLIENT_PORTAL_PLAN.md §5.3,
 * §12 step 7d-1; PR 334): the company's mark and name at its start; the
 * language switch and the account menu, with Sign out, at its end; and the
 * area in the company's brand colour. A language picked there is kept as the
 * account's.
 */

const state = {
    session: null as any,
    companies: {} as Record<string, { name: string; logoUrl: string | null; brandColour: string | null }>,
    companyReads: [] as any[],
    accounts: {} as Record<string, { language: string }>,
    locale: "en" as "en" | "ar",
}
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: {
            findUnique: async (args: any) => {
                state.companyReads.push(args)
                return state.companies[args.where.id] ?? null
            },
        },
        clientAccount: {
            updateMany: async ({ where, data }: any) => {
                const row = state.accounts[where.id]
                if (!row) return { count: 0 }
                Object.assign(row, data)
                return { count: 1 }
            },
        },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { logSystemError: async () => "REF1", friendlyErrorMessage: (ref: string) => `Something went wrong (${ref}).` },
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({
        locale: state.locale,
        t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key,
        setLanguage: () => {},
        isChangingLocale: false,
    }),
}))
vi.mock("next-auth/react", () => ({ signOut: async () => {}, useSession: () => ({ data: null }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/portal", useSearchParams: () => new URLSearchParams() }))

const CLIENT = { id: "acct-1", role: "CLIENT_ACCOUNT", name: "Maha Adel", clientId: "client-1", clientName: "Nile Trading", companyId: "co-1" }
const PERSON = { id: "u1", role: "ADMIN", companyId: "co-1", grants: "" }
const SUPER = { id: "sa1", role: "SUPER_ADMIN" }
const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { state.locale = locale; return renderToStaticMarkup(el) }
const css = stripComments(readFileSync("components/ui/ui.css", "utf8"))
const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`)
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1)
    return css.slice(at, css.indexOf("}", at))
}

beforeEach(() => {
    state.session = null
    state.companies = { "co-1": { name: "Nile Works", logoUrl: null, brandColour: "#0d9488" } }
    state.companyReads = []
    state.accounts = { "acct-1": { language: "en" } }
    state.locale = "en"
})

describe("what the area's frame reads for its top bar", () => {
    it("the session's company's name, logo and brand colour, in one read", async () => {
        const { portalFrame } = await import("./client-portal-frame")
        const frame = await portalFrame(CLIENT)
        expect(frame).toEqual({ company: { name: "Nile Works", logoUrl: null }, brand: "#0d9488" })
        expect(state.companyReads).toHaveLength(1)
        expect(state.companyReads[0]).toEqual({ where: { id: "co-1" }, select: { name: true, logoUrl: true, brandColour: true } })
    })

    it("no colour of its own leaves the system's default, as for the company's people", async () => {
        const { portalFrame } = await import("./client-portal-frame")
        for (const brandColour of [null, "teal", ""]) {
            state.companies["co-1"].brandColour = brandColour
            expect((await portalFrame(CLIENT))?.brand, String(brandColour)).toBeNull()
        }
    })

    it("nothing for anyone who isn't one of a client's people, and nothing read", async () => {
        const { portalFrame } = await import("./client-portal-frame")
        for (const who of [PERSON, SUPER, null, { ...CLIENT, companyId: null }]) expect(await portalFrame(who as any)).toBeNull()
        expect(state.companyReads).toEqual([])
    })

    it("nothing where the company isn't there", async () => {
        const { portalFrame } = await import("./client-portal-frame")
        state.companies = {}
        expect(await portalFrame(CLIENT)).toBeNull()
    })
})

describe("the area's layout", () => {
    const draw = async () => {
        const { default: PortalLayout } = await import("@/app/(portal)/layout")
        return render(await PortalLayout({ children: h("p", null, "the page") }))
    }

    it("draws the top bar above the page, in the company's brand colour, for one of a client's people", async () => {
        state.session = { user: CLIENT }
        const html = await draw()
        const { brandStyleSheet } = await import("./brand-colour")
        expect(html).toContain(`<style id="company-brand-colour">${brandStyleSheet("#0d9488")}</style>`)
        expect(html.indexOf('<header class="ui-topbar ui-portal-topbar">')).toBeGreaterThan(-1)
        expect(html.indexOf('<header class="ui-topbar ui-portal-topbar">')).toBeLessThan(html.indexOf('<main id="main-content" class="ui-portal-page"><p>the page</p></main>'))
        expect(html).toContain("<bdi>Nile Works</bdi>")
        expect(html).toContain('aria-label="Account menu, Maha Adel, Nile Trading"')
    })

    it("leaves the default colour where the company has none of its own", async () => {
        state.session = { user: CLIENT }
        state.companies["co-1"].brandColour = null
        const html = await draw()
        expect(html).not.toContain("company-brand-colour")
        expect(html).toContain("ui-portal-topbar")
    })

    it("draws no top bar or colour for anyone else, whom the page sends on", async () => {
        for (const session of [null, { user: PERSON }, { user: SUPER }]) {
            state.session = session
            const html = await draw()
            expect(html).not.toContain("ui-portal-topbar")
            expect(html).not.toContain("company-brand-colour")
            expect(html).toContain('<main id="main-content" class="ui-portal-page"><p>the page</p></main>')
        }
        expect(state.companyReads).toEqual([])
    })
})

describe("the top bar", () => {
    const company = { name: "Nile Works", logoUrl: null as string | null }
    const person = { name: "Maha Adel", client: "Nile Trading" }
    const bar = async (props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
        const { PortalTopBar } = await import("@/components/portal/PortalTopBar")
        return render(h(PortalTopBar, { company, person, ...props }), locale)
    }

    it("has the company's mark and name at its start: its first letter where it has no logo", async () => {
        const html = await bar()
        expect(html).toContain('<span class="ui-portal-company"><span class="ui-company-mark" aria-hidden="true"><span class="ui-company-letter">N</span></span><span class="ui-portal-company-name"><bdi>Nile Works</bdi></span></span>')
    })

    it("and its logo where it has one", async () => {
        const html = await bar({ company: { ...company, logoUrl: "/uploads/nile.png" } })
        expect(html).toContain('<img src="/uploads/nile.png" alt="" width="32" height="32" class="ui-logo-plate"/>')
    })

    it("has the language switch, then the account button, at its end, in both languages", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await bar({}, locale)
            const words = locale === "ar" ? ar : en
            const spacer = html.indexOf('<span class="ui-topbar-spacer"></span>')
            const language = html.indexOf(`aria-label="${words.language}"`)
            const account = html.indexOf('class="ui-topbar-account"')
            expect(spacer, locale).toBeGreaterThan(html.indexOf("ui-portal-company"))
            expect(language, locale).toBeGreaterThan(spacer)
            expect(account, locale).toBeGreaterThan(language)
            expect(html, locale).toContain(">English<")
            expect(html, locale).toContain(">العربية<")
        }
        expect(await bar({}, "ar")).toContain('aria-label="قائمة الحساب، Maha Adel، Nile Trading"')
    })

    it("is the person's initials, name and client, named with them, and the menu stays closed until asked", async () => {
        const html = await bar()
        expect(html).toContain('<button type="button" class="ui-topbar-account" aria-expanded="false" aria-label="Account menu, Maha Adel, Nile Trading">')
        expect(html).toContain('<span class="ui-avatar ui-avatar-32" aria-hidden="true">MA</span>')
        expect(html).toContain('<span class="ui-topbar-who"><span class="ui-topbar-name"><bdi>Maha Adel</bdi></span><span class="ui-topbar-role">Nile Trading</span></span>')
        expect(html).not.toContain("ui-account-menu")
    })

    it("has none of the company's app: no menu button, bell, company picker or search", async () => {
        const html = await bar()
        for (const part of ["ui-topbar-menu", "ui-topbar-mark", "ui-topbar-count", "ui-company-picker", 'type="search"', en.notifications, en.open_menu]) expect(html, part).not.toContain(part)
        const src = stripComments(readFileSync("components/portal/PortalTopBar.tsx", "utf8"))
        for (const part of ["NotificationBell", "CompanyPicker", "ThemeToggleButton", "/dashboard"]) expect(src, part).not.toContain(part)
    })
})

describe("the account menu", () => {
    const person = { name: "Maha Adel", client: "Nile Trading" }
    const menu = async (props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") => {
        const { PortalAccountMenu } = await import("@/components/portal/PortalTopBar")
        return render(h(PortalAccountMenu, { id: "m1", person, onSignOut: () => {}, signingOut: false, ...props }), locale)
    }

    it("has the person at its top, with their client under their name", async () => {
        const html = await menu()
        expect(html).toContain('<div id="m1" class="ui-account-menu">')
        expect(html).toContain('<div class="ui-account-head"><span class="ui-avatar ui-avatar-40" aria-hidden="true">MA</span><span class="ui-account-who"><span class="ui-account-name"><bdi>Maha Adel</bdi></span><span class="ui-account-role"><bdi>Nile Trading</bdi></span></span></div>')
    })

    it("then Sign out, with its icon, after a hairline, in both languages", async () => {
        for (const locale of ["en", "ar"] as const) {
            const html = await menu({}, locale)
            const words = locale === "ar" ? ar : en
            expect(html, locale).toMatch(new RegExp(`<div class="ui-menu-rule"></div><button type="button" class="ui-menu-item" aria-busy="false"><svg[^>]*>[\\s\\S]*?</svg>${words.sign_out}</button></div>$`))
        }
    })

    it("shows Sign out busy while it signs out, and it can't be pressed again", async () => {
        expect(await menu({ signingOut: true })).toContain('<button type="button" class="ui-menu-item" disabled="" aria-busy="true">')
    })

    it("has nothing of the company's people's: no profile, security, history or theme", async () => {
        const html = await menu()
        expect(html).not.toContain("<a ")
        for (const key of ["my_profile", "security_settings_nav", "history", "theme_label", "theme_light", "theme_dark"] as const) expect(html, key).not.toContain(`>${en[key]}<`)
        expect(html).not.toContain("ui-account-theme")
    })
})

describe("signing out", () => {
    it("moves from the page into the account menu", async () => {
        const { PortalHome } = await import("@/components/portal/PortalHome")
        const html = render(h(PortalHome, { client: "Nile Trading" }))
        expect(html).toContain(`<h1 class="ui-page-title">${en.tax_position}</h1>`)
        expect(html).not.toContain(`>${en.sign_out}<`)
        const src = stripComments(readFileSync("components/portal/PortalTopBar.tsx", "utf8"))
        expect(src).toContain("signOut({ redirect: false })")
        expect(src).toMatch(/router\.push\(['"]\/login['"]\)/)
    })
})

describe("a language picked in the area", () => {
    const post = async (body: unknown) => {
        const { POST } = await import("@/app/api/portal/language/route")
        return POST(new Request("https://nizmo.test/api/portal/language", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as any)
    }

    it("is kept as the account's, for its next visit and its emails", async () => {
        state.session = { user: CLIENT }
        const res = await post({ language: "ar" })
        expect(res.status).toBe(200)
        expect(state.accounts["acct-1"].language).toBe("ar")
        expect((await post({ language: "en" })).status).toBe(200)
        expect(state.accounts["acct-1"].language).toBe("en")
    })

    it("only Arabic or English", async () => {
        state.session = { user: CLIENT }
        for (const language of ["fr", "", null, 1]) {
            expect((await post({ language })).status, String(language)).toBe(400)
            expect(state.accounts["acct-1"].language).toBe("en")
        }
    })

    it("only by one of a client's people, for their own account", async () => {
        for (const user of [PERSON, SUPER]) {
            state.session = { user }
            expect((await post({ language: "ar" })).status, user.role).toBe(403)
        }
        expect(state.accounts["acct-1"].language).toBe("en")
        state.session = { user: { ...CLIENT, id: "acct-gone" } }
        expect((await post({ language: "ar" })).status).toBe(404)
    })

    it("is what the language switch saves to for one of a client's people, and a person's route for everyone else", () => {
        const src = stripComments(readFileSync("context/LanguageContext.tsx", "utf8"))
        expect(src).toMatch(/isClientAccount\(session\?\.user\)\s*\?\s*['"]\/api\/portal\/language['"]\s*:\s*['"]\/api\/user\/language['"]/)
        expect(src).not.toMatch(/fetch\(\s*['"]\/api\/user\/language['"]/)
    })
})

describe("its look (DESIGN.md §5.5)", () => {
    it("a top bar alone, on the panel colour with a line under it, kept at the top as the page scrolls", () => {
        const bar = rule(".ui-topbar.ui-portal-topbar")
        expect(bar).toContain("position: sticky;")
        expect(bar).toContain("inset-block-start: 0;")
        expect(bar).toContain("background: var(--panel);")
        expect(bar).toContain("border-block-end: 1px solid var(--rule);")
    })

    it("the company's name on one line, giving way first", () => {
        const name = rule(".ui-portal-company-name")
        expect(name).toContain("text-overflow: ellipsis;")
        expect(name).toContain("white-space: nowrap;")
        expect(name).toContain("min-inline-size: 0;")
        expect(rule(".ui-portal-company")).toContain("min-inline-size: 0;")
    })

    it("with logical sides only", () => {
        const at = css.indexOf(".ui-topbar.ui-portal-topbar {")
        const end = css.indexOf(".ui-portal-page {")
        expect(at).toBeGreaterThan(-1)
        expect(end).toBeGreaterThan(at)
        const block = css.slice(at, end)
        expect(block).toContain(".ui-portal-company-name {")
        expect(block).not.toMatch(/\b(left|right)\b/)
    })
})
