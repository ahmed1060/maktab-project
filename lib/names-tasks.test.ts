import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"

/**
 * The tasks screens with each person and client in the page's language
 * (LATER_CHANGES_PLAN.md §3.1, step 8b; PR 413): the tasks list, a task's
 * page, and its sections and dialogs. Each name is in the page's language,
 * or in the one it has while it has only one.
 */

const state = { locale: "en" as "en" | "ar", reach: "COMPANY" as string | null }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }),
    useSearchParams: () => new URLSearchParams(""),
    usePathname: () => "/dashboard/tasks",
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Tasks" }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: () => true, scope: () => state.reach, companyWide: () => state.reach === "COMPANY" }),
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("@/components/DateRangePicker", () => ({ default: () => null }))
vi.mock("@/components/locations/usePlaceFilters", () => ({ usePlaceFilters: () => [] }))
vi.mock("@/components/lists/useNameFilter", () => ({ useNameFilter: () => [] }))
vi.mock("@/components/filters/useEmployeeOptions", () => ({ useEmployeeOptions: () => null }))
vi.mock("@/components/TaskCostsSection", () => ({ default: () => null }))
vi.mock("@/components/TaskLocationHistorySection", () => ({ default: () => null }))
vi.mock("@/components/TaskSubmissionForm", () => ({ default: () => null }))
vi.mock("@/components/TaskEditDetailsModal", () => ({ default: () => null }))
vi.mock("@/components/DiffViewer", () => ({ default: () => null }))

const { placeLine } = await import("@/lib/task-place")
const read = (path: string) => stripComments(readFileSync(path, "utf8"))
const render = (el: ReturnType<typeof h>, locale: "en" | "ar") => { state.locale = locale; return renderToStaticMarkup(el) }

// Made-up people and clients.
const NOW = Date.parse("2026-11-24T12:00:00Z")
const HANA = { id: "u1", firstName: "Hana", lastName: "Saad", firstNameAr: "هناء", lastNameAr: "سعد", status: "ACTIVE", role: "EMPLOYEE" }
const BOB = { id: "u2", firstName: "Bob", lastName: "Brown", firstNameAr: null, lastNameAr: null, status: "DELETED", role: "EMPLOYEE" }
const OMAR = { firstName: "Omar", lastName: "Adel", firstNameAr: "عمر", lastNameAr: "عادل" }
const NOOR = { name: "Al Noor Trading", nameAr: "النور للتجارة" }

describe("the line under a task's title", () => {
    it("names its client, or its location's, in the page's language", () => {
        const task = { client: NOOR, place: { name: "Maadi branch", client: NOOR }, location: null }
        expect(placeLine(task, "ar")).toBe("النور للتجارة - Maadi branch")
        expect(placeLine(task, "en")).toBe("Al Noor Trading - Maadi branch")
        expect(placeLine({ client: NOOR, place: null, location: null }, "ar")).toBe("النور للتجارة")
        expect(placeLine({ client: { name: "Beta Supplies", nameAr: null }, place: null, location: null }, "ar")).toBe("Beta Supplies")
    })
})

describe("the tasks list", () => {
    const row = {
        id: "t1", title: "Count the stock", status: "IN_PROGRESS", difficulty: 2,
        deadline: "2026-11-30T09:00:00Z", createdAt: "2026-11-20T09:00:00Z", updatedAt: "2026-11-20T09:00:00Z",
        assignees: [HANA], creator: OMAR, memberCosts: null, client: NOOR, place: { name: "Maadi branch", client: NOOR }, location: null,
    }
    const list = async (locale: "en" | "ar", reach: string | null) => {
        state.reach = reach
        const { default: TasksClient } = await import("@/app/(dashboard)/dashboard/tasks/TasksClient")
        return render(h(TasksClient, { tasks: [row], total: 1, page: 1, totalPages: 1, currentUserId: "u1", view: "active", now: NOW }), locale)
    }

    it("names who each task is for in the page's language", async () => {
        expect(await list("ar", "COMPANY")).toContain("هناء سعد")
        expect(await list("en", "COMPANY")).toContain("Hana Saad")
    })

    it("on one's own list, who assigned it, in the page's language", async () => {
        expect(await list("ar", null)).toContain("عمر عادل")
        expect(await list("en", null)).toContain("Omar Adel")
    })

    it("and the client in the line under its title, in its table row and its card", async () => {
        const times = (html: string, text: string) => html.split(text).length - 1
        expect(times(await list("ar", "COMPANY"), "النور للتجارة - Maadi branch")).toBe(2)
        expect(times(await list("en", "COMPANY"), "Al Noor Trading - Maadi branch")).toBe(2)
    })

    it("is given each name in Arabic", () => {
        const page = read("app/(dashboard)/dashboard/tasks/page.tsx")
        expect(page).toContain("assignees: { select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } },")
        expect(page).toContain("creator: { select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true } },")
        expect(page).toContain("client: { select: { name: true, nameAr: true } },")
        expect(page).toContain("place: { select: { name: true, client: { select: { name: true, nameAr: true } } } },")
    })
})

