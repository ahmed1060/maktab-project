import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION } from "@/lib/permissions/catalogue"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { historyParts } from "@/lib/history-parts"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * settlements.manage split (LATER_CHANGES_PLAN.md §2, PR 383): seeing
 * someone's final settlements and opening the statement is settlements.view,
 * and sending the statement by email, or again, is settlements.resend, which
 * includes seeing it. Both for the company, both needing See employees, and
 * neither high-risk, as settlements.manage wasn't. A role still holding
 * settlements.manage holds both. The real routes run; the settlement and
 * delivery services, which make no access decision, are mocked, and the
 * delivery one records what it's asked to send.
 */

const VIEW = "settlements.view"
const RESEND = "settlements.resend"
const PARTS = [VIEW, RESEND]

const state = { session: null as any }
let sent: string[] = []
const SETTLEMENT = {
    id: "s1", companyId: "c1", netAmount: 100, earnedAmount: 300, paidAmount: 200, debtRecoveredAmount: 0,
    lastWorkingDay: new Date("2026-10-31"), dueDate: new Date("2026-11-30"), status: "PENDING", reason: null, emailedAt: null,
    user: { firstName: "Made", lastName: "Up", email: "made.up@example.com" },
    company: { id: "c1", name: "Made-up company", logoUrl: null },
}

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        systemSettings: { findUnique: async () => null },
        rateLimit: { findUnique: async () => null, upsert: async () => ({ count: 1 }), update: async () => ({ count: 1 }) },
        user: { findUnique: async ({ where }: any) => (where.id === "emp" ? { id: "emp", companyId: "c1", teamLeaderId: null } : null) },
        finalSettlement: { findUnique: async ({ where }: any) => (where.id === "s1" ? { ...SETTLEMENT } : null) },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" },
}))
vi.mock("@/lib/services/settlement.service", () => ({ SettlementService: { forUser: async () => [] } }))
vi.mock("@/lib/services/payroll-delivery.service", () => ({
    PayrollDeliveryService: { resendSettlement: async (id: string) => { sent.push(id); return { outcome: "SENT" } } },
}))

const actor = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) })
const signIn = (grants: Grants) => { state.session = { user: actor(grants) } }
/** Reaching someone at all: seeing the people, and their salaries. */
const REACH = { "employees.view": "COMPANY", "salary.view": "COMPANY" } as Grants
const SEES = { ...REACH, [VIEW]: "COMPANY" } as Grants
const SENDS = { ...REACH, [VIEW]: "COMPANY", [RESEND]: "COMPANY" } as Grants

const url = (p: string) => `https://nizmo.test${p}`
const list = async () => (await import("@/app/api/users/[id]/settlements/route")).GET(new Request(url("/api/users/emp/settlements")), { params: { id: "emp" } })
const statement = async () => (await import("@/app/api/settlements/[id]/route")).GET(new Request(url("/api/settlements/s1")), { params: { id: "s1" } })
const resend = async () => (await import("@/app/api/settlements/[id]/resend/route")).POST(new Request(url("/api/settlements/s1/resend"), { method: "POST" }), { params: { id: "s1" } })
const ROUTES = ["app/api/users/[id]/settlements/route.ts", "app/api/settlements/[id]/route.ts", "app/api/settlements/[id]/resend/route.ts"]
const source = (file: string) => stripComments(readFileSync(file, "utf8"))

beforeEach(() => { sent = [] })

