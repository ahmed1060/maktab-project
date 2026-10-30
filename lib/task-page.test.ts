import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * A task's page on the building blocks (UI_PLAN.md §5 step 5), as an
 * obligation's is (lib/obligation-page.test.ts): its page header with its
 * status and a manager's decision, its notices, its details, its notes and
 * its files, each in its own block (DESIGN.md §5.5). Its costs, location
 * history and submission form keep their own blocks for now, and are told
 * when the deadline has locked them.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {}, back: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Tasks" }) }))
const viewer = { manager: true, reach: "COMPANY" as "COMPANY" | "TEAM" }
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({
        can: () => viewer.manager,
        companyWide: () => viewer.manager && viewer.reach === "COMPANY",
        scope: () => viewer.manager ? viewer.reach : null,
    }),
}))
// Their own blocks, for the next step: here, only whether they're locked.
vi.mock("@/components/TaskCostsSection", () => ({ default: (p: { locked?: boolean }) => `[costs locked=${!!p.locked}]` }))
vi.mock("@/components/TaskLocationHistorySection", () => ({ default: (p: { locked?: boolean }) => `[locations locked=${!!p.locked}]` }))
vi.mock("@/components/TaskSubmissionForm", () => ({ default: (p: { locked?: boolean }) => `[submission locked=${!!p.locked}]` }))
vi.mock("@/components/TaskEditDetailsModal", () => ({ default: () => null }))
vi.mock("@/components/DiffViewer", () => ({ default: () => null }))

const NOW = Date.parse("2026-10-30T12:00:00Z")
const mona = { id: "u2", firstName: "Mona", lastName: "Adel", status: "ACTIVE", role: "EMPLOYEE" }
const task = (fields: object = {}) => ({
    id: "t1", title: "Fix the gate", description: "The east gate sticks when it rains.",
    status: "IN_PROGRESS", difficulty: 3, deadline: "2026-11-02T09:00:00Z", companyId: "c1",
    assignees: [mona], attachments: [], comments: [], costs: [], isEdited: false,
    totalCost: 0, paymentStatus: "PENDING_PAYMENT", memberCosts: null, memberPaymentStatus: null,
    client: { name: "Al Noor" }, clientId: "cl1", place: { name: "Maadi branch", latitude: 29.96, longitude: 31.25, client: { name: "Al Noor" } },
    location: null, locationId: "l1", lastStatusUpdateBy: null,
    ...fields,
})

type Who = "manager" | "assignee" | "superAdmin" | "leader"
async function page(t: ReturnType<typeof task>, who: Who = "manager", isRestricted = false) {
    viewer.manager = who !== "assignee"
    viewer.reach = who === "leader" ? "TEAM" : "COMPANY"
    const { default: TaskDetailClient } = await import("@/app/(dashboard)/dashboard/tasks/[id]/client")
    return renderToStaticMarkup(h(TaskDetailClient, {
        task: t, now: NOW, isRestricted,
        userRole: who === "superAdmin" ? "SUPER_ADMIN" : who === "assignee" ? "EMPLOYEE" : "ADMIN",
        userId: who === "assignee" ? mona.id : "admin", creatorName: "Hana Saad", currentUserName: "Hana Saad",
    }))
}
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))
const client = () => readFileSync("app/(dashboard)/dashboard/tasks/[id]/client.tsx", "utf8")

