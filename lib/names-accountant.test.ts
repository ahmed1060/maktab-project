import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h, type ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { state as access, prismaMock, as } from "./permissions/employee-access.harness"
import { summarise } from "./portal-tax"
import type { TaxStatement } from "./tax-statement"

/**
 * The responsible accountant and the tax statement with each name in the
 * page's language (LATER_CHANGES_PLAN.md §3.1, step 8g; PR 418): the
 * accountant on a client's Tax position, with its picker's people in the
 * page's order, on the client's area's home and its Contact on WhatsApp, and
 * on the tax statement; and the statement's client, on the sheet and in the
 * title that names its PDF. Each name is in the page's language, or in the
 * one it has while it has only one.
 */

const ui = { locale: "en" as "en" | "ar", contact: undefined as unknown, accountant: null as unknown }
vi.mock("next-auth", () => ({ getServerSession: async () => access.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("next/navigation", () => ({
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    notFound: () => { throw new Error("NOT_FOUND") },
    redirect: (to: string) => { throw new Error(`REDIRECT ${to}`) },
}))
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" ? { value: ui.locale } : undefined) }),
    headers: async () => new Headers(),
}))
vi.mock("@/lib/services/system-settings.service", () => ({ pageSystemSettings: async () => ({ showPoweredBy: true, poweredByName: "Nizmo" }) }))
vi.mock("@/lib/client-portal-frame", () => ({ portalFrame: async () => ({ company: { name: "Nile Works", nameAr: "أعمال النيل", logoUrl: null } }) }))
// What the area's home hands Contact on WhatsApp: the accountant, named.
vi.mock("@/components/portal/ContactWhatsApp", async importOriginal => ({
    ...await importOriginal<typeof import("@/components/portal/ContactWhatsApp")>(),
    ContactWhatsApp: ({ accountant }: { accountant: unknown }) => { ui.contact = accountant; return null },
}))

const render = (el: ReturnType<typeof h>, locale: "en" | "ar") => { ui.locale = locale; return renderToStaticMarkup(el) }

// Made-up people and a client.
const TAMER = { id: "u1", firstName: "Tamer", lastName: "Saleh", firstNameAr: "تامر", lastNameAr: "صالح", role: "EMPLOYEE", whatsappNumber: "+201001234567", status: "ACTIVE" }
const BOB = { id: "u2", firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null, role: "EMPLOYEE", whatsappNumber: null, status: "ACTIVE" }
const ADEL = { id: "u3", firstName: "Adel", lastName: "Nour", firstNameAr: "عادل", lastNameAr: "نور", role: "EMPLOYEE", whatsappNumber: null, status: "ACTIVE" }
const COMPANY = { name: "Nile Works", nameAr: "أعمال النيل", logoUrl: null }
const asked: Record<string, any> = {}

beforeEach(() => {
    ui.locale = "en"
    ui.contact = undefined
    ui.accountant = TAMER
    for (const key of Object.keys(asked)) delete asked[key]
    prismaMock.client.findUnique = async (query: any) => {
        asked[Object.keys(query.select).includes("responsibleAccountant") ? "accountant" : "client"] = query
        return { id: "noor", companyId: "c1", name: "Al Noor Trading", nameAr: "النور للتجارة", archivedAt: null, company: COMPANY, responsibleAccountant: ui.accountant }
    }
    prismaMock.client.findFirst = async () => ({ id: "noor", companyId: "c1" })
    prismaMock.user.findMany = async (query: unknown) => { asked.people = query; return [ADEL, BOB, TAMER] }
    prismaMock.clientTaxPosition.findUnique = async () => ({ asOf: new Date("2026-11-16T00:00:00Z") })
    prismaMock.taxClaim.findMany = async () => []
})

