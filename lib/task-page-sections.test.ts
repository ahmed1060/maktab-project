import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"

/**
 * A task's page, part 2 (UI_PLAN.md §5 step 5): its costs, its location
 * history and its submission form on the building blocks, each a card of
 * its own, as the page's other blocks are (lib/task-page.test.ts), and its
 * edit window a dialog of the building blocks.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (k: string) => k === "costs" ? "Costs" : k }) }))
const viewer = { can: true }
vi.mock("@/lib/useCan", () => ({ useCan: () => ({ can: () => viewer.can, companyWide: () => viewer.can, scope: () => viewer.can ? "COMPANY" : null }) }))
vi.mock("@/lib/features/useFeatures", () => ({ useFeatures: () => ({ has: () => true }) }))
vi.mock("@/components/cash-advances/AdvanceBalanceHint", () => ({ default: () => null }))
vi.mock("@/components/lists/useListNames", () => ({ useListNames: () => ({ suggest: async () => [] }) }))

const mona = { id: "u2", firstName: "Mona", lastName: "Adel" }
const sami = { id: "u3", firstName: "Sami", lastName: "Nabil" }
const task = (fields: object = {}) => ({
    id: "t1", status: "IN_PROGRESS", assignees: [mona], comments: [], totalCost: 150, paymentStatus: "PENDING_PAYMENT",
    costs: [{ id: "c1", amount: 150, description: "Taxi to the site", authorId: "u2", authorName: "Mona Adel", receiptUrl: "https://files.test/r.jpg", fromAdvance: 0, createdAt: "2026-10-29T09:00:00Z" }],
    ...fields,
})
const noStyles = (html: string) => {
    expect(html).not.toContain("style=")
    expect(html).not.toContain("<style")
}

async function costs(t: ReturnType<typeof task>, { userId = "u2", locked = false, can = true } = {}) {
    viewer.can = can
    const { default: TaskCostsSection } = await import("@/components/TaskCostsSection")
    return renderToStaticMarkup(h(TaskCostsSection, {
        task: t, userId, locked, onDeleteItem: () => {}, onPaymentStatusChange: () => {},
        getMemberCosts: (x: any) => x.memberCosts ?? {}, getMemberPaymentStatus: (x: any) => x.memberPaymentStatus ?? {},
    }))
}

describe("a task's costs", () => {
    it("are a card of rows, each its description, receipt, who and when, and its amount", async () => {
        const html = await costs(task())
        expect(html).toContain('class="ui-panel ui-card"')
        expect(html).toMatch(/class="ui-card-title"[^>]*>Costs</)
        expect(html).toContain('class="ui-rows ui-cost-rows"')
        expect(html).toContain("Taxi to the site")
        expect(html).toContain('href="https://files.test/r.jpg"')
        expect(html).toContain("Mona Adel")
        expect(html).toMatch(/class="ui-num ui-nowrap"[^>]*>150\.00 egp</)
        noStyles(html)
    })

    it("total as a tile, with whether it's paid", async () => {
        const html = await costs(task())
        expect(html).toContain('<dl class="ui-tiles">')
        expect(html).toContain("total_cost")
        expect(html).toContain("ui-badge ui-badge-waiting")
        expect(html).toContain("payment_status_pending")
    })

    it("show someone on a shared task their own total beside the task's", async () => {
        const html = await costs(task({ assignees: [mona, sami], memberCosts: { u2: 150 } }))
        expect(html).toContain("my_total_cost")
        expect(html).toContain("grand_total_cost")
    })

    it("give whoever pays a row per person on a shared task once it's reviewed, with Mark as paid", async () => {
        const html = await costs(task({ status: "COMPLETED", assignees: [mona, sami], memberCosts: { u2: 150, u3: 0 } }), { userId: "admin" })
        expect(html).toContain("individual_settlements")
        expect(html).toMatch(/<button[^>]*class="ui-btn[^"]*"[^>]*>.*mark_as_paid/)
        // Each shows it's being saved, and none is clicked again meanwhile (lib/busy-action.test.ts).
        const src = readFileSync("components/TaskCostsSection.tsx", "utf8")
        expect(src).toContain("action.run(uid, () => onPaymentStatusChange(")
        expect(src).toContain("busy={action.is(uid)}")
    })

    it("can be taken off by whoever may, while it's worked on and not locked", async () => {
        expect(await costs(task())).toContain("delete_cost_title")
        expect(await costs(task(), { locked: true })).not.toContain("delete_cost_title")
        expect(await costs(task({ status: "PENDING_CONFIRMATION" }))).not.toContain("delete_cost_title")
    })
})

async function places(t: object, { locked = false, can = true, userId = "u2" } = {}) {
    viewer.can = can
    const { default: TaskLocationHistorySection } = await import("@/components/TaskLocationHistorySection")
    return renderToStaticMarkup(h(TaskLocationHistorySection, { task: t, setTask: () => {}, userId, locked, setLocationToDelete: () => {} }))
}
const checkIn = (fields: object = {}) => ({
    type: "LOCATION_ADDED", author: "Mona Adel", authorId: "u2", date: "2026-10-29T09:00:00Z",
    location: JSON.stringify({ latitude: 30.05, longitude: 31.23, accuracy: 12, address: "Tahrir Square" }), ...fields,
})

describe("a task's location history", () => {
    it("is a card of rows, each a map link that says it opens a new tab, with who and when", async () => {
        const html = await places(task({ comments: [checkIn()] }))
        expect(html).toContain('class="ui-panel ui-card"')
        expect(html).toContain("location_history_title")
        expect(html).toContain('href="https://www.google.com/maps?q=30.05,31.23"')
        expect(html).toContain("ui_opens_new_tab")
        expect(html).toContain("Tahrir Square")
        noStyles(html)
    })

    it("says how it was checked as a status, in words", async () => {
        expect(await places(task({ comments: [checkIn({ verificationStatus: "CORRECT" })] }))).toContain("ui-badge ui-badge-good")
        expect(await places(task({ comments: [checkIn({ verificationStatus: "WRONG" })] }))).toContain("ui-badge ui-badge-problem")
        expect(await places(task({ comments: [checkIn({ verificationStatus: "UNVERIFIED" })] }))).toContain("ui-badge ui-badge-waiting")
    })

    it("lets a reviewer mark it right or wrong once it's handed in", async () => {
        const html = await places(task({ status: "PENDING_CONFIRMATION", comments: [checkIn()] }), { userId: "admin" })
        expect(html).toContain("mark_correct_title")
        expect(html).toContain("mark_wrong_title")
        // Why one needs review is read, not only hovered (web interface audit).
        const unclear = await places(task({ status: "PENDING_CONFIRMATION", comments: [checkIn({ verificationStatus: "UNVERIFIED" })] }), { userId: "admin" })
        expect(unclear).toMatch(/class="ui-item-detail"[^>]*>verified_unclear_hint</)
    })

    it("offers a lateness penalty, in a dialog, once the task is handed in", async () => {
        expect(await places(task({ status: "COMPLETED", comments: [checkIn()] }), { userId: "admin" })).toContain("task_penalty_button")
        expect(await places(task({ comments: [checkIn()] }), { userId: "admin" })).not.toContain("task_penalty_button")
        expect(readFileSync("components/TaskLocationHistorySection.tsx", "utf8")).toContain("<Dialog")
    })

    it("puts the penalty on the task, for the person picked, through the task's own penalty", () => {
        const src = readFileSync("components/TaskLocationHistorySection.tsx", "utf8")
        // It went to the salary route, which asks for another permission, and to the first assignee whoever was late.
        expect(src).toContain("fetch(`/api/tasks/${task.id}/penalty`")
        expect(src).not.toContain("/deduction")
        expect(src).not.toContain("task.assignees?.[0]?.id")
        expect(src).toContain("legend={t('task_penalty_who')}")
    })
})

async function form(fields: object = {}) {
    viewer.can = false
    const { default: TaskSubmissionForm } = await import("@/components/TaskSubmissionForm")
    return renderToStaticMarkup(h(TaskSubmissionForm, {
        pendingFiles: [], onAddFiles: () => {}, onRemoveFile: () => {}, uploading: false,
        costName: { text: "", entryId: null }, setCostName: () => {}, companyId: "c1", cost: "", setCost: () => {}, onAddCost: () => {},
        costReceipt: null, onCostReceipt: () => {}, onClearCostReceipt: () => {}, costEntries: [], onRemoveCostEntry: () => {},
        note: "", setNote: () => {}, capturingLocation: false, locationStatus: "", onCaptureLocation: () => {},
        onSaveDraft: () => {}, onSubmitRequest: () => {}, loadingType: null, locked: false,
        ...fields,
    }))
}

describe("what whoever it's for hands in", () => {
    it("is a card of fields, each with its label: files, costs, a note and where they are", async () => {
        const html = await form()
        expect(html).toContain('class="ui-panel ui-card"')
        expect(html).toContain("submit_task_title")
        expect(html).toContain('class="ui-file-drop"')
        for (const label of ["add_costs_label", "note_optional_label", "current_location_label"]) {
            expect(html).toMatch(new RegExp(`class="ui-label"[^>]*>${label}<`))
        }
        expect(html).toContain("ui_characters_used")
        // Where they are is said as it changes: the live region is there before it (web interface audit).
        expect(html).toContain('class="ui-hint" role="status"')
        noStyles(html)
    })

    it("names each cost it would take off (web interface audit)", async () => {
        const html = await form({ costEntries: [{ amount: 5, description: "Tea", receipt: null }] })
        expect(html).toContain('aria-label="ui_remove_file"')
    })

    it("is handed in with Submit task, the one primary button, or kept as a draft", async () => {
        const html = await form()
        expect(html.match(/ui-btn-primary/g)?.length).toBe(1)
        expect(html).toMatch(/ui-btn-primary[^>]*>.*submit_task_button/)
        expect(html).toContain("save_draft_button")
    })

    it("past the deadline, says so and adds or takes off nothing, but can still be handed in", async () => {
        const html = await form({ locked: true, pendingFiles: [new File(["x"], "a.jpg")], costEntries: [{ amount: 5, description: "Tea", receipt: null }] })
        expect(html).toContain("overdue_task_alert_msg")
        expect(html).not.toContain("ui_remove_file")
        expect(html).not.toMatch(/<button[^>]*>[^<]*remove</)
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-primary"(?![^>]*disabled)[^>]*>.*submit_task_button/)
    })
})

describe("its edit window", () => {
    it("is a dialog of the building blocks, its fields labelled, with its counts", () => {
        const src = readFileSync("components/TaskEditDetailsModal.tsx", "utf8")
        expect(src).not.toContain("@/components/Modal")
        expect(src).toContain("<Dialog")
        expect(src).toContain("<Field label={t('title_label')}")
        expect(src).toContain("<Field label={t('description_label')}")
        expect(src).toContain("asField")
        expect(src).not.toContain("style=")
        // Save with a field to fix goes to it (web interface audit).
        expect(src).toContain(`querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()`)
    })
})
