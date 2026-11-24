import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The company's name in the page's language on the Super Admin's own screens
 * for companies (LATER_CHANGES_PLAN.md §3.1, step 7c-1; PR 410): the company
 * switcher, the side bar's name while looking at one company, the Companies
 * page, a company's own pages, and the preview note. Each shows the name in
 * the page's language, or in the one it has while it has only one.
 */

const ui = { locale: "en" as "en" | "ar" }
const db = { companies: [] as any[], one: null as any, asked: [] as any[] }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null, update: async () => null }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        company: {
            findMany: async () => db.companies,
            findUnique: async (args: any) => { db.asked.push(args); return db.one },
        },
    },
}))

const { companiesInOrder, companyMatches } = await import("@/lib/company-name")
const render = (el: ReturnType<typeof h>, locale: "en" | "ar" = "en") => { ui.locale = locale; return renderToStaticMarkup(el) }
const read = (path: string) => stripComments(readFileSync(path, "utf8"))

const NILE = { id: "c1", name: "Elnil Accounting Office", nameAr: "مكتب النيل للمحاسبة" }
const DELTA = { id: "c2", name: "Delta Foods", nameAr: null }
const ARISH = { id: "c3", name: "Arish Trading", nameAr: "العريش للتجارة" }

beforeEach(() => {
    db.companies = []
    db.one = null
    db.asked = []
})

describe("companies in the page's order, found by either language", () => {
    it("an English page keeps the order they come in", () => {
        expect(companiesInOrder([NILE, DELTA, ARISH], "en").map(c => c.id)).toEqual(["c1", "c2", "c3"])
    })

    it("an Arabic page puts the ones with an Arabic name first, in Arabic order, then the rest as they come", () => {
        expect(companiesInOrder([DELTA, NILE, ARISH], "ar").map(c => c.id)).toEqual(["c3", "c1", "c2"])
    })

    it("a search finds a company by its English or its Arabic, any case", () => {
        expect(companyMatches(NILE, "ELNIL")).toBe(true)
        expect(companyMatches(NILE, "النيل")).toBe(true)
        expect(companyMatches(DELTA, "النيل")).toBe(false)
        expect(companyMatches(DELTA, " delta ")).toBe(true)
    })
})

describe("the company switcher", () => {
    it("lists each company in the page's language, in its order", async () => {
        const { pickerOptions } = await import("@/components/CompanyPicker")
        expect(pickerOptions([NILE, DELTA, ARISH], "", ar.all_companies, "ar")).toEqual([
            { id: null, name: ar.all_companies },
            { id: "c3", name: "العريش للتجارة" },
            { id: "c1", name: "مكتب النيل للمحاسبة" },
            { id: "c2", name: "Delta Foods" },
        ])
        expect(pickerOptions([NILE, DELTA], "", en.all_companies, "en").map(o => o.name)).toEqual([en.all_companies, "Elnil Accounting Office", "Delta Foods"])
    })

    it("finds a company by either language", async () => {
        const { pickerOptions } = await import("@/components/CompanyPicker")
        expect(pickerOptions([NILE, DELTA, ARISH], "النيل", ar.all_companies, "ar")).toEqual([{ id: "c1", name: "مكتب النيل للمحاسبة" }])
        expect(pickerOptions([NILE, DELTA, ARISH], "elnil", en.all_companies, "en")).toEqual([{ id: "c1", name: "Elnil Accounting Office" }])
    })

    it("shows the company in view in the page's language, its tile's initials too", async () => {
        const { default: CompanyPicker } = await import("@/components/CompanyPicker")
        const { initials } = await import("@/components/ui")
        const html = render(h(CompanyPicker, { companies: [NILE, DELTA], inViewId: "c1", onPick: () => {} }), "ar")
        expect(html).toContain(`<span class="ui-company-picker-name"><bdi>مكتب النيل للمحاسبة</bdi></span>`)
        expect(html).toContain(`>${initials("مكتب النيل للمحاسبة")}</span>`)
        expect(render(h(CompanyPicker, { companies: [NILE, DELTA], inViewId: "c1", onPick: () => {} }), "en")).toContain(`<span class="ui-company-picker-name"><bdi>Elnil Accounting Office</bdi></span>`)
    })

    it("is given each company's Arabic", () => {
        const system = read("lib/services/system.service.ts")
        expect(system.split("select: { id: true, name: true, nameAr: true }").length - 1).toBe(2)
    })
})

describe("the side bar while looking at one company", () => {
    it("names it in the page's language from the company the page is drawn for, as its logo", () => {
        const shell = read("components/DashboardShell.tsx")
        expect(shell).toContain("? (scopedBranding?.name ? companyNameIn(locale, { name: scopedBranding.name, nameAr: scopedBranding.nameAr }) : (selectedCompanyName || t('app_name')))")
    })

    it("which is read with its name in both languages", async () => {
        db.one = { moduleLabels: null, moduleIcons: null, logoUrl: "/nile.png", name: NILE.name, nameAr: NILE.nameAr }
        const { CompanyService } = await import("@/lib/services/company.service")
        expect(await CompanyService.getBranding("c1")).toEqual({ moduleLabels: null, moduleIcons: null, logoUrl: "/nile.png", name: NILE.name, nameAr: NILE.nameAr })
        expect(db.asked[0].select).toMatchObject({ name: true, nameAr: true })
    })
})

