import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The obligations screens with each person in the page's language
 * (LATER_CHANGES_PLAN.md §3.1, step 8d; PR 415): the obligations list, and
 * an obligation's page. Each name is in the page's language, or in the one
 * it has while it has only one.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Obligations" }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: () => true, companyWide: () => true, scope: () => "COMPANY" }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("@/components/DateRangePicker", () => ({ default: () => null }))
vi.mock("@/components/filters/useEmployeeOptions", () => ({ useEmployeeOptions: () => null }))

const read = (path: string) => stripComments(readFileSync(path, "utf8"))
const render = (el: ReturnType<typeof h>, locale: "en" | "ar") => { state.locale = locale; return renderToStaticMarkup(el) }

// Made-up people.
const NOW = Date.parse("2026-11-24T12:00:00Z")
const HANA = { id: "u1", firstName: "Hana", lastName: "Saad", firstNameAr: "هناء", lastNameAr: "سعد", status: "ACTIVE" }
const OMAR = { firstName: "Omar", lastName: "Adel", firstNameAr: "عمر", lastNameAr: "عادل" }

describe("the obligations list", () => {
    const row = {
        id: "o1", title: "Renew the trade licence", status: "PENDING", difficulty: 2, recurrence: "YEARLY",
        deadline: "2026-12-15T09:00:00Z", createdAt: "2026-11-01T09:00:00Z", updatedAt: "2026-11-01T09:00:00Z",
        lastStatusUpdateBy: null, assignees: [HANA],
    }
    const list = async (locale: "en" | "ar") => {
        const { default: ObligationsClient } = await import("@/app/(dashboard)/dashboard/obligations/ObligationsClient")
        return render(h(ObligationsClient, { obligations: [row], total: 1, page: 1, totalPages: 1, currentUserId: "me", now: NOW }), locale)
    }

    it("names who each obligation is for in the page's language", async () => {
        expect(await list("ar")).toContain("هناء سعد")
        expect(await list("en")).toContain("Hana Saad")
    })

    it("is given each name in Arabic", () => {
        expect(read("app/(dashboard)/dashboard/obligations/page.tsx")).toContain("assignees: { select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } },")
    })
})

describe("an obligation's page", () => {
    const obligation = {
        id: "o1", title: "Renew the fire licence", description: "Take the papers to the civil defence office.",
        status: "IN_PROGRESS", difficulty: 3, recurrence: "MONTHLY", companyId: "c1",
        deadline: "2026-12-02T09:00:00Z", createdAt: "2026-11-20T09:00:00Z",
        assignees: [HANA], attachments: null, lastStatusUpdateBy: null,
    }
    const page = async (locale: "en" | "ar", fields: object = {}) => {
        const { default: ObligationDetailClient } = await import("@/app/(dashboard)/dashboard/obligations/[id]/client")
        return render(h(ObligationDetailClient, { obligation: { ...obligation, ...fields }, now: NOW, userRole: "ADMIN", userId: "admin", userName: "Admin", creator: OMAR, creatorUnknown: false }), locale)
    }

    it("names who it's for, and who assigned it, in the page's language", async () => {
        const html = await page("ar")
        expect(html).toContain("هناء سعد")
        expect(html).toContain("<bdi>عمر عادل</bdi>")
        const english = await page("en")
        expect(english).toContain("Hana Saad")
        expect(english).toContain("<bdi>Omar Adel</bdi>")
    })

    it("says so when someone it's for was deleted, by their name in the page's language", async () => {
        const deleted = { assignees: [{ ...HANA, status: "DELETED" }] }
        expect(await page("ar", deleted)).toContain(ar.obligation_assignee_deleted_msg.replace("{name}", "هناء سعد"))
        expect(await page("en", deleted)).toContain(en.obligation_assignee_deleted_msg.replace("{name}", "Hana Saad"))
    })

    it("is given each name in Arabic, and who assigned it in both", () => {
        const server = read("app/(dashboard)/dashboard/obligations/[id]/page.tsx")
        expect(server).toContain("select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true, status: true }")
        expect(server).toContain("select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true }")
        expect(server).toContain("creator={creator}")
    })
})