describe("a task's page", () => {
    it("has the page header: its title and status, and the way back to the list", async () => {
        const top = header(await page(task()))
        expect(top).toContain("Fix the gate")
        expect(top).toContain('class="ui-badge ui-badge-progress"')
        expect(top).toContain("status_in_progress")
        expect(top).toContain('href="/dashboard/tasks"')
        expect(await page(task())).not.toContain('class="card')
    })

    it("says who decided it, by their name, once it's decided, and whether its costs are paid", async () => {
        const decided = header(await page(task({ status: "APPROVED", lastStatusUpdateBy: "ADMIN Hana Saad", totalCost: 150 })))
        expect(decided).toContain("list_status_by")
        expect(decided).toContain("task_payment_pending")
        expect(header(await page(task({ status: "APPROVED", totalCost: 150, paymentStatus: "PAID" })))).toContain("task_payment_paid")
        expect(header(await page(task()))).not.toContain("list_status_by")
    })

    it("lists its details: where, for which client, who assigned it, its deadline, its points and who it's for", async () => {
        const html = await page(task({ place: { name: "Maadi branch", latitude: 29.96, longitude: 31.25, client: null } }))
        expect(html).toContain('class="ui-prose"')
        expect(html).toContain("The east gate sticks when it rains.")
        for (const label of ["task_location", "client_label", "assigned_by", "deadline_label", "points_label_plural", "assignees_label"]) {
            expect(html).toContain(`<dt>${label}</dt>`)
        }
        expect(html).toContain("https://www.google.com/maps")
        expect(html).toContain("ui_opens_new_tab")
        expect(html).toContain("Al Noor")
        expect(html).toContain("count_pts_other")
        expect(html).toContain("Mona Adel")
    })

    it("marks a deadline that has passed, while it's still to be done", async () => {
        expect(await page(task({ deadline: "2026-10-29T09:00:00Z" }))).toContain('data-overdue="true"')
        expect(await page(task({ deadline: "2026-10-29T09:00:00Z", status: "APPROVED" }))).not.toContain('data-overdue="true"')
    })

    it("shows its files as chips, and its notes newest first", async () => {
        const html = await page(task({
            attachments: [{ name: "gate.jpg", url: "https://files.test/gate.jpg", uploadedById: "u2" }],
            comments: [
                { type: "SUBMISSION_NOTE", text: "Oiled the hinge.", author: "Mona Adel", authorId: "u2", date: "2026-10-29T09:00:00Z" },
                { type: "SUBMISSION_NOTE", text: "Still sticks.", author: "Mona Adel", authorId: "u2", date: "2026-10-30T09:00:00Z" },
            ],
        }))
        expect(html).toContain('class="ui-files"')
        expect(html).toContain('href="https://files.test/gate.jpg"')
        expect(html).toContain('class="ui-notes"')
        expect(html.indexOf("Still sticks.")).toBeLessThan(html.indexOf("Oiled the hinge."))
        expect(await page(task())).toContain("no_attachments_msg")
    })

    it("says an edit in its notes in words, and closes the changes it shows with a button (web interface audit)", async () => {
        const html = await page(task({ comments: [{ type: "TASK_EDITED", author: "Hana Saad", date: "2026-10-29T09:00:00Z", changes: {} }] }))
        expect(html).toMatch(/class="ui-note-text[^"]*"[^>]*>task_log_edited</)
        const src = client()
        const diff = src.slice(src.indexOf("open={!!diffField}"), src.indexOf("<TaskEditDetailsModal"))
        expect(diff).toContain("actions={<Button onClick={() => setDiffField(null)}>{t('close')}</Button>}")
        expect(en.comments_notes_title).toBe("Notes")
    })
})

describe("its assignee", () => {
    it("works on it in the submission form, and may take off their own file", async () => {
        const html = await page(task({ attachments: [{ name: "gate.jpg", url: "https://files.test/gate.jpg", uploadedById: "u2" }] }), "assignee")
        expect(html).toContain("[submission locked=false]")
        expect(html).toContain('aria-label="ui_remove_file"')
        expect(html).not.toContain("approve_button")
        expect(html).not.toContain("ui_more_actions")
    })

    it("past its deadline, is told so, and everything that adds to it or takes from it is locked, in every block", async () => {
        const html = await page(task({ deadline: "2026-10-29T09:00:00Z", attachments: [{ name: "gate.jpg", url: "https://files.test/gate.jpg", uploadedById: "u2" }] }), "assignee")
        expect(html).toContain("[submission locked=true]")
        expect(html).toContain("[costs locked=true]")
        expect(html).toContain("[locations locked=true]")
        expect(html).not.toContain('aria-label="ui_remove_file"')
        // No longer a pop-up caught from any click on the page by its words.
        expect(client()).not.toContain("document.addEventListener('click'")
        expect(readFileSync("components/TaskConfirmModals.tsx", "utf8")).not.toContain("deadline-modal-content")
    })

    it("once it's handed in, is told it waits for review", async () => {
        const html = await page(task({ status: "PENDING_CONFIRMATION" }), "assignee")
        expect(html).toContain("pending_confirmation_msg")
        expect(html).not.toContain("[submission")
    })

    it("is told when the task was changed, and can see what changed", async () => {
        const changed = task({ isEdited: true, comments: [{ type: "TASK_EDITED", author: "Hana Saad", date: "2026-10-29T09:00:00Z", changes: { title: { from: "Fix gate", to: "Fix the gate" } } }] })
        const html = await page(changed, "assignee")
        expect(html).toContain("task_updated_alert")
        expect(html).toContain("task_see_title_changes")
        expect(html).toContain("i_understand_button")
        expect(client()).toMatch(/action\.run\('dismiss', handleDismiss\)/)
    })

    it("says they've seen the change to the route that records it, and keeps the notice if it isn't recorded", () => {
        // I understand posted to /dismiss-edit, which isn't a route: the 404
        // was let pass, the notice hid itself, and came back at the next visit.
        const src = client()
        const dismiss = src.slice(src.indexOf("const handleDismiss"), src.indexOf("const handleUpload"))
        expect(dismiss).toContain("fetch(`/api/tasks/${task.id}/acknowledge`, { method: 'PUT' })")
        expect(dismiss).not.toContain("dismiss-edit")
        expect(dismiss.indexOf("if (!res.ok)")).toBeLessThan(dismiss.indexOf("setIsEditedPersistent(false)"))
    })
})

