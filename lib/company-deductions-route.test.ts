import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url, as } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"

/**
 * Who reads and saves a company's payroll deductions (LATER_CHANGES_PLAN.md
 * §7.12, PR 440): asked what the Payroll tab's own fields are asked, the tab
 * shown to them, and Change company settings to save (lib/company-settings-
 * access.ts). A company's own people only ever their own company's.
 */

vi.setConfig({ testTimeout: 60_000 })
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const calls: { kind: "view" | "save"; companyId: string; draft?: unknown }[] = []
vi.mock("@/lib/services/payroll-deduction.service", async importOriginal => {
    const real = await importOriginal<typeof import("@/lib/services/payroll-deduction.service")>()
    const { deductionErrors } = await import("@/lib/payroll-deductions")
    return {
        ...real,
        PayrollDeductionService: {
            view: async (companyId: string) => { calls.push({ kind: "view", companyId }); return { incomeTax: 0, socialInsurance: 0, more: [] } },
            // As the real one refuses: by the card's own rules, before anything is written.
            save: async (companyId: string, draft: any) => {
                const errors = deductionErrors(draft)
                if (Object.keys(errors).length > 0) throw new real.DeductionsInvalid(errors)
                calls.push({ kind: "save", companyId, draft })
                return { incomeTax: Number(draft.incomeTax), socialInsurance: Number(draft.socialInsurance), more: [] }
            },
        },
    }
})

let company = { id: "c1", adminSettingsEnabled: true, adminSettingsTabs: ["general", "payroll"] as string[], package: null }
beforeEach(() => {
    company = { id: "c1", adminSettingsEnabled: true, adminSettingsTabs: ["general", "payroll"], package: null }
    calls.length = 0
    prismaMock.company.findUnique = async ({ where }: any) => (where.id === "c1" ? { ...company } : where.id === "c2" ? { ...company, id: "c2" } : null)
})

const route = () => import("@/app/api/company-deductions/route")
const get = async (query = "") => (await route()).GET(new Request(url(`/api/company-deductions${query}`)))
const put = async (body: unknown) => (await route()).PUT(withBody("PUT", "/api/company-deductions", body))
const card = { incomeTax: "10", socialInsurance: "11", more: [{ name: "Union fee", basis: "AMOUNT", value: "150" }] }

function onRole(grants: Record<string, string>) {
    state.session = { user: stepUpConfirmed({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(grants as any) }) }
}

describe("the company's Admin, with the Payroll tab shown", () => {
    it("reads and saves their own company's", async () => {
        as("admin")
        expect((await get()).status).toBe(200)
        expect((await put(card)).status).toBe(200)
        expect(calls).toEqual([{ kind: "view", companyId: "c1" }, expect.objectContaining({ kind: "save", companyId: "c1" })])
    })

    it("only ever their own company's, whatever's asked", async () => {
        as("admin")
        await get("?companyId=c2")
        await put({ ...card, companyId: "c2" })
        expect(calls.map(c => c.companyId)).toEqual(["c1", "c1"])
    })

    it("not with the Payroll tab hidden from the company's people", async () => {
        as("admin")
        company.adminSettingsTabs = ["general"]
        expect((await get()).status).toBe(403)
        expect((await put(card)).status).toBe(403)
        company.adminSettingsTabs = ["general", "payroll"]
        company.adminSettingsEnabled = false
        expect((await get()).status).toBe(403)
        expect(calls).toEqual([])
    })
})

describe("someone on a role of the company's own", () => {
    it("with See company settings reads them, and can't save them", async () => {
        onRole({ "settings.view": "COMPANY" })
        expect((await get()).status).toBe(200)
        expect((await put(card)).status).toBe(403)
        expect(calls.map(c => c.kind)).toEqual(["view"])
    })

    it("with Change company settings saves them", async () => {
        // With See company settings, which it comes with on a role.
        onRole({ "settings.view": "COMPANY", "settings.edit": "COMPANY" })
        expect((await put(card)).status).toBe(200)
    })

    it("with neither, neither", async () => {
        onRole({ "employees.view": "COMPANY" })
        expect((await get()).status).toBe(403)
        expect((await put(card)).status).toBe(403)
    })
})

describe("the Super Admin", () => {
    it("reads and saves any company's, named", async () => {
        as("superAdmin")
        expect((await get()).status).toBe(400)
        expect((await get("?companyId=c2")).status).toBe(200)
        expect((await put({ ...card, companyId: "c2" })).status).toBe(200)
        expect(calls.map(c => c.companyId)).toEqual(["c2", "c2"])
        expect((await get("?companyId=nope")).status).toBe(404)
    })
})

describe("what's wrong", () => {
    it("is said under each field, as the card says it, and nothing is saved", async () => {
        as("admin")
        const res = await put({ incomeTax: "120", socialInsurance: "0", more: [{ name: "", basis: "PERCENT", value: "5" }] })
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.details).toEqual({ code: "DEDUCTIONS_INVALID", errors: { incomeTax: "deduction_percent_invalid", more: { 0: { name: "deduction_name_required" } } } })
        expect(calls).toEqual([])
    })

    it("needs the list, even an empty one", async () => {
        as("admin")
        expect((await put({ incomeTax: "0", socialInsurance: "0" })).status).toBe(400)
    })

    it("takes figures sent as numbers too", async () => {
        as("admin")
        expect((await put({ incomeTax: 10, socialInsurance: 0, more: [{ name: "Club", basis: "PERCENT", value: 2.5 }] })).status).toBe(200)
        expect(calls[0].draft).toEqual({ incomeTax: "10", socialInsurance: "0", more: [{ id: undefined, name: "Club", basis: "PERCENT", value: "2.5" }] })
    })
})
