import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"

/**
 * Add obligation on the building blocks (UI_PLAN.md §5 step 5), as Create
 * task is (lib/new-task-form.test.ts): its page header with the way back,
 * and the form's fields, each with its visible label, hint and error
 * (DESIGN.md §5.3), with Create obligation as its one primary button.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Obligations" }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { id: "admin", role: "ADMIN" } } }) }))
const viewer = { manages: true }
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({ can: () => viewer.manages }),
    permissionsOf: () => ({ can: () => true, companyWide: () => true }),
}))
vi.mock("@/components/AccessDenied", () => ({ default: () => "access-denied" }))

async function form(manages = true) {
    viewer.manages = manages
    const { default: NewObligationPage } = await import("@/app/(dashboard)/dashboard/obligations/new/page")
    return renderToStaticMarkup(h(NewObligationPage))
}

describe("Add obligation", () => {
    it("has the page header, with the way back to the Obligations list", async () => {
        const html = await form()
        const header = html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
        expect(header).toContain("add_obligation")
        expect(header).toContain('href="/dashboard/obligations"')
    })

    it("labels every field, with how much of a title and description is used", async () => {
        const html = await form()
        for (const label of ["title_label", "description_label", "assignees_label", "deadline_label", "recurrence_label", "difficulty"]) {
            expect(html).toMatch(new RegExp(`class="ui-label"[^>]*>${label}<`))
        }
        expect(html.match(/ui_characters_used/g)?.length).toBe(2)
        expect(html).toContain('class="ui-input ui-date-trigger"')
    })

    it("names its fields, keeps autofill out of them, and lets a title run in its own direction (web interface audit)", async () => {
        const html = await form()
        const input = (name: string) => html.match(new RegExp(`<(input|textarea)[^>]*name="${name}"[^>]*>`))?.[0] ?? ""
        expect(input("title")).toMatch(/autocomplete="off"/i)
        expect(input("title")).toContain('dir="auto"')
        expect(input("description")).toContain('dir="auto"')
        expect(input("difficulty")).toMatch(/autocomplete="off"/i)
    })

    it("picks how often it recurs from radio buttons, one time to begin with", async () => {
        const html = await form()
        expect(html).toContain('class="ui-choices"')
        expect(html.match(/type="radio"/g)?.length).toBe(4)
        const oneTime = html.match(/<input[^>]*value="ONE_TIME"[^>]*>/)?.[0] ?? ""
        expect(oneTime).toContain('type="radio"')
        expect(oneTime).toContain("checked")
    })

    it("lists who can be assigned below a search, loading first", async () => {
        const html = await form()
        expect(html).toContain('class="ui-checklist"')
        expect(html).toContain("assignees_search")
        expect(html).toContain("loading")
    })

    it("says when the people couldn't be loaded, rather than that no one matches", () => {
        // The list is tried again first (fetchRetrying), and its last answer
        // given back: a server error is an answer, not a thrown one, and read
        // as an empty list it said no one matched the search.
        const page = readFileSync("app/(dashboard)/dashboard/obligations/new/page.tsx", "utf8")
        expect(page).toMatch(/fetchRetrying\(`\/api\/users\?\$\{queryParams\.toString\(\)\}`\)\s*\.then\(res => \{\s*if \(!res\.ok\) throw/)
        expect(page).toContain(".catch(() => setPeople('failed'))")
        expect(page).toContain("onRetry={() => { setRetrying(true); setTries(n => n + 1) }}")
    })

    it("has Create obligation as its one primary button, and Cancel back to the list", async () => {
        const html = await form()
        expect(html.match(/ui-btn-primary/g)?.length).toBe(1)
        expect(html).toMatch(/<button type="submit" class="ui-btn ui-btn-primary[^"]*"[^>]*>.*create_obligation_button/)
        expect(html).toMatch(/href="\/dashboard\/obligations"[^>]*>cancel</)
        expect(html).not.toContain('class="card"')
    })

    it("tells someone who may not create one so", async () => {
        expect(await form(false)).toBe("access-denied")
    })

    it("asks before leaving with something typed, and checks who it's for and when before sending", () => {
        const page = readFileSync("app/(dashboard)/dashboard/obligations/new/page.tsx", "utf8")
        expect(page).toContain("window.addEventListener('beforeunload', warn)")
        expect(page).toContain("errors.assigneeIds = t('assignees_required')")
        expect(page).toContain("errors.deadline = t('deadline_required')")
    })

    it("writes the description's limits in Arabic digits in Arabic", () => {
        expect(ar.obligation_description_validation).toContain("١٠ و ٥٠٠")
    })
})

describe("the people checklist that couldn't load", () => {
    async function checklist(retrying = false) {
        const { default: AssigneeChecklist } = await import("@/components/forms/AssigneeChecklist")
        return renderToStaticMarkup(h(AssigneeChecklist, { people: null, value: [], onChange: () => {}, onRetry: () => {}, retrying }))
    }

    it("says so with a warning and Try again, as a list that didn't load does (DESIGN.md §5.5)", async () => {
        const html = await checklist()
        expect(html).toContain('class="ui-empty"')
        expect(html).toContain('role="alert">failed_load_employees<')
        expect(html).toMatch(/<button type="button" class="ui-btn[^"]*"[^>]*>.*try_again/)
        expect(html).not.toContain("assignees_none_match")
    })

    it("shows Try again busy while it tries", async () => {
        expect(await checklist(true)).toContain('aria-busy="true"')
    })
})