describe("a manager", () => {
    it("approves or rejects one handed in, from the page header", async () => {
        const top = header(await page(task({ status: "PENDING_CONFIRMATION" })))
        expect(top).toMatch(/ui-btn-primary[^>]*>.*approve_button/)
        expect(top).toContain("reject_button")
        expect(header(await page(task()))).not.toContain("approve_button")
    })

    it("edits it from the page header while it's being worked on", async () => {
        expect(header(await page(task()))).toContain("edit_task_button")
        expect(header(await page(task({ status: "APPROVED" })))).not.toContain("edit_task_button")
    })

    it("transfers it, marks it paid, returns it to in progress or deletes it from More actions", async () => {
        expect(await page(task())).toContain('aria-label="ui_more_actions_for"')
        const src = client()
        expect(src).toContain("label: t('transfer_to_another_employee')")
        expect(src).toContain("companyWide('tasks.pay') && (")
        expect(src).toContain("label: t('return_to_in_progress')")
        expect(src).toContain("label: t('delete_task_button'), danger: true")
    })

    it("is told when someone it's for was deleted, and can transfer it", async () => {
        const html = await page(task({ assignees: [{ ...mona, status: "DELETED" }] }))
        expect(html).toContain("assignee_deleted_alert")
        expect(html).toContain("task_assignee_deleted_msg")
        expect(html).toContain("transfer_to_another_employee")
        expect(await page(task({ assignees: [{ ...mona, status: "DELETED" }], status: "APPROVED" }))).not.toContain("assignee_deleted_alert")
    })

    it("transfers it with the shared people checklist, in a dialog of the building blocks", () => {
        const transfer = readFileSync("components/TaskTransferModal.tsx", "utf8")
        expect(transfer).toContain("<AssigneeChecklist")
        expect(transfer).toContain("<Dialog")
        expect(transfer).not.toContain("@/components/Modal")
        const confirms = readFileSync("components/TaskConfirmModals.tsx", "utf8")
        expect(confirms).not.toContain("@/components/Modal")
        expect(confirms).toMatch(/action\.run\('item', onConfirmDeleteItem\)/)
    })
})

describe("a task that isn't there", () => {
    it("says so on a page with the way back, not a bare line", async () => {
        const { TaskNotFound } = await import("@/app/(dashboard)/dashboard/tasks/[id]/client")
        const html = renderToStaticMarkup(h(TaskNotFound))
        expect(html).toContain('class="ui-page-header"')
        expect(html).toContain('href="/dashboard/tasks"')
        expect(html).toContain("task_not_found")
        expect(readFileSync("app/(dashboard)/dashboard/tasks/[id]/page.tsx", "utf8")).not.toContain("<div>Task not found</div>")
    })
})

describe("its words", () => {
    it("are in sentence case (DESIGN.md §3.4)", () => {
        for (const key of ["task_details", "transfer_task_title", "transfer_to_another_employee", "delete_task_title", "delete_task_button", "edit_task_button", "i_understand_button", "task_updated_alert", "mark_as_paid", "mark_as_pending_button", "confirm_approval_title", "confirm_submission_title", "confirm_submit_button", "delete_location_title", "delete_note_title", "delete_cost_title"] as const) {
            expect(en[key].slice(1), key).toBe(en[key].slice(1).toLowerCase())
        }
    })

    it("say what moving a task to someone else does, and end their sentences", () => {
        expect(en.task_assignee_deleted_msg).not.toMatch(/obligation/i)
        expect(ar.task_assignee_deleted_msg).not.toContain("التزام")
        for (const key of ["overdue_task_alert_msg", "task_finalized_msg"] as const) {
            expect(en[key], key).toMatch(/\.$/)
            expect(ar[key], key).toMatch(/\.$/)
        }
    })
})
