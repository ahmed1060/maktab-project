import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"
import { serializeAccess, type Bundle } from "./features/bundles"
import { withGrants } from "./permissions/test-actors"

/**
 * The dashboard, by what the company's package includes (DESIGN.md §5.5,
 * Page layout): a tile, a queue or a section of a module it doesn't include
 * isn't there, and what it would have counted isn't read. It showed a
 * company without HR its bonuses, deductions and day off credit, and one
 * without Company Management its tasks and obligations, with Create new
 * task in its header.
 */

const state = vi.hoisted(() => ({ session: null as unknown, read: [] as string[] }))

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("next/headers", () => ({
    cookies: async () => ({ get: (name: string) => (name === "NEXT_LOCALE" ? { value: "en" } : undefined) }),
    headers: async () => ({ get: () => null }),
}))
vi.mock("@/components/AccessDenied", () => ({ default: () => null }))
vi.mock("@/lib/services/company.service", () => ({ CompanyService: { getBranding: async () => null } }))
// Each read, by its table and kind, so what isn't read can be told.
vi.mock("@/lib/prisma", () => {
    const read = (name: string, answer: unknown) => async () => { state.read.push(name); return answer }
    return {
        prisma: {
            task: {
                groupBy: read("task.groupBy", [{ status: "COMPLETED", _count: 2 }, { status: "PENDING_CONFIRMATION", _count: 1 }]),
                findMany: read("task.findMany", []),
            },
            salaryRecord: {
                aggregate: read("salaryRecord.aggregate", { _sum: { bonusDays: 1, deductions: 2 } }),
                findUnique: read("salaryRecord.findUnique", { bonusDays: 1, deductions: 2 }),
            },
            dayOffRequest: {
                count: read("dayOffRequest.count", 3),
                findFirst: read("dayOffRequest.findFirst", { id: "d1", type: "CASUAL", status: "PENDING", date: new Date("2026-11-10T00:00:00Z"), endDate: null }),
            },
            profileUpdateRequest: { count: read("profileUpdateRequest.count", 4) },
            obligation: { findMany: read("obligation.findMany", []) },
            user: { findUnique: read("user.findUnique", { dayOffCredit: 15, baseDayOffCredit: 21 }) },
            company: { findUnique: read("company.findUnique", null) },
        },
    }
})

type Who = "ADMIN" | "TEAM_LEADER" | "EMPLOYEE"
const ids: Record<Who, string> = { ADMIN: "a1", TEAM_LEADER: "t1", EMPLOYEE: "e1" }
/** Someone at a company whose package is these bundles; none given is a company with no package, which has everything. */
const at = (who: Who, ...bundles: Bundle[]) => ({
    user: {
        ...withGrants({ id: ids[who], role: who, companyId: "c1" }),
        firstName: "Amal",
        ...(bundles.length ? { featureAccess: serializeAccess({ unrestricted: false, bundles: new Set(bundles) }) } : {}),
    },
})

