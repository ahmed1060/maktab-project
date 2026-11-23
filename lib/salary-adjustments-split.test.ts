import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION, splitParts, isSplit } from "@/lib/permissions/catalogue"
import { normalizeGrants, grantsFromRows } from "@/lib/permissions/grant-rules"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { can } from "@/lib/permissions/can"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { holdersOf } from "@/lib/permissions/holders"
import { stepUpConfirmed } from "@/lib/permissions/test-actors"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * salary_adjustments.manage split (LATER_CHANGES_PLAN.md §2, PR 382): adding
 * a bonus or a deduction is salary_adjustments.add, and undoing one, rolled
 * back as a mistake or reversed as right when it was made, is
 * salary_adjustments.reverse. Both move money, so both stay high-risk and
 * ask for the step-up code, and both keep what salary_adjustments.manage had:
 * for the company, never on one's own pay. A role still holding
 * salary_adjustments.manage holds both. The real routes run; the salary
 * service, which makes no access decision, is mocked and records what it's
 * asked to do.
 */

const ADD = "salary_adjustments.add"
const REVERSE = "salary_adjustments.reverse"
const PARTS = [ADD, REVERSE]

const state = { session: null as any }
let done: string[] = []
const USERS: Record<string, any> = {
    emp:   { id: "emp",   companyId: "c1", teamLeaderId: null },
    admin: { id: "admin", companyId: "c1", teamLeaderId: null },
}

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        systemSettings: { findUnique: async () => null },
        company: { findUnique: async () => ({ confirmHighRisk: true }) },
        rateLimit: { findUnique: async () => null, upsert: async () => ({ count: 1 }) },
        user: { findUnique: async ({ where }: any) => USERS[where.id] ?? null },
    },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" },
}))
vi.mock("@/lib/services/salary.service", () => ({
    SalaryService: {
        addAdjustment: async (_userId: string, type: string) => { done.push(type); return { id: "adj" } },
        reverseAdjustment: async () => { done.push("reverse"); return {} },
        rollbackAdjustment: async () => { done.push("rollback"); return {} },
    },
}))

const actor = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) })
const signIn = (grants: Grants, confirmed = true) => {
    const user = stepUpConfirmed(actor(grants))
    state.session = { user: confirmed ? user : { ...user, stepUpAt: null } }
}
/** Reaching someone's pay at all: seeing the people, and their salaries. */
const REACH = { "employees.view": "COMPANY", "salary.view": "COMPANY" } as Grants
const ADDS = { ...REACH, [ADD]: "COMPANY" } as Grants
const REVERSES = { ...REACH, [REVERSE]: "COMPANY" } as Grants
/** A role saved before PR 382, still holding the old name. */
const OLD_ROLE = grantsFromRows([
    { permission: "employees.view", scope: "COMPANY" },
    { permission: "salary.view", scope: "COMPANY" },
    { permission: "salary_adjustments.manage", scope: "COMPANY" },
])

const url = (p: string) => `https://nizmo.test${p}`
const post = (p: string, body: unknown) => new Request(url(p), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
const bonus = async (id = "emp") => (await import("@/app/api/users/[id]/bonus/route")).POST(post(`/api/users/${id}/bonus`, { amount: 10, reason: "r" }), { params: { id } })
const deduction = async (id = "emp") => (await import("@/app/api/users/[id]/deduction/route")).POST(post(`/api/users/${id}/deduction`, { amount: 10, reason: "r" }), { params: { id } })
const reverse = async (id = "emp") => (await import("@/app/api/users/[id]/adjustments/[adjId]/reverse/route")).POST(post(`/api/users/${id}/adjustments/a1/reverse`, { reason: "r" }), { params: { id, adjId: "a1" } })
const rollback = async (id = "emp") => (await import("@/app/api/users/[id]/adjustments/[adjId]/rollback/route")).POST(post(`/api/users/${id}/adjustments/a1/rollback`, {}), { params: { id, adjId: "a1" } })
const ROUTES = ["bonus", "deduction", "adjustments/[adjId]/reverse", "adjustments/[adjId]/rollback"].map(r => `app/api/users/[id]/${r}/route.ts`)
const source = (file: string) => stripComments(readFileSync(file, "utf8"))
/** Refused for not holding the part: plainly, never as though it were one's own pay. */
const refusedPlainly = async (res: Response) => {
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: "Forbidden" })
}

