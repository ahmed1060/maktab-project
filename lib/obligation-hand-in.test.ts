import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { stripComments } from "./strip-comments"

/**
 * Handing an obligation in is for whoever it's assigned to, whatever their
 * role (LATER_CHANGES_PLAN.md §7.14). It was shown only to people who don't
 * see others' obligations, so a Team Leader given one had no way to hand
 * it in. A Team Leader on it still decides it, as their team's.
 */

type Grants = Record<string, "TEAM" | "COMPANY">
const state = { grants: {} as Grants }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: "en", t: (key: string) => en[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: () => "Obligations" }) }))
vi.mock("@/lib/useCan", () => ({
    useCan: () => ({
        can: (p: string) => p in state.grants,
        companyWide: (p: string) => state.grants[p] === "COMPANY",
        scope: (p: string) => state.grants[p] ?? null,
    }),
}))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))

// Made-up people.
const NOW = Date.parse("2026-11-27T12:00:00Z")
const LAYLA = { id: "leader", firstName: "Layla", lastName: "Fahmy", status: "ACTIVE" }
const SAMI = { id: "employee", firstName: "Sami", lastName: "Nour", status: "ACTIVE" }
const OMAR = { firstName: "Omar", lastName: "Adel" }

const TEAM_LEADER: Grants = { "obligations.view": "TEAM", "obligations.create": "TEAM", "obligations.edit": "TEAM", "obligations.approve": "TEAM", "obligations.delete": "TEAM" }
const ADMIN: Grants = { "obligations.view": "COMPANY", "obligations.create": "COMPANY", "obligations.edit": "COMPANY", "obligations.approve": "COMPANY", "obligations.delete": "COMPANY" }
const EMPLOYEE: Grants = {}

const page = async (grants: Grants, userId: string, status: string, assignees = [LAYLA]) => {
    state.grants = grants
    const { default: ObligationDetailClient } = await import("@/app/(dashboard)/dashboard/obligations/[id]/client")
    return renderToStaticMarkup(h(ObligationDetailClient, {
        obligation: {
            id: "o1", title: "File the quarterly VAT return", description: "", status, difficulty: 2, recurrence: "ONE_TIME",
            companyId: "c1", deadline: "2026-12-10T09:00:00Z", createdAt: "2026-11-20T09:00:00Z",
            assignees, attachments: null, lastStatusUpdateBy: null,
        },
        now: NOW, userRole: "EMPLOYEE", userId, userName: "Someone", creator: OMAR, creatorUnknown: false,
    } as any))
}
const handIn = (html: string) => html.includes(en.obligation_your_submission) && html.includes(en.submit_obligation)

describe("handing an obligation in", () => {
    it("is offered to a Team Leader it's assigned to", async () => {
        expect(handIn(await page(TEAM_LEADER, "leader", "IN_PROGRESS"))).toBe(true)
        expect(handIn(await page(TEAM_LEADER, "leader", "PENDING"))).toBe(true)
    })

    it("is offered to an Admin it's assigned to", async () => {
        expect(handIn(await page(ADMIN, "leader", "IN_PROGRESS"))).toBe(true)
    })

    it("is offered to an employee it's assigned to, as before", async () => {
        expect(handIn(await page(EMPLOYEE, "employee", "IN_PROGRESS", [SAMI]))).toBe(true)
    })

    it("isn't offered to a Team Leader or an Admin it isn't assigned to", async () => {
        expect((await page(TEAM_LEADER, "leader", "IN_PROGRESS", [SAMI]))).not.toContain(en.obligation_your_submission)
        expect((await page(ADMIN, "admin", "IN_PROGRESS", [SAMI]))).not.toContain(en.obligation_your_submission)
        expect((await page(TEAM_LEADER, "leader", "PENDING_CONFIRMATION", [SAMI]))).not.toContain(en.obligation_your_submission)
        expect((await page(ADMIN, "admin", "APPROVED", [SAMI]))).not.toContain(en.obligation_your_submission)
    })

    it("tells a Team Leader who handed it in that it's waiting, and they still decide it, as their team's", async () => {
        const html = await page(TEAM_LEADER, "leader", "PENDING_CONFIRMATION")
        expect(html).toContain(en.obligation_your_submission)
        expect(html).toContain(en.pending_confirmation_msg)
        expect(html).not.toContain(en.submit_obligation)
        expect(html).toContain(en.approve_button)
        expect(html).toContain(en.reject_button)
    })

    it("tells a Team Leader it's done with once it's decided", async () => {
        const html = await page(TEAM_LEADER, "leader", "APPROVED")
        expect(html).toContain(en.obligation_your_submission)
        expect(html).toContain(en.obligation_finalized_msg)
    })

    it("still doesn't let an Admin decide their own", async () => {
        const html = await page(ADMIN, "leader", "PENDING_CONFIRMATION")
        expect(html).toContain(en.pending_confirmation_msg)
        expect(html).not.toContain(en.approve_button)
    })

    it("saves what its assignee was handing in when they're signed out, whatever their role", () => {
        const source = stripComments(readFileSync("app/(dashboard)/dashboard/obligations/[id]/client.tsx", "utf8"))
        expect(source).toContain("if (isOnIt && working) {")
        expect(source).not.toMatch(/!seesOthers &&/)
    })
})
