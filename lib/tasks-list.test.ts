import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * The Tasks list on the building blocks (UI_PLAN.md §5 step 5): its page
 * header, a filter bar, and the tasks as a table on computers and cards on
 * phones (DESIGN.md §5.4), each with where it's done, who it's for, its
 * deadline, its points, its status and what to do next.
 */

const address = { query: "" }
const viewer = { reach: "COMPANY" as string | null, creates: true }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(address.query),
}))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/HeaderContext", () => ({ useHeader: () => ({ setTitle: () => {}, setSubtitle: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Tasks" }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: (p: string) => p !== "tasks.create" || viewer.creates, scope: () => viewer.reach, companyWide: () => viewer.reach === "COMPANY" }),
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
// Its filters' own options aren't what's checked here.
vi.mock("@/components/DateRangePicker", () => ({ default: () => null }))
vi.mock("@/components/locations/usePlaceFilters", () => ({ usePlaceFilters: () => [] }))
vi.mock("@/components/lists/useNameFilter", () => ({ useNameFilter: () => [] }))

const NOW = Date.parse("2026-10-30T12:00:00Z")
const me = { id: "me", firstName: "Tarek", lastName: "Ali" }
const mona = { id: "u2", firstName: "Mona", lastName: "Adel" }
const task = (fields: object = {}) => ({
    id: "t1", title: "Fix the gate", status: "PENDING", difficulty: 3,
    deadline: "2026-11-02T09:00:00Z", createdAt: "2026-10-20T09:00:00Z", updatedAt: "2026-10-20T09:00:00Z",
    assignees: [mona], creator: { firstName: "Hana", lastName: "Said" }, memberCosts: null,
    client: { name: "Al Noor" }, place: { name: "Maadi branch", client: { name: "Al Noor" } }, location: null,
    ...fields,
})

async function tasksList(tasks: ReturnType<typeof task>[], { query = "", view = "active", reach = "COMPANY" as string | null, creates = true } = {}) {
    address.query = query
    viewer.reach = reach
    viewer.creates = creates
    const { default: TasksClient } = await import("@/app/(dashboard)/dashboard/tasks/TasksClient")
    return renderToStaticMarkup(h(TasksClient, { tasks, total: tasks.length, page: 1, totalPages: 1, currentUserId: me.id, view, now: NOW }))
}

describe("the Tasks list", () => {
    it("has the page header, with Create new task as its one primary button for whoever creates tasks", async () => {
        const html = await tasksList([task()])
        expect(html).toContain('class="ui-page-header"')
        expect(html).toContain("tasks_subtitle")
        const header = html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
        expect(header).toContain('href="/dashboard/tasks/new"')
        expect(header).toContain("create_new_task")
        expect(html.match(/ui-btn-primary/g)?.length).toBe(1)
        expect(await tasksList([task()], { creates: false })).not.toContain("create_new_task")
    })

    it("lists each task as a table row and a phone card, its title linking to it, with where it's done", async () => {
        const html = await tasksList([task()])
        expect(html).toContain('<table class="ui-table">')
        expect(html).toContain('class="ui-list-card"')
        expect(html).toContain('href="/dashboard/tasks/t1"')
        expect(html).toContain("Al Noor - Maadi branch")
        expect(html).toContain("count_pts_other")
        expect(html).toContain("status_pending")
        // Not the old glass cards, nor their quick view.
        expect(html).not.toContain("glass-card")
        expect(html).not.toContain("title-button")
    })

    it("marks a task past its deadline and not yet done as overdue, in words", async () => {
        const late = await tasksList([task({ deadline: "2026-10-29T09:00:00Z", status: "IN_PROGRESS" })])
        expect(late).toContain('data-tone="overdue"')
        expect(late).toContain("ui_overdue")
        const done = await tasksList([task({ deadline: "2026-10-29T09:00:00Z", status: "COMPLETED" })])
        expect(done).not.toContain('data-tone="overdue"')
    })

    it("says who assigned their own tasks, and who a task is for otherwise", async () => {
        const mine = await tasksList([task({ assignees: [me] })], { reach: null, view: "my" })
        expect(mine).toContain("assigned_by")
        expect(mine).toContain("Hana Said")
        const team = await tasksList([task()])
        expect(team).toContain("assignees_label")
        expect(team).toContain("Mona Adel")
    })

    it("offers starting a task to whoever it's for, and viewing it to anyone else", async () => {
        expect(await tasksList([task({ assignees: [me] })], { reach: null, view: "my" })).toContain("start_task")
        expect(await tasksList([task({ assignees: [me], status: "IN_PROGRESS" })], { reach: null, view: "my" })).toContain("continue_task")
        expect(await tasksList([task()])).toContain("view_task")
    })

    it("shows each assignee their own cost on a shared task", async () => {
        const html = await tasksList([task({ assignees: [me, mona], memberCosts: { me: 150 } })], { reach: null, view: "my" })
        expect(html).toContain("tasks_my_cost")
        expect(html).toContain("150.00")
    })

    it("gives an employee the search alone, and everyone else the filters", async () => {
        const own = await tasksList([task({ assignees: [me] })], { reach: null, view: "my" })
        expect(own).toContain('class="ui-panel ui-filterbar"')
        expect(own).not.toContain("ui-filterbar-toggle")
        const all = await tasksList([task()])
        expect(all).toContain("ui-filterbar-toggle")
        expect(all).toContain("all_employees")
        expect(all).toContain("all_statuses")
    })

    it("gives a Team Leader their tasks and their team's as tabs, keeping the filters", async () => {
        const html = await tasksList([task()], { reach: "TEAM", view: "active", query: "status=PENDING&view=active&page=2" })
        expect(html).toContain('class="ui-tablinks"')
        expect(html).toContain("my_tasks")
        expect(html).toContain("tasks_tab_team")
        expect(html).toContain('href="/dashboard/tasks?status=PENDING&amp;view=my&amp;page=1"')
        expect(html).toMatch(/aria-current="page"[^>]*>tasks_tab_team/)
        expect(await tasksList([task()])).not.toContain("ui-tablinks")
    })

    it("says why a Team Leader's team list is empty, and offers Reset when filters empty it", async () => {
        const team = await tasksList([], { reach: "TEAM", view: "active" })
        expect(team).toContain("team_empty_title")
        expect(team).toContain("team_empty_body")
        const filtered = await tasksList([], { query: "status=REJECTED" })
        expect(filtered).toContain("tasks_empty_filters")
        expect(filtered).toContain("ui_reset_filters")
        expect(await tasksList([])).toContain("tasks_empty")
    })
})