describe("who the accountant is", () => {
    it("is given in Arabic too, on the client's page and to the client's area", async () => {
        const { accountantOf, portalAccountant } = await import("@/lib/services/client-accountant.service")
        expect((await accountantOf("noor")).person).toMatchObject({ id: "u1", name: "Tamer Saleh", nameAr: "تامر صالح" })
        expect(asked.accountant.select.responsibleAccountant.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
        expect(await portalAccountant("noor")).toEqual({ name: "Tamer Saleh", nameAr: "تامر صالح", whatsappNumber: "+201001234567" })
    })

    it("has no Arabic where they have none", async () => {
        ui.accountant = { ...BOB, whatsappNumber: "+201000000000" }
        const { accountantOf } = await import("@/lib/services/client-accountant.service")
        expect((await accountantOf("noor")).person).toMatchObject({ name: "Bob Brown", nameAr: null })
    })

    it("and the people who may be picked, each in Arabic too", async () => {
        as("admin")
        const { accountantCandidates } = await import("@/lib/services/client-accountant.service")
        expect((await accountantCandidates(access.session.user, "noor")).people).toEqual([
            { id: "u3", name: "Adel Nour", nameAr: "عادل نور" },
            { id: "u2", name: "Bob Brown", nameAr: null },
            { id: "u1", name: "Tamer Saleh", nameAr: "تامر صالح" },
        ])
        expect(asked.people.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })
})

describe("the accountant on a client's Tax position", () => {
    const person = { id: "u1", name: "Tamer Saleh", nameAr: "تامر صالح", role: "EMPLOYEE", whatsappNumber: "+201001234567", ended: false }
    const PEOPLE = [{ id: "u3", name: "Adel Nour", nameAr: "عادل نور" }, { id: "u2", name: "Bob Brown", nameAr: null }, { id: "u1", name: "Tamer Saleh", nameAr: "تامر صالح" }]
    const panel = async (locale: "en" | "ar", props: object = {}) => {
        const { AccountantPanel } = await import("@/components/tax/ResponsibleAccountant")
        return render(h(AccountantPanel, { accountant: { person, reach: "whatsapp" }, picker: null, editsProfile: false, ...props } as any), locale)
    }
    const options = (html: string) => (html.match(/<option value="u\d"[^>]*>[^<]*<\/option>/g) ?? []).map(o => o.replace(/<[^>]*>/g, ""))

    it("is named in the page's language", async () => {
        expect(await panel("ar")).toContain("<bdi>تامر صالح</bdi>")
        expect(await panel("en")).toContain("<bdi>Tamer Saleh</bdi>")
    })

    it("its picker lists the people in the page's language, in the page's order", async () => {
        const picker = { people: PEOPLE, value: "u1", busy: false, onPick: () => {} }
        expect(options(await panel("ar", { picker }))).toEqual(["تامر صالح", "عادل نور", "Bob Brown"])
        expect(options(await panel("en", { picker }))).toEqual(["Adel Nour", "Bob Brown", "Tamer Saleh"])
    })

    it("and one whose contract has ended, kept picked, in the page's language", async () => {
        const picker = { people: PEOPLE.filter(p => p.id !== "u1"), value: "u1", busy: false, onPick: () => {} }
        expect(options(await panel("ar", { picker, accountant: { person: { ...person, ended: true }, reach: "ended" } }))).toContain("تامر صالح")
    })
})

describe("the accountant on the client's area's home", () => {
    const home = async (locale: "en" | "ar") => {
        const { PortalHome } = await import("@/components/portal/PortalHome")
        const { NIZMO_MESSAGES } = await import("./client-message-template")
        return render(h(PortalHome, {
            client: "Nile Trading", person: "Mona Fouad", position: summarise([], "2026-11-19", "2026-11-17"),
            accountant: { name: "Tamer Saleh", nameAr: "تامر صالح", whatsappNumber: "+201001234567" }, messages: NIZMO_MESSAGES,
        } as any), locale)
    }

    it("is named in the page's language, and so to Contact on WhatsApp", async () => {
        expect(await home("ar")).toContain("<bdi>تامر صالح</bdi>")
        expect(ui.contact).toEqual({ name: "تامر صالح", whatsappNumber: "+201001234567" })
        expect(await home("en")).toContain("<bdi>Tamer Saleh</bdi>")
        expect(ui.contact).toEqual({ name: "Tamer Saleh", whatsappNumber: "+201001234567" })
    })
})

describe("the tax statement", () => {
    const POSITION = summarise([], "2026-11-21", "2026-11-16")
    const STATEMENT: TaxStatement = {
        company: COMPANY, client: "Al Noor Trading", clientAr: "النور للتجارة", accountant: "Tamer Saleh", accountantAr: "تامر صالح",
        position: POSITION, signature: { show: true, name: "Nizmo" },
    }
    const sheet = async (locale: "en" | "ar", statement: TaxStatement = STATEMENT) => {
        const { TaxStatementSheet } = await import("@/components/tax/TaxStatement")
        return render(h(TaxStatementSheet, { statement }), locale)
    }

    it("names the client and the accountant on the sheet in the page's language", async () => {
        const html = await sheet("ar")
        expect(html).toContain("<bdi>النور للتجارة</bdi>")
        expect(html).toContain("<bdi>تامر صالح</bdi>")
        const english = await sheet("en")
        expect(english).toContain("<bdi>Al Noor Trading</bdi>")
        expect(english).toContain("<bdi>Tamer Saleh</bdi>")
    })

    it("or in English, on an Arabic page, where they have no Arabic", async () => {
        const html = await sheet("ar", { ...STATEMENT, clientAr: null, accountantAr: null })
        expect(html).toContain("<bdi>Al Noor Trading</bdi>")
        expect(html).toContain("<bdi>Tamer Saleh</bdi>")
    })

    it("names the client above its title in the page's language", async () => {
        const { TaxStatementPage } = await import("@/components/tax/TaxStatement")
        expect(render(h(TaxStatementPage, { statement: STATEMENT, home: "/portal" }), "ar")).toContain("النور للتجارة")
        expect(render(h(TaxStatementPage, { statement: STATEMENT, home: "/portal" }), "ar")).not.toContain("Al Noor Trading")
    })

    describe("on the client's page", () => {
        const open = async () => {
            as("admin")
            const { default: Page } = await import("@/app/(dashboard)/dashboard/clients/[id]/tax-statement/page")
            return await Page({ params: Promise.resolve({ id: "noor" }) }) as ReactElement<{ statement: TaxStatement }>
        }

        it("is given the client and the accountant in Arabic too", async () => {
            const { statement } = (await open()).props
            expect(statement).toMatchObject({ client: "Al Noor Trading", clientAr: "النور للتجارة", accountant: "Tamer Saleh", accountantAr: "تامر صالح" })
            expect(asked.client.select).toMatchObject({ name: true, nameAr: true })
        })

        it("is titled, for its PDF, with the client in the page's language", async () => {
            const { generateMetadata } = await import("@/app/(dashboard)/dashboard/clients/[id]/tax-statement/page")
            as("admin")
            ui.locale = "ar"
            expect((await generateMetadata({ params: Promise.resolve({ id: "noor" }) })).title).toContain("النور للتجارة")
            ui.locale = "en"
            expect((await generateMetadata({ params: Promise.resolve({ id: "noor" }) })).title).toContain("Al Noor Trading")
        })
    })

    it("on the client's area, is given the accountant in Arabic too", async () => {
        access.session = { user: { id: "acct-1", role: "CLIENT_ACCOUNT", companyId: "c1", clientId: "noor", clientName: "Al Noor Trading" } }
        const { default: Page } = await import("@/app/(portal)/portal/statement/page")
        const page = await Page() as ReactElement<{ statement: TaxStatement }>
        expect(page.props.statement).toMatchObject({ accountant: "Tamer Saleh", accountantAr: "تامر صالح" })
    })
})