describe("a task's page", () => {
    const task = {
        id: "t1", title: "Count the stock", description: "Count what is on the shelves.",
        status: "IN_PROGRESS", difficulty: 2, deadline: "2026-11-30T09:00:00Z", companyId: "c1",
        assignees: [HANA, BOB], attachments: [], comments: [], costs: [], isEdited: false,
        totalCost: 0, paymentStatus: "PENDING_PAYMENT", memberCosts: null, memberPaymentStatus: null,
        client: NOOR, clientId: "k1", place: { name: "Maadi branch", latitude: 29.96, longitude: 31.25, client: NOOR },
        location: null, locationId: "l1", lastStatusUpdateBy: null,
    }
    const page = async (locale: "en" | "ar", fields: object = {}) => {
        state.reach = "COMPANY"
        const { default: TaskDetailClient } = await import("@/app/(dashboard)/dashboard/tasks/[id]/client")
        return render(h(TaskDetailClient, { task: { ...task, ...fields }, now: NOW, isRestricted: false, userRole: "ADMIN", userId: "admin", creator: OMAR, currentUserName: "Admin" }), locale)
    }

    it("names who it's for, and who assigned it, in the page's language", async () => {
        const html = await page("ar")
        expect(html).toContain("هناء سعد")
        expect(html).toContain("<bdi>عمر عادل</bdi>")
        expect(await page("en")).toContain("<bdi>Omar Adel</bdi>")
    })

    it("says so when someone it's for was deleted, by their name in the page's language", async () => {
        expect(await page("ar", { assignees: [{ ...HANA, status: "DELETED" }] })).toContain(ar.task_assignee_deleted_msg.replace("{name}", "هناء سعد"))
        expect(await page("en", { assignees: [{ ...HANA, status: "DELETED" }] })).toContain(en.task_assignee_deleted_msg.replace("{name}", "Hana Saad"))
    })

    it("names its location's client in the page's language", async () => {
        expect(await page("ar")).toContain("<bdi>النور للتجارة - Maadi branch</bdi>")
        expect(await page("en")).toContain("<bdi>Al Noor Trading - Maadi branch</bdi>")
    })

    it("and its client, where its location isn't the client's", async () => {
        const shared = { place: { name: "Head office", latitude: 30, longitude: 31, client: null } }
        expect(await page("ar", shared)).toContain("<bdi>النور للتجارة</bdi>")
        expect(await page("en", shared)).toContain("<bdi>Al Noor Trading</bdi>")
    })

    it("is given each name in Arabic, and who assigned it in both", () => {
        const server = read("app/(dashboard)/dashboard/tasks/[id]/page.tsx")
        expect(server).toContain("select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true, status: true, role: true }")
        expect(server).toContain("place: { select: { name: true, latitude: true, longitude: true, client: { select: { name: true, nameAr: true } } } },")
        expect(server).toContain("select: { firstName: true, lastName: true, firstNameAr: true, lastNameAr: true }")
        expect(server).toContain("creator={creator}")
    })
})

describe("its sections and dialogs", () => {
    it("Edit details names who it's for and its location's client in the page's language", () => {
        const modal = read("components/TaskEditDetailsModal.tsx")
        expect(modal).toContain("const names = (task.assignees ?? []).map((a: any) => personName(a, locale))")
        expect(modal).toContain("label: locationLabel(task.place.name, task.place.client ? clientName(task.place.client, locale) : undefined)")
    })

    it("the costs' settlements name each person in the page's language", () => {
        expect(read("components/TaskCostsSection.tsx")).toContain("<span className=\"ui-item-title\"><bdi>{personName(assignee, locale)}</bdi></span>")
    })

    it("the penalty's people are named in the page's language", () => {
        expect(read("components/TaskLocationHistorySection.tsx")).toContain("options={(task.assignees ?? []).map((a: any) => ({ value: a.id, label: personName(a, locale) }))}")
    })

    it("Transfer's lines on the money held name each person in the page's language", () => {
        const dialog = read("components/TaskTransferModal.tsx")
        expect(dialog).toContain("name: <bdi>{personName(m.person, locale)}</bdi>,")
        expect(dialog).toContain("to: <bdi>{m.to ? personName(m.to, locale) : ''}</bdi>,")
    })

    it("from each person's names in both languages", () => {
        const advances = read("lib/services/cash-advance.service.ts")
        expect(advances).toContain("where: { id: { in: [...new Set([...held.map(h => h.userId), ...next])] }, companyId }, select: { id: true, firstName: true, lastName: true, firstNameAr: true, lastNameAr: true, teamLeaderId: true, status: true },")
        expect(advances).toContain("const named = (id: string) => ({ id, ...namesOf(people.get(id)) })")
    })
})
