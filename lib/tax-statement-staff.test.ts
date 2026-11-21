import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { summarise, type PortalTaxPosition } from "./portal-tax"
import { daysLate, type TaxClaimRow, type TaxPosition } from "./tax-claims"
import type { TaxStatement } from "./tax-statement"

/**
 * The tax position statement for the company's people (CLIENT_PORTAL_PLAN.md
 * §8, §12 step 12b; DESIGN.md §5.5, Tax position statement; PR 353): the page
 * at /dashboard/clients/<id>/tax-statement, in the app's frame, for whoever
 * may see the client's tax position, and Download the statement on the
 * client's Tax position. The sheet is the client's area's (PR 352,
 * lib/tax-statement.test.ts). All its names and figures are made up.
 */

const state = {
    locale: "en" as "en" | "ar",
    session: null as null | { user: Record<string, unknown> },
    statement: null as null | { client: string; company: { name: string; logoUrl: string | null }; position: PortalTaxPosition } | Error,
    read: [] as { user: unknown; clientId: unknown }[],
    accountant: null as null | { name: string; whatsappNumber: string | null },
    accountantRead: [] as string[],
    settings: { showPoweredBy: true, poweredByName: "Nizmo" },
    cookie: undefined as string | undefined,
    data: undefined as TaxPosition | undefined,
}

vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("swr", () => ({
    default: ([url, scope]: [string, string]) => ({ error: undefined, isLoading: false, isValidating: false, mutate: async () => {}, data: state.data === undefined ? undefined : { scope, url, body: { data: state.data } } }),
}))
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/navigation", () => ({
    redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
    notFound: () => { throw new Error("NOT_FOUND") },
    useRouter: () => ({ replace: () => undefined, push: () => undefined }),
    usePathname: () => "/dashboard/clients/noor/tax-statement",
}))
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" && state.cookie ? { value: state.cookie } : undefined) }),
    headers: async () => ({ get: () => null }),
}))
vi.mock("@/lib/services/tax-claim.service", () => ({
    taxStatementOf: async (user: unknown, clientId: unknown) => {
        state.read.push({ user, clientId })
        if (state.statement instanceof Error) throw state.statement
        return state.statement
    },
}))
vi.mock("@/lib/services/client-accountant.service", () => ({
    portalAccountant: async (clientId: string) => {
        state.accountantRead.push(clientId)
        return state.accountant
    },
}))
vi.mock("@/lib/services/system-settings.service", () => ({ pageSystemSettings: async () => state.settings }))

let TaxStatementPage: (props: { statement: TaxStatement; home: string }) => ReactElement
let AccessDenied: unknown
let Section: (props: { clientId: string; manages?: boolean }) => ReactElement
beforeAll(async () => {
    TaxStatementPage = (await import("@/components/tax/TaxStatement")).TaxStatementPage
    AccessDenied = (await import("@/components/AccessDenied")).default
    Section = (await import("@/components/tax/TaxPosition")).default
}, 60_000)

const TODAY = "2026-11-21"
const AS_OF = "2026-11-16"
const claim = (id: string, original: number, paid: number, dueDate: string): TaxClaimRow => ({
    id, claimNumber: `00011800000${id}`, item: "إقرار القيمة المضافة", taxType: null, registrationType: null,
    originalAmount: original, paidAmount: paid, remainingAmount: Math.round((original - paid) * 100) / 100,
    currency: "جنيه مصري", status: null, periodStart: null, periodEnd: null, dueDate, daysLate: daysLate(dueDate, TODAY),
})
const POSITION = summarise([claim("1", 7200, 0, "2026-10-31"), claim("2", 500, 200, "2026-12-15")], TODAY, AS_OF)
const COMPANY = { name: "Nile Accounts", logoUrl: "https://example.com/logo.png" }
const ADMIN = { id: "a1", role: "ADMIN", companyId: "c1", name: "Amal One", grants: undefined as string | undefined }
const source = (path: string) => stripComments(readFileSync(path, "utf8"))

