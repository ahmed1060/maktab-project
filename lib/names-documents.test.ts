import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { state as access, prismaMock, url, as } from "./permissions/employee-access.harness"
import type { Statement } from "./client-statement"

/**
 * The payslip, the settlement and the client's statement with each person
 * and client in the page's language (LATER_CHANGES_PLAN.md §3.1, step 8f;
 * PR 417): whom a payslip or a settlement is issued to, and a statement's
 * client and its owner. Each name is in the page's language, or in the one
 * it has while it has only one.
 */

const ui = { locale: "en" as "en" | "ar", id: "p1", swr: {} as Record<string, unknown> }
vi.mock("next-auth", () => ({ getServerSession: async () => access.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/storage", () => ({ supabase: {}, uploadToCloud: async () => { throw new Error("no uploads here") } }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: ui.locale, t: (key: string) => (ui.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("next/navigation", () => ({
    useParams: () => ({ id: ui.id }),
    useSearchParams: () => new URLSearchParams(""),
    useRouter: () => ({ replace: () => {}, push: () => {} }),
    usePathname: () => `/dashboard/clients/${ui.id}/statement`,
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Clients" }) }))
vi.mock("@/components/DateRangePicker", () => ({ default: () => null }))
// Each request answered by the start of its address.
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const found = key ? Object.entries(ui.swr).find(([start]) => key.startsWith(start))?.[1] : undefined
        return { data: found, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
    },
}))

const render = (el: ReturnType<typeof h>, locale: "en" | "ar") => { ui.locale = locale; return renderToStaticMarkup(el) }
const body = async (res: Response) => (await res.json()).data

// Made-up people and clients.
const HANA = { firstName: "Hana", lastName: "Saad", firstNameAr: "هناء", lastNameAr: "سعد" }
const BOB = { firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null }
const COMPANY = { name: "Nile Works", nameAr: "أعمال النيل", logoUrl: null }

beforeEach(() => { ui.swr = {}; ui.locale = "en" })

