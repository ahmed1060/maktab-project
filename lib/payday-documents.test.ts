import { describe, it, expect, vi, beforeEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { state as access, prismaMock, url, as } from "./permissions/employee-access.harness"

/**
 * The attendance period on the documents (LATER_CHANGES_PLAN.md §7.10, 10c
 * and 10e, PR 430): a payslip that carried attendance says which days it
 * counts, its period rather than its month; and a leaver's settlement has a
 * line for their attendance after the leaving month's payroll closed.
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
    usePathname: () => `/dashboard/documents/${ui.id}`,
}))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("swr", () => ({
    default: (key: string | null) => {
        const found = key ? Object.entries(ui.swr).find(([start]) => key.startsWith(start))?.[1] : undefined
        return { data: found, error: undefined, isLoading: false, isValidating: false, mutate: async () => {} }
    },
}))

const render = (el: ReturnType<typeof h>, locale: "en" | "ar") => { ui.locale = locale; return renderToStaticMarkup(el) }
const body = async (res: Response) => (await res.json()).data

// A made-up person and company.
const HANA = { firstName: "Hana", lastName: "Saad", firstNameAr: "هناء", lastNameAr: "سعد" }
const COMPANY = { name: "Nile Works", nameAr: "أعمال النيل", logoUrl: null }

beforeEach(() => { ui.swr = {}; ui.locale = "en" })

describe("a payslip", () => {
    const run = (fields: object) => ({ month: 11, year: 2026, status: "APPROVED", payrollDay: 1, paidAt: null, company: { id: "c1", payslipsVisible: false, ...COMPANY }, ...fields })
    const fetchIt = async (fields: object) => {
        prismaMock.payslip.findUnique = async () => ({
            id: "p1", userId: "u1", daysPaid: 30, excluded: false, exclusionReason: null, emailedAt: null,
            earningsAmount: 1000, deductionsAmount: 0, netAmount: 1000, carriedAmount: 0, lines: [],
            user: { id: "u1", email: "hana@example.com", companyId: "c1", ...HANA },
            payrollRun: run(fields),
        })
        as("admin")
        return body(await (await import("@/app/api/payslips/[id]/route")).GET(new Request(url("/api/payslips/p1")), { params: Promise.resolve({ id: "p1" }) }))
    }
    const period = { attendanceIncluded: true, periodStart: new Date("2026-10-25T00:00:00Z"), periodEnd: new Date("2026-11-24T00:00:00Z") }

    it("is given its attendance's days where it carried attendance, and none where it didn't", async () => {
        expect((await fetchIt(period)).attendancePeriod).toEqual({ from: "2026-10-25", to: "2026-11-24" })
        expect((await fetchIt({ ...period, attendanceIncluded: false })).attendancePeriod).toBeNull()
        expect((await fetchIt({ attendanceIncluded: true, periodStart: null, periodEnd: null })).attendancePeriod).toBeNull()
    })

    it("says them under the month, in the page's language", async () => {
        ui.id = "p1"
        const doc = await fetchIt(period)
        ui.swr = { "/api/payslips/p1": { data: doc } }
        const { default: PayslipPage } = await import("@/app/(dashboard)/dashboard/documents/payslip/[id]/page")
        const english = render(h(PayslipPage), "en")
        expect(english).toContain(">Attendance<")
        expect(english).toContain("25 October to 24 November")
        const arabic = render(h(PayslipPage), "ar")
        expect(arabic).toContain(`>${ar.doc_attendance}<`)
        expect(arabic).toContain("٢٥ أكتوبر")
        ui.swr = { "/api/payslips/p1": { data: { ...doc, attendancePeriod: null } } }
        expect(render(h(PayslipPage), "en")).not.toContain(">Attendance<")
    })
})

describe("a settlement", () => {
    const fetchIt = async (attendanceAmount: number) => {
        prismaMock.finalSettlement.findUnique = async () => ({
            id: "s1", companyId: "c1", lastWorkingDay: new Date("2026-11-27T00:00:00Z"),
            earnedAmount: 3000, paidAmount: 1000, netAmount: 2000 + attendanceAmount, debtRecoveredAmount: 0, attendanceAmount,
            user: { email: "hana@example.com", ...HANA }, company: { id: "c1", ...COMPANY },
        })
        as("admin")
        return body(await (await import("@/app/api/settlements/[id]/route")).GET(new Request(url("/api/settlements/s1")), { params: Promise.resolve({ id: "s1" }) }))
    }
    const page = async (attendanceAmount: number, locale: "en" | "ar" = "en") => {
        ui.id = "s1"
        ui.swr = { "/api/settlements/s1": { data: await fetchIt(attendanceAmount) } }
        const { default: SettlementPage } = await import("@/app/(dashboard)/dashboard/documents/settlement/[id]/page")
        return render(h(SettlementPage), locale)
    }

    it("is given the leaver's attendance after the leaving month's payroll closed", async () => {
        expect((await fetchIt(-150)).attendance).toBe(-150)
    })

    it("has a line for it, taken off where it's a deduction, and none where there's nothing", async () => {
        expect(await page(120)).toContain(en.doc_attendance_after_close)
        expect(await page(-150, "ar")).toContain(ar.doc_attendance_after_close)
        expect(await page(0)).not.toContain(en.doc_attendance_after_close)
    })
})