beforeEach(async () => {
    const { withGrants } = await import("./permissions/test-actors")
    state.locale = "en"
    state.session = { user: withGrants({ ...ADMIN }) }
    state.statement = { client: "Al Noor Trading", company: COMPANY, position: POSITION }
    state.read = []
    state.accountant = { name: "Karim Saeed", whatsappNumber: "+201001234567" }
    state.accountantRead = []
    state.settings = { showPoweredBy: true, poweredByName: "Nizmo" }
    state.cookie = undefined
    state.data = undefined
})

const open = async (id = "noor") => {
    const { default: Page } = await import("@/app/(dashboard)/dashboard/clients/[id]/tax-statement/page")
    return await Page({ params: Promise.resolve({ id }) }) as ReactElement<{ statement: TaxStatement; home: string }>
}

describe("what the page at /dashboard/clients/<id>/tax-statement is given", () => {
    it("the client of the address, read for whoever is signed in, with the accountant its page names and the signature", async () => {
        state.settings = { showPoweredBy: false, poweredByName: "Nizmo Cloud" }
        const page = await open()
        expect(state.read).toEqual([{ user: state.session!.user, clientId: "noor" }])
        expect(state.accountantRead).toEqual(["noor"])
        expect(page.type).toBe(TaxStatementPage)
        expect(page.props).toEqual({
            statement: {
                company: COMPANY,
                client: "Al Noor Trading",
                // The name alone, as on the client's own statement.
                accountant: "Karim Saeed",
                position: POSITION,
                signature: { show: false, name: "Nizmo Cloud" },
            },
            // Close goes back to the client's page.
            home: "/dashboard/clients/noor",
        })
    })

    it("no accountant is no one named", async () => {
        state.accountant = null
        expect((await open()).props.statement.accountant).toBeNull()
    })

    it("a client that isn't there, or isn't the company's, isn't found; anything else is thrown", async () => {
        for (const missing of ["CLIENT_NOT_FOUND", "TAX_CLIENT_REQUIRED"]) {
            state.statement = new Error(missing)
            await expect(open(), missing).rejects.toThrow("NOT_FOUND")
        }
        state.statement = new Error("connection lost")
        await expect(open()).rejects.toThrow("connection lost")
        expect(state.accountantRead).toEqual([])
    })

    it("someone who may not see tax positions is refused, with nothing read", async () => {
        const { withGrants } = await import("./permissions/test-actors")
        state.session = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Emad" }) }
        const page = await open()
        expect(page.type).toBe(AccessDenied)
        expect(state.read).toEqual([])
    })

    it("an account that can't open pages for now is refused as the app's other pages refuse it, with nothing read", async () => {
        state.session = { user: { ...state.session!.user, userStatus: "SUSPENDED" } }
        const page = await open()
        expect(page.type).toBe(AccessDenied)
        expect(state.read).toEqual([])
    })

    it("no session goes the way an ended one does", async () => {
        state.session = null
        const { SESSION_ENDED_PATH } = await import("./session-ended")
        await expect(open()).rejects.toThrow(`REDIRECT ${SESSION_ENDED_PATH}`)
        expect(state.read).toEqual([])
    })

    it("is the client portal's: its layout guards the module, as the client's Tax position is", () => {
        expect(source("app/(dashboard)/dashboard/clients/[id]/tax-statement/layout.tsx")).toMatch(/const locked = await guardModule\('TAX_POSITION'\)\s*return locked \?\? <>\{children\}<\/>/)
    })
})

