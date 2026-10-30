import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * An obligation's page on the building blocks (UI_PLAN.md §5 step 5): its
 * page header with its status and the way back to the list, its details in a
 * card, its files as chips, what its assignee hands in, and a manager's
 * decision, each in its own block (DESIGN.md §5.5).
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Obligations" }) }))
const viewer = { sees: true, manages: true, reach: "COMPANY" as "COMPANY" | "TEAM" }
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({
        can: (p: string) => p === "obligations.view" ? viewer.sees : p === "obligations.manage" ? viewer.manages : false,
        companyWide: () => viewer.reach === "COMPANY",
        scope: () => viewer.reach,
    }),
}))

const NOW = Date.parse("2026-10-30T12:00:00Z")
const mona = { id: "u2", firstName: "Mona", lastName: "Adel", status: "ACTIVE" }
const obligation = (fields: object = {}) => ({
    id: "o1", title: "Renew the fire licence", description: "Take the papers to the civil defence office.",
    status: "IN_PROGRESS", difficulty: 3, recurrence: "MONTHLY", companyId: "c1",
    deadline: "2026-11-02T09:00:00Z", createdAt: "2026-10-20T09:00:00Z",
    assignees: [mona], attachments: null, lastStatusUpdateBy: null,
    ...fields,
})

type Who = "manager" | "assignee" | "superAdmin"
async function page(o: ReturnType<typeof obligation>, who: Who = "manager") {
    viewer.sees = who !== "assignee"
    viewer.manages = who !== "assignee"
    viewer.reach = "COMPANY"
    const { default: ObligationDetailClient } = await import("@/app/(dashboard)/dashboard/obligations/[id]/client")
    return renderToStaticMarkup(h(ObligationDetailClient, {
        obligation: o, now: NOW,
        userRole: who === "superAdmin" ? "SUPER_ADMIN" : who === "assignee" ? "EMPLOYEE" : "ADMIN",
        userId: who === "assignee" ? mona.id : "admin", userName: "Hana Saad",
        creatorName: "Hana Saad", creatorUnknown: false,
    }))
}
const header = (html: string) => html.slice(html.indexOf('class="ui-page-header"'), html.indexOf("</header>"))

describe("an obligation's page", () => {
    it("has the page header: its title and status, and the way back to the list", async () => {
        const html = await page(obligation())
        const top = header(html)
        expect(top).toContain("Renew the fire licence")
        expect(top).toContain('class="ui-badge ui-badge-progress"')
        expect(top).toContain("status_in_progress")
        expect(top).toContain('href="/dashboard/obligations"')
        // Not the old card, with its colours typed in.
        expect(html).not.toContain('class="card')
        expect(html).not.toContain("style=")
    })

    it("says who decided it, once it's decided", async () => {
        expect(header(await page(obligation({ status: "APPROVED", lastStatusUpdateBy: "ADMIN Hana Saad" })))).toContain("list_status_by")
        expect(header(await page(obligation()))).not.toContain("list_status_by")
    })

    it("lists its details: who assigned it, its deadline, how often, its points and who it's for", async () => {
        const html = await page(obligation())
        expect(html).toContain('class="ui-prose"')
        expect(html).toContain("Take the papers to the civil defence office.")
        expect(html).toContain('<dl class="ui-details">')
        for (const label of ["assigned_by", "deadline_label", "recurrence_label", "points_label_plural", "assignees_label"]) {
            expect(html).toContain(`<dt>${label}</dt>`)
        }
        expect(html).toContain("Hana Saad")
        expect(html).toContain("recurrence_monthly")
        expect(html).toContain("count_pts_other")
        expect(html).toContain("Mona Adel")
    })

    it("marks a deadline that has passed, while it's still to be done", async () => {
        expect(await page(obligation({ deadline: "2026-10-29T09:00:00Z" }))).toContain('data-overdue="true"')
        expect(await page(obligation({ deadline: "2026-10-29T09:00:00Z", status: "APPROVED" }))).not.toContain('data-overdue="true"')
    })

    it("shows its files as chips that open them, and says when there are none", async () => {
        const files = JSON.stringify([{ name: "licence.pdf", url: "https://files.test/licence.pdf", uploadedById: "admin" }])
        const html = await page(obligation({ attachments: files }))
        expect(html).toContain('class="ui-files"')
        expect(html).toContain('href="https://files.test/licence.pdf"')
        expect(html).toContain("licence.pdf")
        expect(html).toContain('aria-label="ui_remove_file"')
        expect(await page(obligation({ attachments: files }), "assignee")).not.toContain('aria-label="ui_remove_file"')
        expect(await page(obligation())).toContain("no_attachments_msg")
    })
})

describe("its assignee", () => {
    it("attaches files and submits it, Submit being the one primary button", async () => {
        const html = await page(obligation(), "assignee")
        expect(html).toContain("obligation_your_submission")
        expect(html).toContain('class="ui-file-drop"')
        expect(html).toContain("ui_attach_files")
        expect(html.match(/ui-btn-primary/g)?.length).toBe(1)
        expect(html).toMatch(/ui-btn-primary[^>]*>.*submit_obligation/)
        expect(html).toContain("save_draft_obligation_button")
        // Deciding and managing it aren't theirs.
        expect(html).not.toContain("approve_button")
        expect(html).not.toContain("ui_more_actions")
    })

    it("past its deadline, is told so, and can't add files or save a draft", async () => {
        const html = await page(obligation({ deadline: "2026-10-29T09:00:00Z" }), "assignee")
        expect(html).toContain("overdue_obligation_alert_msg")
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-secondary" disabled="">.*ui_attach_files/)
        expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-secondary"[^>]*disabled=""[^>]*>.*save_draft_obligation_button/)
        // No longer a pop-up caught from any click on the page.
        const client = readFileSync("app/(dashboard)/dashboard/obligations/[id]/client.tsx", "utf8")
        expect(client).not.toContain("document.addEventListener('click'")
    })

    it("once it's handed in, is told it waits for review", async () => {
        const html = await page(obligation({ status: "PENDING_CONFIRMATION" }), "assignee")
        expect(html).toContain("pending_confirmation_msg")
        expect(html).not.toContain("submit_obligation")
    })
})

