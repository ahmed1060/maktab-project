import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The company's name in the page's language in the company columns and
 * company selects of the screens that list every company's people, clients,
 * places, check-ins, requests and records (LATER_CHANGES_PLAN.md §3.1, step
 * 7c-2; PR 411): each in the page's language, or in the one it has while it
 * has only one, the selects in the page's order, and All users' search
 * finding a company by either language.
 */

const { companyOptions, companyLabel } = await import("@/lib/company-name")
const read = (path: string) => stripComments(readFileSync(path, "utf8"))

const NILE = { id: "c1", name: "Elnil Accounting Office", nameAr: "مكتب النيل للمحاسبة" }
const DELTA = { id: "c2", name: "Delta Foods", nameAr: null }
const ARISH = { id: "c3", name: "Arish Trading", nameAr: "العريش للتجارة" }

describe("a company select's options", () => {
    it("each company in the page's language, in the page's order", () => {
        expect(companyOptions([NILE, DELTA, ARISH], "ar")).toEqual([
            { value: "c3", label: "العريش للتجارة" },
            { value: "c1", label: "مكتب النيل للمحاسبة" },
            { value: "c2", label: "Delta Foods" },
        ])
        expect(companyOptions([NILE, DELTA, ARISH], "en")).toEqual([
            { value: "c1", label: "Elnil Accounting Office" },
            { value: "c2", label: "Delta Foods" },
            { value: "c3", label: "Arish Trading" },
        ])
    })
})

describe("a company's name sent as two fields", () => {
    it("is in the page's language, or the one it has, and nothing where there's none", () => {
        expect(companyLabel("ar", NILE.name, NILE.nameAr)).toBe(NILE.nameAr)
        expect(companyLabel("en", NILE.name, NILE.nameAr)).toBe(NILE.name)
        expect(companyLabel("ar", DELTA.name, null)).toBe(DELTA.name)
        expect(companyLabel("ar", undefined, undefined)).toBeUndefined()
    })
})

describe("what gives each company's Arabic", () => {
    it("the people listed on All users and the audit log", () => {
        expect(read("app/api/users/route.ts")).toContain("company: { select: { id: true, name: true, nameAr: true } },")
    })

    it("All users' search, which finds a company by either language", () => {
        const query = read("lib/services/user-query.ts")
        expect(query).toContain("{ company: { name: { contains: searchParam, mode: 'insensitive' } } },")
        expect(query).toContain("{ company: { nameAr: { contains: searchParam, mode: 'insensitive' } } }")
    })

    it("the clients of every company", () => {
        expect(read("app/api/clients/route.ts")).toContain("...(userRole === 'SUPER_ADMIN' ? { company: { select: { name: true, nameAr: true } } } : {})")
    })

    it("the places", () => {
        expect(read("lib/services/location.service.ts")).toContain("company: { select: { name: true, nameAr: true } },\n} satisfies Prisma.LocationSelect")
    })

    it("the check-ins", () => {
        const flags = read("lib/services/attendance-flag.service.ts")
        expect(flags).toContain("company: { select: { name: true, nameAr: true } },\n} as const")
        expect(flags).toContain("companyName: company.name, companyNameAr: company.nameAr }")
    })

    it("role change requests and access reviews", () => {
        expect(read("lib/services/role-change-request.service.ts")).toContain("company: { select: { name: true, nameAr: true } },\n    role:")
        expect(read("lib/services/access-review.service.ts")).toContain("company: { select: { name: true, nameAr: true } },\n    lines:")
    })

    it("template offers", () => {
        const templates = read("lib/services/role-template.service.ts")
        expect(templates).toContain("id: true, name: true, companyId: true, company: { select: { name: true, nameAr: true } },")
        expect(templates).toContain("companyName: role.company.name, companyNameAr: role.company.nameAr,")
    })

    it("records, and the clients a record is added for", () => {
        const records = read("lib/services/record.service.ts")
        expect(records).toContain("company: { select: { name: true, nameAr: true, timezone: true } }")
        expect(records).toContain("client: { id: client.id, name: client.name, nameAr: client.nameAr, ...(\"company\" in client && client.company ? { company: (client.company as { name: string }).name, companyAr: (client.company as { nameAr: string | null }).nameAr } : {}) },")
        expect(records).toContain("select: { id: true, name: true, nameAr: true, ...(company ? {} : { company: { select: { name: true, nameAr: true } } }) },")
        expect(records).toContain("clients: clients.slice(0, CLIENTS_SHOWN).map(v => ({ id: v.id, name: v.name, nameAr: v.nameAr, ...(\"company\" in v && v.company ? { company: (v.company as { name: string }).name, companyAr: (v.company as { nameAr: string | null }).nameAr } : {}) })),")
    })
})

