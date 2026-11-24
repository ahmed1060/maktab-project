import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * The company's name in the page's language, to its people (LATER_CHANGES_
 * PLAN.md §3.1, step 7b; PR 409): the session keeps it in both languages, at
 * sign-in and on its minute's check, as it does the company's logo, so a name
 * Nizmo's team completes or changes shows without signing in again; and the
 * Super Admin previewing one of its roles is given both. The frame shows the
 * one in the page's language, or the one it has while it has only one.
 */

const db = {
    roles: {} as Record<string, any>,
    users: {} as Record<string, any>,
}

// What's asked of a row's company, and nothing else, as Postgres answers.
const withCompany = (row: any, select: any) => {
    if (!row?.company || !select?.company?.select) return row
    const asked = Object.keys(select.company.select).filter(key => key in row.company)
    return { ...row, company: Object.fromEntries(asked.map(key => [key, row.company[key]])) }
}
vi.mock("@/lib/prisma", () => ({
    prisma: {
        role: { findUnique: async ({ where, select }: any) => withCompany(db.roles[where.id] ?? null, select) },
        user: { findUnique: async ({ where, select }: any) => withCompany(db.users[where.id] ?? null, select), update: async () => ({}) },
        superAdmin: { findUnique: async () => ({ sessionVersion: 0, keptSession: null, isProtected: false, emailVerifiedAt: new Date(), mfaEnabled: false, mustChangePassword: false }) },
        systemSettings: { findUnique: async () => null },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref" },
}))

const { authOptions } = await import("@/lib/auth")
const { CATALOGUE_VERSION } = await import("@/lib/permissions/catalogue")
const { companyNameIn, sessionCompanyName } = await import("@/lib/company-name")
const jwt = (args: any) => authOptions.callbacks!.jwt!(args) as Promise<any>
const session = (token: any) => authOptions.callbacks!.session!({ session: { user: {} } as any, token } as any) as Promise<any>

const COMPANY = { isBanned: false, name: "Elnil Accounting Office", nameAr: "مكتب النيل للمحاسبة", moduleLabels: null, moduleIcons: null, logoUrl: null, package: null, payments: [] }
const AMAL = {
    id: "u1", sessionVersion: 0, keptSession: null, status: "ACTIVE", emailVerifiedAt: new Date(), mfaEnabled: false, mustChangePassword: false,
    role: "ADMIN", roleId: null, assignedRole: null, actingUntil: null, companyId: "c1", returnRole: null, company: COMPANY,
}

beforeEach(() => {
    db.users = { u1: { ...AMAL, company: { ...COMPANY } } }
    db.roles = {
        r1: { id: "r1", name: "HR Officer", builtIn: null, baseRole: "EMPLOYEE", companyId: "c1", company: { name: COMPANY.name, nameAr: COMPANY.nameAr, package: null }, grants: [] },
    }
})

describe("the company's name in the page's language", () => {
    it("is its English on an English page and its Arabic on an Arabic one", () => {
        expect(companyNameIn("en", { name: "Elnil Accounting Office", nameAr: "مكتب النيل للمحاسبة" })).toBe("Elnil Accounting Office")
        expect(companyNameIn("ar", { name: "Elnil Accounting Office", nameAr: "مكتب النيل للمحاسبة" })).toBe("مكتب النيل للمحاسبة")
    })

    it("is the one it has while it has only one", () => {
        expect(companyNameIn("ar", { name: "Delta Trading", nameAr: null })).toBe("Delta Trading")
        expect(companyNameIn("ar", { name: "Delta Trading", nameAr: "  " })).toBe("Delta Trading")
        // Saved before in Arabic only: its Arabic is in both columns.
        expect(companyNameIn("en", { name: "مكتب النيل للمحاسبة", nameAr: "مكتب النيل للمحاسبة" })).toBe("مكتب النيل للمحاسبة")
    })

    it("is the session's company's, and nothing for a session with no company", () => {
        expect(sessionCompanyName("ar", { companyName: "Elnil Accounting Office", companyNameAr: "مكتب النيل للمحاسبة" })).toBe("مكتب النيل للمحاسبة")
        expect(sessionCompanyName("en", { companyName: "Elnil Accounting Office", companyNameAr: "مكتب النيل للمحاسبة" })).toBe("Elnil Accounting Office")
        // A session from before both were kept in it.
        expect(sessionCompanyName("ar", { companyName: "Elnil Accounting Office" })).toBe("Elnil Accounting Office")
        expect(sessionCompanyName("ar", { companyName: null, companyNameAr: null })).toBeNull()
        expect(sessionCompanyName("en", {})).toBeNull()
    })
})

describe("the session keeps it in both languages", () => {
    it("from sign-in", async () => {
        // next-auth names the token for the person before it asks the callback.
        const token = await jwt({ token: { sub: "u1" }, user: { id: "u1", role: "ADMIN", firstName: "Amal", lastName: "Hassan", companyId: "c1", companyName: COMPANY.name, companyNameAr: COMPANY.nameAr } })
        expect(token).toMatchObject({ companyName: COMPANY.name, companyNameAr: COMPANY.nameAr })
        expect((await session(token)).user).toMatchObject({ companyName: COMPANY.name, companyNameAr: COMPANY.nameAr })
    })

    it("reads the company's Arabic when someone signs in", () => {
        const auth = stripComments(readFileSync("lib/auth.ts", "utf8"))
        expect(auth).toContain("companyNameAr: validatedUser.company?.nameAr || null,")
    })

    it("and catches up on its minute's check, as the company's logo is", async () => {
        const old = { sub: "u1", role: "ADMIN", companyId: "c1", companyName: "مكتب النيل للمحاسبة", companyNameAr: null, checkedAt: 0, sessionVersion: 0, grants: "", catalogue: CATALOGUE_VERSION, roleId: null, roleVersion: 0 }
        const token = await jwt({ token: old })
        expect(token).toMatchObject({ companyName: COMPANY.name, companyNameAr: COMPANY.nameAr })
        expect((await session(token)).user).toMatchObject({ companyName: COMPANY.name, companyNameAr: COMPANY.nameAr })
    })

    it("keeps its Arabic empty once it has none", async () => {
        db.users.u1.company = { ...COMPANY, nameAr: null }
        const token = await jwt({ token: { sub: "u1", role: "ADMIN", companyId: "c1", companyName: COMPANY.name, companyNameAr: "قديم", checkedAt: 0, sessionVersion: 0, grants: "", catalogue: CATALOGUE_VERSION, roleId: null, roleVersion: 0 } })
        expect(token.companyNameAr).toBeNull()
    })

    it("and gives the Super Admin previewing one of its roles both", async () => {
        const token = await jwt({ token: { sub: "sa", role: "SUPER_ADMIN", checkedAt: Date.now(), sessionVersion: 0 }, trigger: "update", session: { previewRoleId: "r1" } })
        expect(token.preview).toMatchObject({ companyName: COMPANY.name, companyNameAr: COMPANY.nameAr })
        expect((await session(token)).user).toMatchObject({ companyName: COMPANY.name, companyNameAr: COMPANY.nameAr })
    })
})

describe("the frame shows it in the page's language", () => {
    const shell = stripComments(readFileSync("components/DashboardShell.tsx", "utf8"))
    const header = stripComments(readFileSync("components/DashboardHeader.tsx", "utf8"))

    it("in the side bar and the phone's top bar, for the company's people", () => {
        expect(shell).toContain(": (sessionCompanyName(locale, user ?? {}) || t('app_name'));")
    })

    it("in the account menu", () => {
        expect(header).toContain("companyName: currentUser.role === 'SUPER_ADMIN' ? null : sessionCompanyName(locale, user),")
    })

    it("in the side bar's look on Company settings, its logo card", () => {
        const tabs = stripComments(readFileSync("components/CompanySettingsTabs.tsx", "utf8"))
        expect(tabs).toContain("companyName={companyNameIn(locale, company)}")
    })
})

describe("what gives it in both languages", () => {
    const read = (path: string) => stripComments(readFileSync(path, "utf8"))

    it("Company settings, for the company's Admin and for the Super Admin", () => {
        expect(read("app/api/company-settings/route.ts")).toContain("{ id: company.id, name: company.name, nameAr: company.nameAr }")
        expect(read("app/api/companies/route.ts")).toContain("id: true, name: true, nameAr: true, isBanned: true, autoVerifyLocation: true,")
    })

    it("a payslip", () => {
        const route = read("app/api/payslips/[id]/route.ts")
        expect(route).toContain("company: { select: { id: true, name: true, nameAr: true, logoUrl: true, payslipsVisible: true } },")
        expect(route).toContain("company: { name: company.name, nameAr: company.nameAr, logoUrl: company.logoUrl },")
    })

    it("a settlement", () => {
        const route = read("app/api/settlements/[id]/route.ts")
        expect(route).toContain("company: { select: { id: true, name: true, nameAr: true, logoUrl: true } },")
        expect(route).toContain("company: { name: settlement.company.name, nameAr: settlement.company.nameAr, logoUrl: settlement.company.logoUrl },")
    })

    it("a client's statement", () => {
        const service = read("lib/services/client-statement.service.ts")
        expect(service).toContain("select: { name: true, nameAr: true, logoUrl: true } }),")
        expect(service).toContain('company: { name: company?.name ?? "", nameAr: company?.nameAr ?? null, logoUrl: company?.logoUrl ?? null },')
    })

    it("a tax position statement, for the company's people", () => {
        expect(read("lib/services/tax-claim.service.ts")).toContain("company: { select: { name: true, nameAr: true, logoUrl: true } } } })")
    })
})