describe("a page left open across its deadline (found by Codex on PR 122)", () => {
    it("looks again at the deadline, so adding files and saving a draft lock then, not at the next reload", async () => {
        const { untilDeadline } = await import("@/lib/useDeadlineClock")
        const deadline = Date.parse("2026-10-30T12:05:00Z")
        // Five minutes to go: it looks again just after the deadline.
        expect(untilDeadline(deadline, NOW)).toBe(5 * 60_000 + 500)
        // Passed: nothing more to wait for.
        expect(untilDeadline(deadline, deadline + 1)).toBeNull()
        // Months away: no further than a timer can wait, and it looks again then.
        expect(untilDeadline(NOW + 90 * 86_400_000, NOW)).toBe(2 ** 31 - 1)
        const client = readFileSync("app/(dashboard)/dashboard/obligations/[id]/client.tsx", "utf8")
        expect(client).toContain("const clock = useDeadlineClock(deadlineAt, now)")
        expect(client).toContain("const isOverdue = deadlineAt < clock")
        expect(readFileSync("lib/useDeadlineClock.ts", "utf8")).toContain("setTimeout(() => setClock(Date.now()), wait)")
    })
})

describe("a manager", () => {
    it("approves or rejects one handed in, from the page header", async () => {
        const top = header(await page(obligation({ status: "PENDING_CONFIRMATION" })))
        expect(top).toMatch(/ui-btn-primary[^>]*>.*approve_button/)
        expect(top).toContain("reject_button")
        expect(header(await page(obligation()))).not.toContain("approve_button")
    })

    it("deletes it from More actions, and a Super Admin returns a decided one to in progress", async () => {
        const html = await page(obligation())
        expect(html).toContain('aria-label="ui_more_actions_for"')
        const decided = await page(obligation({ status: "APPROVED" }), "superAdmin")
        expect(decided).toContain('aria-label="ui_more_actions_for"')
        const client = readFileSync("app/(dashboard)/dashboard/obligations/[id]/client.tsx", "utf8")
        expect(client).toContain("label: t('return_to_in_progress')")
        expect(client).toContain("label: t('delete_obligation_button'), danger: true")
    })

    it("is told when someone it's for was deleted, and can reassign it, complete it or delete it", async () => {
        const html = await page(obligation({ assignees: [{ ...mona, status: "DELETED" }] }))
        expect(html).toContain("assignee_deleted_alert")
        expect(html).toContain("obligation_assignee_deleted_msg")
        expect(html).toContain("reassign_button")
        expect(html).toContain("mark_as_completed")
        expect(await page(obligation({ assignees: [{ ...mona, status: "DELETED" }], status: "APPROVED" }))).not.toContain("assignee_deleted_alert")
    })

    it("marks it completed when they choose to, which did nothing before", () => {
        const client = readFileSync("app/(dashboard)/dashboard/obligations/[id]/client.tsx", "utf8")
        const complete = client.slice(client.indexOf("const handleForceComplete"), client.indexOf("const handleRevert"))
        expect(complete).toContain("body: JSON.stringify({ status: 'COMPLETED' })")
    })
})

describe("an obligation that isn't there", () => {
    it("says so on a page with the way back, not a bare line", async () => {
        const { ObligationNotFound } = await import("@/app/(dashboard)/dashboard/obligations/[id]/client")
        const html = renderToStaticMarkup(h(ObligationNotFound))
        expect(html).toContain('class="ui-page-header"')
        expect(html).toContain('href="/dashboard/obligations"')
        expect(html).toContain("obligation_not_found")
        const server = readFileSync("app/(dashboard)/dashboard/obligations/[id]/page.tsx", "utf8")
        expect(server).not.toContain("<div>Obligation not found</div>")
    })
})

describe("its words", () => {
    it("are in sentence case (DESIGN.md §3.4)", () => {
        for (const key of ["delete_obligation_button", "delete_obligation_title", "mark_as_completed", "return_to_in_progress", "save_draft_obligation_button", "submit_obligation", "assignee_deleted_alert"] as const) {
            expect(en[key].slice(1), key).toBe(en[key].slice(1).toLowerCase())
        }
    })

    it("end their sentences, and say they're busy with an ellipsis (web interface audit)", () => {
        for (const key of ["overdue_obligation_alert_msg", "pending_confirmation_msg", "obligation_finalized_msg"] as const) {
            expect(en[key], key).toMatch(/\.$/)
            expect(ar[key], key).toMatch(/\.$/)
        }
        for (const key of ["saving", "submitting_obligation"] as const) {
            expect(en[key], key).toMatch(/…$/)
            expect(ar[key], key).toMatch(/…$/)
        }
    })

    it("speak of an obligation, not a task", () => {
        expect(en.obligation_assignee_deleted_msg).not.toMatch(/task/i)
        expect(ar.obligation_assignee_deleted_msg).not.toContain("مهمة")
        expect(en.obligation_reassign_msg).not.toMatch(/task/i)
    })
})