describe("each screen shows it in the page's language", () => {
    it("All users: its column and its company select", () => {
        const page = read("app/(dashboard)/dashboard/all-users/page.tsx")
        expect(page).toContain("const companyOf = (p: Person) => p.company ? <bdi>{companyNameIn(locale, p.company)}</bdi> : t('all_users_no_company')")
        expect(page).toContain("options={[{ value: '', label: t('all_users_any_company') }, ...companyOptions(companies, locale)]} />")
    })

    it("the audit log: each person's company beside them", () => {
        expect(read("app/(dashboard)/dashboard/audit-logs/page.tsx")).toContain("label: u.company ? `${nameOf(u)} (${companyNameIn(locale, u.company)})` : nameOf(u)")
    })

    it("check-ins: its column and card", () => {
        const page = read("app/(dashboard)/dashboard/check-ins/page.tsx")
        expect(page.split("company(companyNameIn(locale, { name: w.companyName, nameAr: w.companyNameAr }))").length - 1).toBe(2)
    })

    it("clients: its column, card and Add client's company select", () => {
        const page = read("app/(dashboard)/dashboard/clients/page.tsx")
        expect(page).toContain("cell: (c: Client) => <bdi>{c.company && companyNameIn(locale, c.company)}</bdi> }] : []),")
        expect(page).toContain("...(everyCompany && c.company ? [{ icon: BuildingsIcon, text: <bdi>{companyNameIn(locale, c.company)}</bdi> }] : []),")
        expect(page).toContain("options={[{ value: '', label: t('select_company') }, ...companyOptions(companies, locale)]} />")
    })

    it("places: their column and card, and Add place's company select", () => {
        const list = read("components/locations/LocationsList.tsx")
        expect(list).toContain("cell: (l: LocationItem) => <bdi>{companyNameIn(locale, l.company)}</bdi> }] : []),")
        expect(list).toContain("...(everyCompany ? [{ icon: BuildingsIcon, text: <bdi>{companyNameIn(locale, l.company)}</bdi> }] : []),")
        expect(read("components/locations/LocationForm.tsx")).toContain("options={[{ value: '', label: t('select_company') }, ...companyOptions(companies, locale)]} />")
    })

    it("the client pickers: each client's company beside it", () => {
        expect(read("components/locations/useClientOptions.ts")).toContain("company: c.company ? companyNameIn(locale, c.company) : undefined,")
        expect(read("components/records/RecordForm.tsx")).toContain("label: c.company ? `${c.name} · ${companyLabel(locale, c.company, c.companyAr)}` : c.name")
    })

    it("records: their list and a record's details", () => {
        const list = read("components/records/RecordsList.tsx")
        expect(list).toContain("detail={companyLabel(locale, r.client.company, r.client.companyAr)}")
        expect(list).toContain("...(showClient && r.client.company ? [{ icon: BuildingOfficeIcon, text: <bdi>{companyLabel(locale, r.client.company, r.client.companyAr)}</bdi> }] : []),")
        expect(read("components/records/RecordDialog.tsx")).toContain("...(record.client.company ? [{ label: t('company_label'), value: <bdi>{companyLabel(locale, record.client.company, record.client.companyAr)}</bdi> }] : []),")
    })

    it("Add employee's and Copy roles' company selects", () => {
        expect(read("app/(dashboard)/dashboard/employees/new/page.tsx")).toContain("options={[{ value: '', label: t('select_company_placeholder') }, ...companyOptions(companyList, locale)]}")
        expect(read("components/CopyRolesModal.tsx")).toContain("options={[{ value: '', label: t('roles_copy_choose') }, ...companyOptions(companies, locale)]} />")
    })

    it("role change requests: each one's facts and its menu", () => {
        const requests = read("components/RoleChangeRequests.tsx")
        expect(requests).toContain("detail={facts([side === 'superAdmin' ? companyNameIn(locale, r.company) : null, name(r.requestedBy), day(r.createdAt)])}")
        expect(requests).toContain("`${roleName(r)}${t('list_separator')}${companyNameIn(locale, r.company)}`")
    })

    it("access reviews: each one's heading", () => {
        expect(read("components/AccessReviews.tsx")).toContain("return <>{before}<bdi>{companyNameIn(locale, review.company)}</bdi>{after}</>")
    })

    it("template offers: each role's company", () => {
        expect(read("components/TemplateOfferModal.tsx")).toContain("<bdi>{companyNameIn(locale, { name: r.companyName, nameAr: r.companyNameAr })}</bdi>")
    })
})
