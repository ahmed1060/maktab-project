import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url, as } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"

/**
 * Who reads and saves a company's salary advance rules (LATER_CHANGES_PLAN.md
 * §7.5, step 2): asked what Payroll deductions and the Payroll tab's own
 * fields are asked, the tab shown to them, and Change company settings to
 * save (lib/company-settings-access.ts). A company's own people only ever
 * their own company's.
 */

vi.setConfig({ testTimeout: 60_000 })
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const calls: { kind: "view" | "save"; companyId: string; draft?: any }[] = []
vi.mock("@/lib/services/salary-advance-policy.service", async importOriginal => {
    const real = await importOriginal<typeof import("@/lib/services/salary-advance-policy.service")>()
    const { salaryAdvancePolicyErrors, policyOfDraft, SALARY_ADVANCE_POLICY_DEFAULTS } = await import("@/lib/salary-advance-policy")
    return {
        ...real,
        SalaryAdvancePolicyService: {
            view: async (companyId: string) => { calls.push({ kind: "view", companyId }); return SALARY_ADVANCE_POLICY_DEFAULTS },
            // As the real one refuses: by the card's own rules, before anything is written.
            save: async (companyId: string, draft: any) => {
                const errors = salaryAdvancePolicyErrors(draft)
                if (Object.keys(errors).length > 0) throw new real.SalaryAdvancePolicyInvalid(errors)
                calls.push({ kind: "save", companyId, draft })
                return policyOfDraft(draft)
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

const route = () => import("@/app/api/company-salary-advances/route")
const get = async (query = "") => (await route()).GET(new Request(url(`/api/company-salary-advances${query}`)))
const put = async (body: unknown) => (await route()).PUT(withBody("PUT", "/api/company-salary-advances", body))
const card = { maxMonths: "1.5", minServiceMonths: "6", oneOpen: false, installmentPercent: "12.5", debtsPercent: "30", overLimit: "WARN" }

function onRole(grants: Record<string, string>) {
    state.session = { user: stepUpConfirmed({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(grants as any) }) }
}

describe("the company's Admin, with the Payroll tab shown", () => {
    it("reads and saves their own company's", async () => {
        as("admin")
        const read = await get()
        expect(read.status).toBe(200)
        expect((await read.json()).data).toEqual({ maxMonths: 2, minServiceMonths: 3, oneOpen: true, installmentPercent: 10, debtsPercent: 25, overLimit: "BLOCK" })
        const saved = await put(card)
        expect(saved.status).toBe(200)
        expect((await saved.json()).data).toEqual({ maxMonths: 1.5, minServiceMonths: 6, oneOpen: false, installmentPercent: 12.5, debtsPercent: 30, overLimit: "WARN" })
        expect(calls).toEqual([{ kind: "view", companyId: "c1" }, { kind: "save", companyId: "c1", draft: card }])
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
        expect((await put(card)).status).toBe(403)
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
        expect(calls).toEqual([])
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

describe("what's sent", () => {
    it("takes figures sent as numbers as the card's text", async () => {
        as("admin")
        expect((await put({ ...card, maxMonths: 2, minServiceMonths: 0, installmentPercent: 10, debtsPercent: 25 })).status).toBe(200)
        expect(calls[0].draft).toMatchObject({ maxMonths: "2", minServiceMonths: "0", installmentPercent: "10", debtsPercent: "25" })
    })

    it("is refused without a yes or no for one at a time, or with an answer to a limit that isn't Block or Warn", async () => {
        as("admin")
        expect((await put({ ...card, oneOpen: "yes" })).status).toBe(400)
        expect((await put({ ...card, oneOpen: undefined })).status).toBe(400)
        expect((await put({ ...card, overLimit: "IGNORE" })).status).toBe(400)
        expect((await put({ ...card, overLimit: undefined })).status).toBe(400)
        expect(calls).toEqual([])
    })

    it("typed wrong, is said under each field, as the card says it, and nothing is saved", async () => {
        as("admin")
        const res = await put({ ...card, maxMonths: "13", installmentPercent: "40", debtsPercent: "30" })
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.details).toEqual({
            code: "SALARY_ADVANCE_POLICY_INVALID",
            errors: { maxMonths: "salary_advance_months_invalid", debtsPercent: "salary_advance_debts_below" },
        })
        expect(calls).toEqual([])
    })
})