beforeEach(() => { done = [] })

describe("the catalogue", () => {
    it("has salary_adjustments.add and .reverse, with codes of their own, each as salary_adjustments.manage was", () => {
        expect(PERMISSIONS[ADD].code).toBe(89)
        expect(PERMISSIONS[REVERSE].code).toBe(90)
        for (const p of PARTS) {
            expect(PERMISSIONS[p as keyof typeof PERMISSIONS], p).toMatchObject({
                module: "SALARY_ADJUSTMENTS", scopes: ["COMPANY"], implies: ["salary.view"],
                highRisk: "Moves money", notOnOwn: true, requires: ["employees.view"],
            })
        }
    })

    it("keeps salary_adjustments.manage, split into the two, and still marked high-risk", () => {
        expect(splitParts("salary_adjustments.manage")).toEqual(PARTS)
        expect(isSplit("salary_adjustments.manage")).toBe(true)
        expect((PERMISSIONS["salary_adjustments.manage"] as { highRisk?: string }).highRisk).toBe("Moves money")
    })

    it("offers Add and Reverse in the role editor's salaries, and salary_adjustments.manage no more", () => {
        expect(PERMISSION_GROUPS.find(g => g.key === "salaries")?.permissions).toEqual(["salary.view", "salary.edit", ...PARTS])
        expect(PERMISSION_GROUPS.flatMap(g => g.permissions)).not.toContain("salary_adjustments.manage")
    })

    it("goes up a version, so every session reloads its grants once", () => {
        expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(12)
    })

    it("seeds the built-in Admin with both, and nobody with salary_adjustments.manage", () => {
        for (const p of PARTS) {
            expect(BUILT_IN_GRANTS.ADMIN[p as keyof Grants], p).toBe("COMPANY")
            expect(BUILT_IN_GRANTS.TEAM_LEADER[p as keyof Grants], p).toBeUndefined()
            expect(BUILT_IN_GRANTS.EMPLOYEE[p as keyof Grants], p).toBeUndefined()
        }
        for (const role of Object.values(BUILT_IN_GRANTS)) expect(role["salary_adjustments.manage"]).toBeUndefined()
    })
})

describe("a role still holding salary_adjustments.manage", () => {
    it("is read as holding both", () => {
        expect(OLD_ROLE[ADD]).toBe("COMPANY")
        expect(OLD_ROLE[REVERSE]).toBe("COMPANY")
        expect(OLD_ROLE["salary_adjustments.manage"]).toBeUndefined()
    })

    it("is saved as both, with See salaries", () => {
        const verdict = normalizeGrants([{ permission: "employees.view", scope: "COMPANY" }, { permission: "salary_adjustments.manage", scope: "COMPANY" }])
        expect(verdict.ok).toBe(true)
        if (verdict.ok) {
            expect(verdict.grants).toMatchObject({ [ADD]: "COMPANY", [REVERSE]: "COMPANY", "salary.view": "COMPANY" })
            expect(verdict.grants["salary_adjustments.manage"]).toBeUndefined()
        }
    })

    it("is found when asking who may add or undo one", () => {
        for (const p of PARTS) {
            expect(holdersOf(p as keyof typeof PERMISSIONS, "COMPANY")).toEqual({ assignedRole: { grants: { some: { permission: { in: [p, "salary_adjustments.manage"] }, scope: "COMPANY" } } } })
        }
    })

    it("gives a session made from it both, over someone else's pay and never its own", () => {
        for (const p of PARTS) {
            expect(can(actor(OLD_ROLE), p as keyof typeof PERMISSIONS, { userId: "emp", companyId: "c1", teamLeaderId: null })).toBe(true)
            expect(can(actor(OLD_ROLE), p as keyof typeof PERMISSIONS, { userId: "admin", companyId: "c1", teamLeaderId: null })).toBe(false)
        }
    })
})