describe("a payslip", () => {
    const asked: { query?: any } = {}
    const payslip = (user: object) => ({
        id: "p1", userId: "u1", daysPaid: 30, excluded: false, exclusionReason: null, emailedAt: null,
        earningsAmount: 1000, deductionsAmount: 0, netAmount: 1000, carriedAmount: 0, lines: [],
        user: { id: "u1", email: "hana@example.com", companyId: "c1", ...user },
        payrollRun: { month: 10, year: 2026, status: "PAID", payrollDay: 1, paidAt: null, company: { id: "c1", payslipsVisible: false, ...COMPANY } },
    })
    const fetchIt = async (user: object) => {
        prismaMock.payslip.findUnique = async (query: unknown) => { asked.query = query; return payslip(user) }
        as("admin")
        return body(await (await import("@/app/api/payslips/[id]/route")).GET(new Request(url("/api/payslips/p1")), { params: Promise.resolve({ id: "p1" }) }))
    }
    const page = async (locale: "en" | "ar", person: object) => {
        ui.id = "p1"
        ui.swr = { "/api/payslips/p1": { data: { person: { ...person, email: "hana@example.com" }, company: COMPANY, period: { month: 10, year: 2026 }, status: "PAID", paidAt: null, daysPaid: 30, excluded: false, exclusionReason: null, earnings: 1000, deductions: 0, net: 1000, carried: 0, emailedAt: null, lines: [] } } }
        const { default: PayslipPage } = await import("@/app/(dashboard)/dashboard/documents/payslip/[id]/page")
        return render(h(PayslipPage), locale)
    }

    it("is given whom it's issued to in both languages", async () => {
        const doc = await fetchIt(HANA)
        expect(doc.person).toEqual({ ...HANA, email: "hana@example.com" })
        expect(asked.query.include.user.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("says whom it's issued to in the page's language", async () => {
        expect(await page("ar", HANA)).toContain("<bdi>هناء سعد</bdi>")
        expect(await page("en", HANA)).toContain("<bdi>Hana Saad</bdi>")
    })

    it("or in English, on an Arabic page, to someone with no Arabic name", async () => {
        expect(await page("ar", BOB)).toContain("<bdi>Bob Brown</bdi>")
    })
})

describe("a settlement", () => {
    const asked: { query?: any } = {}
    const settlement = (user: object) => ({
        id: "s1", companyId: "c1", lastWorkingDay: new Date("2026-10-31T00:00:00Z"),
        earnedAmount: 3000, paidAmount: 1000, netAmount: 2000, debtRecoveredAmount: 0,
        user: { email: "hana@example.com", ...user }, company: { id: "c1", ...COMPANY },
    })
    const fetchIt = async (user: object) => {
        prismaMock.finalSettlement.findUnique = async (query: unknown) => { asked.query = query; return settlement(user) }
        as("admin")
        return body(await (await import("@/app/api/settlements/[id]/route")).GET(new Request(url("/api/settlements/s1")), { params: Promise.resolve({ id: "s1" }) }))
    }
    const page = async (locale: "en" | "ar", person: object) => {
        ui.id = "s1"
        const doc = await fetchIt({ ...HANA, ...person })
        ui.swr = { "/api/settlements/s1": { data: doc } }
        const { default: SettlementPage } = await import("@/app/(dashboard)/dashboard/documents/settlement/[id]/page")
        return render(h(SettlementPage), locale)
    }

    it("is given whom it's issued to in both languages", async () => {
        const doc = await fetchIt(HANA)
        expect(doc.person).toEqual({ ...HANA, email: "hana@example.com" })
        expect(asked.query.include.user.select).toMatchObject({ firstName: true, lastName: true, firstNameAr: true, lastNameAr: true })
    })

    it("says whom it's issued to, under its title and on the sheet, in the page's language", async () => {
        const html = await page("ar", {})
        expect(html).toContain('<p class="ui-page-subtitle"><bdi>هناء سعد</bdi></p>')
        expect(html.split("<bdi>هناء سعد</bdi>").length - 1).toBe(2)
        const english = await page("en", {})
        expect(english).toContain('<p class="ui-page-subtitle"><bdi>Hana Saad</bdi></p>')
        expect(english.split("<bdi>Hana Saad</bdi>").length - 1).toBe(2)
    })

    it("or in English, on an Arabic page, to someone with no Arabic name", async () => {
        expect(await page("ar", BOB)).toContain('<p class="ui-page-subtitle"><bdi>Bob Brown</bdi></p>')
    })
})

describe("a client's statement", () => {
    const NOOR = { id: "noor", name: "Al Noor Trading", nameAr: "النور للتجارة", ownerName: "Hassan Adel", ownerNameAr: "حسن عادل" }
    const STATEMENT: Statement = {
        company: COMPANY,
        client: NOOR,
        period: { from: "2026-10-01", to: "2026-10-31" },
        issuedOn: "2026-11-08",
        charges: [{
            id: "x1", day: "2026-10-02", description: "Spare parts", task: { id: "k1", title: "AC repair" },
            paid: 1850, fee: 150, total: 2000, collectedOn: null, receipt: { number: 1, url: "https://p.supabase.co/storage/v1/object/public/app-assets/c1/receipts/r1.jpg", pdf: false },
        }],
        names: [],
        totals: { paid: 1850, fees: 150, charged: 2000, collected: 0, due: 2000, dueCount: 1, dueBefore: 0, dueBeforeCount: 0, stillDue: 2000 },
    }
    const sheet = async (locale: "en" | "ar", client: Statement["client"] = NOOR) => {
        const { StatementSheet } = await import("@/components/charges/ClientStatement")
        return render(h(StatementSheet, { statement: { ...STATEMENT, client }, withReceipts: true, view: "every" }), locale)
    }

    it("names the client and its owner on the sheet, and above its receipts, in the page's language", async () => {
        const html = await sheet("ar")
        expect(html.split("<bdi>النور للتجارة</bdi>").length - 1).toBe(2)
        expect(html).toContain("<bdi>حسن عادل</bdi>")
        const english = await sheet("en")
        expect(english.split("<bdi>Al Noor Trading</bdi>").length - 1).toBe(2)
        expect(english).toContain("<bdi>Hassan Adel</bdi>")
    })

    it("a client or an owner with no Arabic name, in English on an Arabic page", async () => {
        const html = await sheet("ar", { id: "beta", name: "Beta Supplies", nameAr: null, ownerName: "Bob Brown", ownerNameAr: null })
        expect(html).toContain("<bdi>Beta Supplies</bdi>")
        expect(html).toContain("<bdi>Bob Brown</bdi>")
    })

    it("names the client in the page's heading and its back link in the page's language", async () => {
        ui.id = "noor"
        ui.swr = { "/api/charges/statement?clientId=noor": { key: "/api/charges/statement?clientId=noor", statement: STATEMENT } }
        const { default: StatementPage } = await import("@/app/(dashboard)/dashboard/clients/[id]/statement/page")
        const html = render(h(StatementPage), "ar")
        expect(html).toContain('<p class="ui-page-subtitle"><bdi>النور للتجارة</bdi></p>')
        expect(html).toMatch(/href="\/dashboard\/clients\/noor"[^>]*>[\s\S]{0,400}<bdi>النور للتجارة<\/bdi>/)
        expect(render(h(StatementPage), "en")).toContain('<p class="ui-page-subtitle"><bdi>Al Noor Trading</bdi></p>')
    })

    it("is given the client's and its owner's names in both languages", async () => {
        const asked: { client?: any } = {}
        prismaMock.client.findUnique = async (query: unknown) => { asked.client = query; return { ...NOOR, companyId: "c1" } }
        prismaMock.company.findUnique = async () => ({ ...COMPANY, timezone: "Africa/Cairo" })
        prismaMock.taskCost.findMany = async () => []
        prismaMock.taskCost.aggregate = async () => ({ _sum: { amount: 0, serviceFee: 0 }, _count: { _all: 0 } })
        prismaMock.listEntry.findMany = async () => []
        const { clientStatement } = await import("@/lib/services/client-statement.service")
        const statement = await clientStatement({ id: "sa", role: "SUPER_ADMIN", companyId: null } as any, { clientId: "noor", from: "2026-10-01", to: "2026-10-31" })
        expect(statement.client).toEqual(NOOR)
        expect(asked.client.select).toMatchObject({ name: true, nameAr: true, ownerName: true, ownerNameAr: true })
    })
})
