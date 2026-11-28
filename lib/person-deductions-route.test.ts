import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url, as } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed, withGrants } from "./permissions/test-actors"
import { serializeAccess } from "./features/bundles"

/**
 * Who reads and saves a person's payroll deductions (LATER_CHANGES_PLAN.md
 * §7.12, 9b; DESIGN.md §5.5, A person's payroll deductions): read where
 * their salary is, by whoever sees salaries over them and on one's own; saved
 * by whoever may change their salary, never on one's own, with the code a
 * salary change asks for. Never an Admin's, whose pay isn't on the profile,
 * and only where the company's package has Payroll. Made-up people.
 */

vi.setConfig({ testTimeout: 60_000 })
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const calls: { kind: "view" | "save"; userId: string; entries?: unknown }[] = []
const CURRENT = { deductions: [{ ref: "INCOME_TAX", kind: "INCOME_TAX", name: null, basis: "PERCENT", company: 10, mode: "COMPANY", value: null }] }
vi.mock("@/lib/services/person-deduction.service", async importOriginal => {
    const real = await importOriginal<typeof import("@/lib/services/person-deduction.service")>()
    const { personDeductionErrors } = await import("@/lib/payroll-deductions")
    return {
        ...real,
        PersonDeductionService: {
            view: async (userId: string) => { calls.push({ kind: "view", userId }); return CURRENT },
            // As the real one refuses: by the card's own rules, then by what the company has now.
            save: async (userId: string, entries: any[]) => {
                const errors = personDeductionErrors(entries)
                if (Object.keys(errors).length > 0) throw new real.PersonDeductionsInvalid(errors)
                if (entries.some(e => e.ref === "stale")) throw new real.DeductionsChanged(CURRENT as any)
                calls.push({ kind: "save", userId, entries })
                return CURRENT
            },
        },
    }
})

beforeEach(() => { calls.length = 0 })

const route = () => import("@/app/api/users/[id]/payroll-deductions/route")
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const get = async (id: string) => (await route()).GET(new Request(url(`/api/users/${id}/payroll-deductions`)), params(id))
const put = async (id: string, body: unknown = { deductions: [{ ref: "INCOME_TAX", basis: "PERCENT", mode: "OWN", value: "12.5" }] }) =>
    (await route()).PUT(withBody("PUT", `/api/users/${id}/payroll-deductions`, body), params(id))

/** Someone on a company's own role, holding these, with the code entered. */
function holding(grants: Record<string, string>, more: Record<string, unknown> = {}) {
    state.session = { user: stepUpConfirmed({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants(grants as any), ...more }) }
}

describe("the company's Admin", () => {
    it("reads and saves an employee's, and a Team Leader's", async () => {
        as("admin")
        expect((await get("emp")).status).toBe(200)
        expect((await put("emp")).status).toBe(200)
        expect((await get("tl")).status).toBe(200)
        expect((await put("tl")).status).toBe(200)
        expect(calls.map(c => [c.kind, c.userId])).toEqual([["view", "emp"], ["save", "emp"], ["view", "tl"], ["save", "tl"]])
        expect(calls[1].entries).toEqual([{ ref: "INCOME_TAX", basis: "PERCENT", mode: "OWN", value: "12.5" }])
    })

    it("never another company's people", async () => {
        as("admin")
        expect((await get("other")).status).toBe(403)
        expect((await put("other")).status).toBe(403)
        expect(calls).toEqual([])
    })

    it("never an Admin's, whose pay isn't on the profile, their own neither", async () => {
        as("admin")
        expect((await get("admin1b")).status).toBe(403)
        expect((await put("admin1b")).status).toBe(403)
        expect((await get("admin")).status).toBe(403)
        expect(calls).toEqual([])
    })

    it("nobody's who isn't there", async () => {
        as("admin")
        expect((await get("nobody")).status).toBe(404)
        expect((await put("nobody")).status).toBe(404)
    })

    it("asks for the code a salary change asks for", async () => {
        state.session = { user: { ...withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }), mfaEnabled: true, stepUpAt: null } }
        const res = await put("emp")
        expect(res.status).toBe(403)
        expect((await res.json()).code).toBe("STEP_UP_REQUIRED")
        expect(calls).toEqual([])
        // Reading asks for nothing.
        expect((await get("emp")).status).toBe(200)
    })

    it("hears what's wrong under each deduction, and when the company's changed, what they are now", async () => {
        as("admin")
        const wrong = await put("emp", { deductions: [{ ref: "INCOME_TAX", basis: "PERCENT", mode: "OWN", value: "120" }] })
        expect(wrong.status).toBe(400)
        expect((await wrong.json()).details).toEqual({ code: "DEDUCTIONS_INVALID", errors: { INCOME_TAX: "deduction_percent_invalid" } })
        const stale = await put("emp", { deductions: [{ ref: "stale", basis: "PERCENT", mode: "NONE", value: "" }] })
        expect(stale.status).toBe(409)
        expect(await stale.json()).toMatchObject({ code: "DEDUCTIONS_CHANGED", current: CURRENT })
        expect((await put("emp", { deductions: "no" })).status).toBe(400)
    })
})

describe("whoever sees and changes salaries, on a company's own role", () => {
    it("with See salaries over the company: reads anyone's, saves nobody's", async () => {
        holding({ "salary.view": "COMPANY", "employees.view": "COMPANY" })
        expect((await get("emp")).status).toBe(200)
        expect((await get("loner")).status).toBe(200)
        expect((await put("emp")).status).toBe(403)
        expect(calls.map(c => c.kind)).toEqual(["view", "view"])
    })

    it("with See salaries over their team: their team's, nobody else's", async () => {
        state.session = { user: stepUpConfirmed({ id: "tl", role: "TEAM_LEADER", companyId: "c1", grants: encodeGrants({ "salary.view": "TEAM", "employees.view": "TEAM" } as any) }) }
        expect((await get("emp")).status).toBe(200)
        expect((await get("loner")).status).toBe(403)
        expect(calls.map(c => c.userId)).toEqual(["emp"])
    })

    it("seeing employees but not salaries: nobody's", async () => {
        holding({ "employees.view": "COMPANY" })
        expect((await get("emp")).status).toBe(403)
        expect(calls).toEqual([])
    })

    it("with Change salaries: reads and saves anyone's, but never their own", async () => {
        holding({ "salary.edit": "COMPANY", "salary.view": "COMPANY", "employees.view": "COMPANY" }, { id: "emp" })
        expect((await put("loner")).status).toBe(200)
        expect((await put("emp")).status).toBe(403)
        expect(calls.map(c => [c.kind, c.userId])).toEqual([["save", "loner"]])
    })

    it("without either: nobody's but their own, and that only to read", async () => {
        as("employee")
        expect((await get("loner")).status).toBe(403)
        expect((await get("emp")).status).toBe(200)
        expect((await put("emp")).status).toBe(403)
        expect(calls.map(c => [c.kind, c.userId])).toEqual([["view", "emp"]])
    })

    it("nobody's where the company's package hasn't Payroll", async () => {
        const noPayroll = serializeAccess({ unrestricted: false, bundles: new Set(["COMPANY_MANAGEMENT"] as never[]) })
        state.session = { user: stepUpConfirmed({ ...withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }), featureAccess: noPayroll }) }
        expect((await get("emp")).status).toBe(403)
        expect((await put("emp")).status).toBe(403)
        expect(calls).toEqual([])
    })
})