async function home(session: unknown) {
    state.session = session
    state.read = []
    const { default: DashboardPage } = await import("@/app/(dashboard)/dashboard/page")
    return renderToStaticMarkup(await DashboardPage({ searchParams: Promise.resolve({}) }))
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const tile = (label: string) => new RegExp(`<dt>(?:<a [^>]*>)?${esc(label)}(?:</a>)?</dt>`)
const section = (title: string) => `<h2 class="ui-section-title">${title}</h2>`

beforeAll(async () => {
    await import("@/app/(dashboard)/dashboard/page")
}, 120000)
beforeEach(() => { state.read = [] })

describe("the overview, for whoever sees others' tasks", () => {
    it("has every part where the package includes both", async () => {
        for (const session of [at("ADMIN"), at("ADMIN", "COMPANY_MANAGEMENT", "HR")]) {
            const html = await home(session)
            expect(html).toContain('href="/dashboard/tasks/new"')
            for (const label of [en.task_completion, en.team_bonuses, en.team_deductions, en.pending_task_reviews, en.pending_day_off_requests, en.pending_profile_requests]) {
                expect(html).toMatch(tile(label))
            }
            expect(html).toContain(section(en.overdue_tasks))
            expect(html).toContain(section(en.team_workload))
        }
    })

    it("has no bonuses, deductions or day off where the package hasn't HR, and doesn't read them", async () => {
        const html = await home(at("ADMIN", "COMPANY_MANAGEMENT"))
        expect(html).not.toMatch(tile(en.team_bonuses))
        expect(html).not.toMatch(tile(en.team_deductions))
        expect(html).not.toMatch(tile(en.pending_day_off_requests))
        // The rest stays.
        expect(html).toMatch(tile(en.task_completion))
        expect(html).toMatch(tile(en.pending_task_reviews))
        expect(html).toMatch(tile(en.pending_profile_requests))
        expect(state.read).not.toContain("salaryRecord.aggregate")
        expect(state.read).not.toContain("dayOffRequest.count")
    })

    it("has no tasks where the package hasn't Company Management, and doesn't read them", async () => {
        const html = await home(at("ADMIN", "HR"))
        expect(html).not.toContain('href="/dashboard/tasks/new"')
        expect(html).not.toMatch(tile(en.task_completion))
        expect(html).not.toMatch(tile(en.pending_task_reviews))
        expect(html).not.toContain(section(en.overdue_tasks))
        expect(html).not.toContain(section(en.team_workload))
        // The rest stays: adding someone is Core, pay and leave are HR's.
        expect(html).toContain('href="/dashboard/employees/new"')
        expect(html).toMatch(tile(en.team_bonuses))
        expect(html).toMatch(tile(en.pending_day_off_requests))
        expect(html).toMatch(tile(en.pending_profile_requests))
        expect(state.read).not.toContain("task.groupBy")
        expect(state.read).not.toContain("task.findMany")
    })

    it("leaves out a queue section with nothing left in it", async () => {
        // A Team Leader decides neither leave nor name changes, so their one
        // queue was the tasks to review.
        const leader = await home(at("TEAM_LEADER", "HR"))
        expect(leader).not.toContain(section(en.needs_your_review))
        expect(await home(at("TEAM_LEADER", "COMPANY_MANAGEMENT"))).toContain(section(en.needs_your_review))
    })
})

describe("one's own dashboard", () => {
    it("has every part where the package includes both", async () => {
        for (const session of [at("EMPLOYEE"), at("EMPLOYEE", "COMPANY_MANAGEMENT", "HR")]) {
            const html = await home(session)
            for (const label of [en.overall_progress, en.bonus, en.payroll_deductions]) expect(html).toMatch(tile(label))
            for (const title of [en.task_distribution, en.credit_overview, en.due_this_week, en.my_day_off_request]) expect(html).toContain(section(title))
            expect(html).toContain(en.no_obligations_assigned)
        }
    })

    it("has no pay or day off where the package hasn't HR, and doesn't read them", async () => {
        const html = await home(at("EMPLOYEE", "COMPANY_MANAGEMENT"))
        expect(html).not.toMatch(tile(en.bonus))
        expect(html).not.toMatch(tile(en.payroll_deductions))
        expect(html).not.toContain(section(en.credit_overview))
        expect(html).not.toContain(section(en.my_day_off_request))
        // The rest stays.
        expect(html).toMatch(tile(en.overall_progress))
        expect(html).toContain(section(en.task_distribution))
        expect(html).toContain(section(en.due_this_week))
        expect(html).toContain(en.no_obligations_assigned)
        for (const read of ["salaryRecord.findUnique", "user.findUnique", "dayOffRequest.findFirst"]) expect(state.read).not.toContain(read)
    })

    it("has no tasks or obligations where the package hasn't Company Management, and doesn't read them", async () => {
        const html = await home(at("EMPLOYEE", "HR"))
        expect(html).not.toMatch(tile(en.overall_progress))
        expect(html).not.toContain(section(en.task_distribution))
        expect(html).not.toContain(section(en.due_this_week))
        expect(html).not.toContain(en.no_obligations_assigned)
        // The rest stays.
        expect(html).toMatch(tile(en.bonus))
        expect(html).toMatch(tile(en.payroll_deductions))
        expect(html).toContain(section(en.credit_overview))
        expect(html).toContain(section(en.my_day_off_request))
        for (const read of ["task.groupBy", "task.findMany", "obligation.findMany"]) expect(state.read).not.toContain(read)
    })
})
