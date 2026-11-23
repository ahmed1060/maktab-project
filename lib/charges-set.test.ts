import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { PERMISSIONS, CATALOGUE_VERSION } from "@/lib/permissions/catalogue"
import { encodeGrants, type Grants } from "@/lib/permissions/grants"
import { PERMISSION_GROUPS } from "@/lib/permissions/matrix"
import { BUILT_IN_GRANTS } from "@/lib/permissions/built-in"
import { stepUpConfirmed } from "@/lib/permissions/test-actors"
import { state, prismaMock as clientsPrisma, withBody } from "@/lib/permissions/client-access.harness"
import { stripComments } from "./strip-comments"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

vi.setConfig({ testTimeout: 120_000 })

/**
 * charges.manage named charges.set (LATER_CHANGES_PLAN.md §2, PR 380): the
 * table splits it into setting a charge (its service fee, or leaving it off
 * the client's bill) and collecting it, and collecting has had its own
 * permission, charges.collect, since the Charged to clients tab. So what
 * charges.manage did is charges.set, as a split into one: a role still
 * holding charges.manage holds charges.set, and never charges.collect,
 * which moves money and was never part of it. The real route and service run.
 */

/** A charge of the first company's: a cost on a task with a client. */
const COST = { id: "x1", taskId: "t1", amount: 100, serviceFee: 0, notCharged: false, collectedAt: null, task: { companyId: "c1", clientId: "v-1" } }
let written: Record<string, unknown>[] = []
const prismaMock: any = new Proxy({}, {
    get(_t, prop: string) {
        if (prop === "taskCost") return {
            findUnique: async () => ({ ...COST }),
            update: async ({ where, data }: any) => { written.push({ id: where.id, ...data }); return { id: where.id, serviceFee: data.serviceFee ?? 0, notCharged: data.notCharged ?? false } },
        }
        if (prop === "auditLog") return { create: async () => ({}) }
        if (prop === "$transaction") return async (fn: any) => (typeof fn === "function" ? fn(prismaMock) : Promise.all(fn))
        if (prop === "$queryRaw") return async (sql: TemplateStringsArray) => (sql.join("?").includes('SELECT "taskId" FROM "TaskCost"') ? [{ taskId: "t1" }] : [])
        return clientsPrisma[prop]
    },
})

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/storage", () => ({ supabase: { storage: { from: () => ({ remove: async () => ({}) }) } } }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))
vi.mock("@/lib/services/notification.service", () => ({ NotificationService: { notify: async () => {}, notifyMany: async () => {} } }))

const actor = (grants: Grants) => ({ id: "admin", role: "ADMIN", companyId: "c1", grants: encodeGrants(grants) })
const signIn = (grants: Grants) => { state.session = { user: stepUpConfirmed(actor(grants)) } }
const SEES = { "charges.view": "COMPANY" } as Grants

const patch = async (body: Record<string, unknown>) => (await import("@/app/api/charges/[costId]/route")).PATCH(withBody("PATCH", "/api/charges/x1", body), { params: { costId: "x1" } })
const setFee = () => patch({ serviceFee: 15 })
const leaveOff = () => patch({ notCharged: true })

beforeEach(() => { written = [] })

describe("the catalogue", () => {
    it("has charges.set, with a code of its own, for the company, including See charges, and not high-risk", () => {
        expect(PERMISSIONS["charges.set"].code).toBe(85)
        expect(PERMISSIONS["charges.set"]).toMatchObject({ module: "COSTS", scopes: ["COMPANY"], implies: ["charges.view"] })
        expect((PERMISSIONS["charges.set"] as { highRisk?: string }).highRisk).toBeUndefined()
    })

    it("offers See, Set and Collect charges in the role editor, and charges.manage no more", () => {
        const all = PERMISSION_GROUPS.flatMap(g => g.permissions)
        expect(all.filter(p => p.startsWith("charges."))).toEqual(["charges.view", "charges.set", "charges.collect"])
    })

    it("goes up a version, so every session reloads its grants once", () => {
        // 10 for this; 11 since the client accounts split (PR 381).
        expect(CATALOGUE_VERSION).toBeGreaterThanOrEqual(10)
    })

    it("seeds the built-in Admin with charges.set, and nobody with charges.manage", () => {
        expect(BUILT_IN_GRANTS.ADMIN["charges.set"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.ADMIN["charges.collect"]).toBe("COMPANY")
        expect(BUILT_IN_GRANTS.TEAM_LEADER["charges.set"]).toBeUndefined()
        expect(BUILT_IN_GRANTS.EMPLOYEE["charges.set"]).toBeUndefined()
        for (const role of Object.values(BUILT_IN_GRANTS)) expect((role as Record<string, unknown>)["charges.manage"]).toBeUndefined()
    })
})

describe("setting a charge", () => {
    it("sets its service fee with charges.set, and not with collecting", async () => {
        signIn({ ...SEES, "charges.collect": "COMPANY" })
        expect((await setFee()).status).toBe(403)
        expect(written).toEqual([])
        signIn({ ...SEES, "charges.set": "COMPANY" })
        expect((await setFee()).status).toBe(200)
        expect(written).toEqual([{ id: "x1", serviceFee: 15 }])
    })

    it("leaves it off the client's bill with charges.set, and not with collecting", async () => {
        signIn({ ...SEES, "charges.collect": "COMPANY" })
        expect((await leaveOff()).status).toBe(403)
        expect(written).toEqual([])
        signIn({ ...SEES, "charges.set": "COMPANY" })
        expect((await leaveOff()).status).toBe(200)
        expect(written).toEqual([{ id: "x1", notCharged: true }])
    })

    it("asks charges.set on the route and in the service, and the Charged to clients tab offers it by that name", () => {
        const route = stripComments(readFileSync("app/api/charges/[costId]/route.ts", "utf8"))
        expect(route).toContain('}, { permission: "charges.set" })')
        const service = stripComments(readFileSync("lib/services/charge.service.ts", "utf8"))
        expect(service).toContain('const cost = await ChargeService.held(tx, session, costId, "charges.set")')
        expect(service).not.toContain("charges.manage")
        const list = stripComments(readFileSync("components/charges/ChargesList.tsx", "utf8"))
        expect(list).toContain("const canSet = can('charges.set')")
        expect(list).toContain(": !canSet ? [] : c.notCharged")
        expect(list).toContain("...(canSet || canCollect ? [{ key: 'actions'")
        expect(list).not.toContain("charges.manage")
    })
})

describe("the words", () => {
    it("say what it does, in both languages", () => {
        expect(en.perm_charges_set).toBe("Set service fees, and what's charged to the client")
        expect(ar.perm_charges_set).toBe("تحديد رسوم الخدمة وما يُحمَّل على العميل")
    })
})