describe("the catalogue", () => {
    it("has settlements.view and .resend, with codes of their own, for the company, needing See employees, and not high-risk", () => {
        expect(PERMISSIONS[VIEW].code).toBe(91)
        expect(PERMISSIONS[RESEND].code).toBe(92)
        expect(PERMISSIONS[VIEW]).toMatchObject({ module: "PAYROLL", scopes: ["COMPANY"], implies: ["salary.view"], requires: ["employees.view"] })
        expect(PERMISSIONS[RESEND]).toMatchObject({ module: "PAYROLL", scopes: ["COMPANY"], implies: [VIEW], requires: ["employees.view"] })
        for (const p of PARTS) expect((PERMISSIONS[p as keyof typeof PERMISSIONS] as { highRisk?: string }).highRisk, p).toBeUndefined()
    })

    it("offers See and Send in the role editor's payroll, where settlements.manage was, and it no more", () => {
        expect(PERMISSION_GROUPS.find(g => g.key === "payroll")?.permissions).toEqual([
            "payroll.view", "payroll.prepare", "payroll.approve", "payroll.issue_payslips", "payroll.mark_paid", ...PARTS, "debts.view", "debts.waive",
        ])
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions)).not.toContain("settlements.manage")
    })

    it("goes up a version, so every session reloads its grants once", () => {
        expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(13)
    })

    it("seeds the built-in Admin with both, and nobody with settlements.manage", () => {
        for (const p of PARTS) {
            expect(BUILT_IN_GRANTS.ADMIN[p as keyof Grants], p).toBe("COMPANY")
            expect(BUILT_IN_GRANTS.TEAM_LEADER[p as keyof Grants], p).toBeUndefined()
            expect(BUILT_IN_GRANTS.EMPLOYEE[p as keyof Grants], p).toBeUndefined()
        }
        for (const role of Object.values(BUILT_IN_GRANTS)) expect((role as Record<string, unknown>)["settlements.manage"]).toBeUndefined()
    })
})

describe("seeing them", () => {
    it("lists someone's settlements, and opens the statement, with settlements.view", async () => {
        signIn(SEES)
        expect((await list()).status).toBe(200)
        expect((await statement()).status).toBe(200)
    })

    it("is refused with neither, plainly", async () => {
        signIn(REACH)
        const listed = await list()
        expect(listed.status).toBe(403)
        expect(await listed.json()).toMatchObject({ error: "Managers only" })
        expect((await statement()).status).toBe(403)
    })

    it("is never another company's", async () => {
        state.session = { user: { ...actor(SENDS), companyId: "c2" } }
        expect((await statement()).status).toBe(403)
        expect((await resend()).status).toBe(403)
        expect(sent).toEqual([])
    })

    it("puts Settlements in someone's history with seeing", () => {
        const has = () => true
        const holding = (...held: string[]) => (p: string) => held.includes(p)
        expect(historyParts({ own: false, can: holding("employees.view", VIEW) as any, has }).settlements).toBe(true)
        expect(historyParts({ own: false, can: holding("employees.view", "salary.view") as any, has }).settlements).toBe(false)
    })
})

describe("sending the statement", () => {
    it("is done with settlements.resend", async () => {
        signIn(SENDS)
        expect((await resend()).status).toBe(200)
        expect(sent).toEqual(["s1"])
    })

    it("is refused with seeing alone, and nothing is sent", async () => {
        signIn(SEES)
        expect((await resend()).status).toBe(403)
        expect(sent).toEqual([])
    })

    it("leaves no route asking settlements.manage", () => {
        for (const file of ROUTES) expect(source(file), file).not.toContain("settlements.manage")
    })
})

describe("the statement's page", () => {
    it("offers Send by email, or Send again, with sending, and Print to whoever opens it", () => {
        const page = source("app/(dashboard)/dashboard/documents/settlement/[id]/page.tsx")
        expect(page).toContain("const canSend = can('settlements.resend')")
        expect(page).toContain("{canSend && <Button busy={sending} onClick={resend}>")
        expect(page).toContain("<Button variant=\"primary\" icon={PrinterIcon} onClick={() => window.print()}>")
    })
})

describe("the words", () => {
    it("say what each does, in both languages", () => {
        expect(en.perm_settlements_view).toBe("See final settlements")
        expect(en.perm_settlements_resend).toBe("Send final settlements by email")
        expect(ar.perm_settlements_view).toBe("عرض التسويات النهائية")
        expect(ar.perm_settlements_resend).toBe("إرسال التسويات النهائية بالبريد الإلكتروني")
    })
})
