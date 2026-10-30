import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Create task on the building blocks (UI_PLAN.md §5 step 5): its page header
 * with the way back to the Tasks list and the Excel tools, and the form's
 * fields, each with its visible label, its hint and its error in place
 * (DESIGN.md §5.3), with Create task as the page's one primary button.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Tasks" }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "admin", role: "ADMIN" } } }) }))
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: () => true }) }))
vi.mock("@/components/lists/useListNames", () => ({ useListNames: () => ({ suggest: async () => [] }) }))
vi.mock("@/components/locations/TaskPlacePicker", () => ({ default: () => null }))
vi.mock("@/components/BulkTaskReviewModal", () => ({ default: () => null }))
vi.mock("@/components/ManageTemplatesModal", () => ({ default: () => null }))
const people = { list: [] as object[] | null }
vi.mock("swr", () => ({
    default: (key: string | null) => ({ data: key?.startsWith("/api/users") && people.list ? { data: { data: people.list } } : undefined }),
}))

async function form(list: object[] | null = []) {
    people.list = list
    const { default: NewTaskPage } = await import("@/app/(dashboard)/dashboard/tasks/new/page")
    return renderToStaticMarkup(h(NewTaskPage))
}

describe("Create task", () => {
    it("has the page header, with the way back to the Tasks list and the Excel tools beside it", async () => {
        const html = await form()
        const header = html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
        expect(header).toContain("create_new_task")
        expect(header).toContain('href="/dashboard/tasks"')
        expect(header).toContain("download_template")
        expect(header).toContain("upload_tasks_excel")
        expect(header).toContain('href="/dashboard/usernames"')
        // None of them is the page's main action.
        expect(header).not.toContain("ui-btn-primary")
    })

    it("labels every field, with how much of a title and description is used", async () => {
        const html = await form()
        for (const label of ["title_label", "description_label", "assignees_label", "deadline_label", "difficulty"]) {
            expect(html).toMatch(new RegExp(`class="ui-label"[^>]*>${label}<`))
        }
        expect(html.match(/ui_characters_used/g)?.length).toBe(2)
        expect(html).toContain("tasks_points_hint")
    })

    it("picks the deadline from a field like the others", async () => {
        const html = await form()
        expect(html).toContain('class="ui-input ui-date-trigger"')
        expect(html).toContain("select_deadline")
    })

    it("lists who can be assigned as checkboxes, with their roles, below a search", async () => {
        const html = await form([
            { id: "u1", firstName: "Mona", lastName: "Adel", role: "EMPLOYEE", username: "mona" },
            { id: "u2", firstName: "Rania", lastName: "Fahmy", role: "TEAM_LEADER", username: "rania" },
        ])
        expect(html).toContain('class="ui-checklist"')
        expect(html.match(/type="checkbox"/g)?.length).toBe(2)
        expect(html).toContain("Mona Adel")
        expect(html).toContain("role_team_leader")
        expect(html).toContain("tasks_assignee_search")
    })

    it("says it's loading the people rather than that there are none", async () => {
        expect(await form(null)).toContain("loading")
    })

    it("has Create task as its one primary button, and Cancel back to the list", async () => {
        const html = await form()
        expect(html.match(/ui-btn-primary/g)?.length).toBe(1)
        expect(html).toMatch(/<button type="submit" class="ui-btn ui-btn-primary[^"]*"[^>]*>.*create_task_button/)
        expect(html).toMatch(/href="\/dashboard\/tasks"[^>]*>cancel</)
        expect(html).not.toContain('class="card"')
        expect(html).not.toContain("veil-")
    })
})