describe("the Companies page", () => {
    const row = (c: { id: string; name: string; nameAr: string | null }) => ({
        ...c, usernameCode: null, usernameNext: 0, isBanned: false, createdAt: new Date("2026-11-01T12:00:00Z"),
        trialPreset: "THREE_MONTHS", trialExtensionDays: 0, package: null, payments: [], _count: { payments: 0 },
    })
    const now = new Date("2026-11-02T12:00:00Z")

    it("finds a company by either language", async () => {
        db.companies = [row(NILE), row(DELTA), row(ARISH)]
        const { CompanyService } = await import("@/lib/services/company.service")
        expect((await CompanyService.listWithSubscription({ search: "النيل", now })).data.map(c => c.id)).toEqual(["c1"])
        expect((await CompanyService.listWithSubscription({ search: "elnil", now })).data.map(c => c.id)).toEqual(["c1"])
    })

    it("sorts by name in the page's language", async () => {
        db.companies = [row(ARISH), row(DELTA), row(NILE)]
        const { CompanyService } = await import("@/lib/services/company.service")
        expect((await CompanyService.listWithSubscription({ sort: "name", locale: "ar", now })).data.map(c => c.id)).toEqual(["c3", "c1", "c2"])
        expect((await CompanyService.listWithSubscription({ sort: "name", locale: "en", now })).data.map(c => c.id)).toEqual(["c3", "c2", "c1"])
    })

    it("asks for its list in the page's language", () => {
        const route = read("app/api/companies/route.ts")
        expect(route).toContain("const locale = searchParams.get('lang') === 'ar' ? 'ar' : 'en'")
        expect(route).toContain("await CompanyService.listWithSubscription({ page, limit, filter, sort, search, locale })")
        expect(read("app/(dashboard)/dashboard/companies/page.tsx")).toContain("&search=${encodeURIComponent(search)}&lang=${locale}`")
    })

    it("names each company in the page's language: its row and card, its menu, what's said once it's banned or deleted, and the delete question", () => {
        const page = read("app/(dashboard)/dashboard/companies/page.tsx")
        expect(page).toContain("const named = (c: Company) => companyNameIn(locale, c)")
        expect(page).toContain("said(c.isBanned ? 'companies_unbanned_done' : 'companies_banned_done', named(c)),")
        expect(page).toContain("said('companies_deleted', named(c)),")
        expect(page).toContain("label={t('ui_more_actions_for').replace('{name}', named(c))}")
        expect(page).toContain("cell: c => <ItemTitle title={<><bdi>{named(c)}</bdi>{banned(c)}</>} /> },")
        // In the table's row above, and its card's title.
        expect(page.split("title={<><bdi>{named(c)}</bdi>{banned(c)}</>}").length - 1).toBe(2)
        expect(page).toContain("name={named(removing)}")
    })

    it("and its dialogs: Edit's and Ban's titles, and what's said once it's saved", () => {
        const dialogs = read("components/CompanyDialogs.tsx")
        expect(dialogs).toContain("t('companies_edit_title').replace('{name}', companyNameIn(locale, company))")
        expect(dialogs).toContain(".replace('{name}', companyNameIn(locale, company))}")
        expect(dialogs).toContain("onSaved(companyNameIn(locale, { name: trimmed, nameAr: names.ar.trim() }), !company)")
    })
})

describe("a company's own pages", () => {
    it("its settings' and its payments' headings name it in the page's language", () => {
        expect(read("app/(dashboard)/dashboard/companies/[id]/settings/page.tsx")).toContain("title={company?.name ? <bdi>{companyNameIn(locale, company)}</bdi> : t('company_settings_title')}")
        expect(read("app/(dashboard)/dashboard/companies/[id]/payments/page.tsx")).toContain("const companyName: string | undefined = companyResult?.data ? companyNameIn(locale, companyResult.data) : undefined")
    })
})

describe("the preview note", () => {
    const preview = { roleName: "HR Officer", roleBuiltIn: null, companyId: "c1", companyName: NILE.name, companyNameAr: NILE.nameAr }

    it("names the company in the page's language, or the one it has", async () => {
        const { default: PreviewNote } = await import("@/components/PreviewNote")
        expect(render(h(PreviewNote, { preview }), "ar")).toContain(ar.preview_banner.replace("{role}", "HR Officer").replace("{company}", NILE.nameAr))
        expect(render(h(PreviewNote, { preview }), "en")).toContain(en.preview_banner.replace("{role}", "HR Officer").replace("{company}", NILE.name))
        expect(render(h(PreviewNote, { preview: { ...preview, companyNameAr: null } }), "ar")).toContain(ar.preview_banner.replace("{role}", "HR Officer").replace("{company}", NILE.name))
    })
})