describe("adding a bonus or a deduction", () => {
    it("is done with salary_adjustments.add", async () => {
        signIn(ADDS)
        expect((await bonus()).status).toBe(200)
        expect((await deduction()).status).toBe(200)
        expect(done).toEqual(["BONUS", "DEDUCTION"])
    })

    it("is refused with undoing alone, and nothing is added", async () => {
        signIn(REVERSES)
        await refusedPlainly(await bonus())
        await refusedPlainly(await deduction())
        expect(done).toEqual([])
    })

    it("is still open to a role saved with salary_adjustments.manage", async () => {
        signIn(OLD_ROLE)
        expect((await bonus()).status).toBe(200)
        expect((await deduction()).status).toBe(200)
    })

    it("is never on one's own pay, and says so", async () => {
        signIn(ADDS)
        for (const res of [await bonus("admin"), await deduction("admin")]) {
            expect(res.status).toBe(403)
            expect(await res.json()).toMatchObject({ error: "You cannot adjust your own pay" })
        }
        expect(done).toEqual([])
    })

    it("asks for the step-up code first", async () => {
        signIn(ADDS, false)
        for (const res of [await bonus(), await deduction()]) {
            expect(res.status).toBe(403)
            expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" })
        }
        expect(done).toEqual([])
    })
})

describe("undoing one: reversing it, or rolling it back", () => {
    it("is done with salary_adjustments.reverse", async () => {
        signIn(REVERSES)
        expect((await reverse()).status).toBe(200)
        expect((await rollback()).status).toBe(200)
        expect(done).toEqual(["reverse", "rollback"])
    })

    it("is refused with adding alone, and nothing is undone", async () => {
        signIn(ADDS)
        await refusedPlainly(await reverse())
        await refusedPlainly(await rollback())
        expect(done).toEqual([])
    })

    it("is still open to a role saved with salary_adjustments.manage", async () => {
        signIn(OLD_ROLE)
        expect((await reverse()).status).toBe(200)
        expect((await rollback()).status).toBe(200)
    })

    it("is never on one's own pay, and says so", async () => {
        signIn(REVERSES)
        for (const res of [await reverse("admin"), await rollback("admin")]) {
            expect(res.status).toBe(403)
            expect(await res.json()).toMatchObject({ error: "You cannot adjust your own pay" })
        }
        expect(done).toEqual([])
    })

    it("asks for the step-up code first", async () => {
        signIn(REVERSES, false)
        for (const res of [await reverse(), await rollback()]) {
            expect(res.status).toBe(403)
            expect(await res.json()).toMatchObject({ code: "STEP_UP_REQUIRED" })
        }
        expect(done).toEqual([])
    })

    it("leaves no route asking salary_adjustments.manage", () => {
        for (const file of ROUTES) expect(source(file), file).not.toContain("salary_adjustments.manage")
    })
})

describe("the screens", () => {
    it("offer Add bonus and Add deduction on the employee list with adding", () => {
        const list = source("app/(dashboard)/dashboard/employees/page.tsx")
        expect(list).toContain("|| (features.has('SALARY_ADJUSTMENTS') && can('salary_adjustments.add'))")
        expect(list).toContain("if (features.has('SALARY_ADJUSTMENTS') && can('salary_adjustments.add') && notAdmin) {")
        expect(list).not.toContain("salary_adjustments.manage")
    })

    it("open the bonus and deduction page with adding", () => {
        const page = source("app/(dashboard)/dashboard/employees/[id]/AddAdjustment.tsx")
        expect(page).toContain("const mayAdjust = can('salary_adjustments.add')")
        expect(page).not.toContain("salary_adjustments.manage")
    })

    it("offer Reverse and Roll back in someone's history with undoing", () => {
        const history = source("app/(dashboard)/dashboard/employees/[id]/history/page.tsx")
        expect(history).toContain("const canUndo = canFor('salary_adjustments.reverse', params.id as string | undefined)")
        expect(history).toContain("canUndo={canUndo}")
        expect(history).not.toContain("salary_adjustments.manage")
    })
})

describe("the words", () => {
    it("say what each does, in both languages", () => {
        expect(en.perm_salary_adjustments_add).toBe("Add bonuses and deductions")
        expect(en.perm_salary_adjustments_reverse).toBe("Reverse or roll back bonuses and deductions")
        expect(ar.perm_salary_adjustments_add).toBe("إضافة المكافآت والخصومات")
        expect(ar.perm_salary_adjustments_reverse).toBe("إلغاء المكافآت والخصومات أو التراجع عنها")
    })
})