describe("its title, which names the PDF", () => {
    it("comes with the page from the server, in the page's language, for whoever may see it", async () => {
        const { generateMetadata } = await import("@/app/(dashboard)/dashboard/clients/[id]/tax-statement/page")
        const meta = (id = "noor") => generateMetadata({ params: Promise.resolve({ id }) })
        expect(await meta()).toEqual({ title: "Al Noor Trading, tax position statement, 16 Nov 2026" })
        state.cookie = "ar"
        expect(await meta()).toEqual({ title: "Al Noor Trading، كشف الموقف الضريبي، ١٦ نوفمبر ٢٠٢٦" })
        // Nothing of its own before the first upload, or for anyone it isn't for.
        state.statement = { client: "Al Noor Trading", company: COMPANY, position: summarise([], TODAY, null) }
        expect(await meta()).toEqual({})
        state.statement = new Error("CLIENT_NOT_FOUND")
        expect(await meta()).toEqual({})
        state.statement = { client: "Al Noor Trading", company: COMPANY, position: POSITION }
        const { withGrants } = await import("./permissions/test-actors")
        state.session = { user: withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1", name: "Emad" }) }
        expect(await meta()).toEqual({})
        state.session = null
        expect(await meta()).toEqual({})
    })

    it("is left as it is by the app's own title for each page", async () => {
        const { ownsItsTitle } = await import("./page-title")
        expect(ownsItsTitle("/dashboard/clients/noor/tax-statement")).toBe(true)
        expect(ownsItsTitle("/dashboard/clients/noor")).toBe(false)
        expect(ownsItsTitle("/dashboard/clients/noor/statement")).toBe(false)
        expect(ownsItsTitle("/dashboard/clients/noor/tax-statement/more")).toBe(false)
        expect(source("components/PageTitle.tsx")).toMatch(/useEffect\(\(\) => \{\s*if \(ownsItsTitle\(pathname \|\| ""\)\) return/)
    })
})

describe("Download the statement, on the client's Tax position", () => {
    const FILED: TaxPosition = {
        client: { id: "noor", name: "Al Noor Trading", archived: false }, today: TODAY,
        position: { asOf: AS_OF, uploadedOn: AS_OF, uploadedBy: "Amal One" },
        totals: { original: 7700, paid: 200, remaining: 7500, open: 2, late: 1 },
        claims: [claim("1", 7200, 0, "2026-10-31"), claim("2", 500, 200, "2026-12-15")],
        total: 2, totalPages: 1,
        accountant: { person: null, reach: "none" },
    }
    // The section's heading, up to its first part.
    const head = (html: string) => html.slice(html.indexOf(`<div class="ui-section-head">`), html.indexOf("</h2>") + 2000)
    const section = (data: TaxPosition, manages = false, locale: "en" | "ar" = "en") => {
        state.locale = locale
        state.data = data
        return renderToStaticMarkup(h(Section, { clientId: "noor", manages }))
    }
    const LINK = `<a class="ui-btn ui-btn-secondary" href="/dashboard/clients/noor/tax-statement" target="_blank" rel="noopener noreferrer">`
    const linkText = (words: typeof en) => `${words.tax_statement_download}<span class="ui-visually-hidden"> ${words.ui_opens_new_tab.replace(/'/g, "&#x27;")}</span></a>`

    it("before Upload from the tax portal, opening the statement in a new tab, which it says to screen readers", () => {
        for (const locale of ["en", "ar"] as const) {
            const words = locale === "ar" ? ar : en
            const html = head(section(FILED, true, locale))
            expect(html, locale).toContain(LINK)
            expect(html, locale).toContain(linkText(words))
            expect(html.indexOf(LINK), locale).toBeLessThan(html.indexOf(words.tax_upload))
        }
    })

    it("for whoever may see it, though they may not upload, and on an archived client, whose figures stay", () => {
        expect(head(section(FILED))).toContain(LINK)
        expect(head(section({ ...FILED, client: { ...FILED.client, archived: true } }, true))).toContain(LINK)
        // With nothing open in the file too: the statement says so.
        expect(head(section({ ...FILED, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 }))).toContain(LINK)
    })

    it("not before the first upload", () => {
        expect(section({ ...FILED, position: null, totals: { original: 0, paid: 0, remaining: 0, open: 0, late: 0 }, claims: [], total: 0, totalPages: 0 }, true)).not.toContain("/tax-statement")
    })
})
