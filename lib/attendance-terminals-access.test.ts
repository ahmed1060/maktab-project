import { describe, it, expect, vi, beforeEach } from "vitest"
import { state, prismaMock, withBody, url } from "./permissions/employee-access.harness"
import { encodeGrants } from "./permissions/grants"
import { stepUpConfirmed } from "./permissions/test-actors"
import { BUILT_IN_GRANTS } from "./permissions/built-in"
import { serializeAccess, resolveBundles } from "./features/bundles"

vi.setConfig({ testTimeout: 60_000 })

/**
 * Who reaches a company's terminals and agents (ATTENDANCE_PLAN.md §16, §17).
 *
 * On the website they are part of the Attendance settings tab, and only for
 * a company holding the Terminals add-on. On the agent's side there is no
 * session: the token says which agent, and so which company. The services
 * are replaced; what is checked here is who reaches them.
 */

vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const reached: string[] = []
const TOKENS: Record<string, any> = {
    "mka_good": { id: "ag1", companyId: "c1", name: "Office", timeZone: "Africa/Cairo" },
    "mka_revoked": { refused: "UNAUTHENTICATED" },
    "mka_banned": { refused: "COMPANY_BANNED" },
    "mka_unsold": { refused: "TERMINALS_NOT_INCLUDED" },
}
vi.mock("@/lib/services/attendance-agent.service", () => ({
    AttendanceAgentService: {
        list: async (companyId: string) => { reached.push(`agents:${companyId}`); return [] },
        create: async (companyId: string, name: string) => { reached.push(`createAgent:${companyId}:${name}`); return { agent: { id: "new" }, code: "K7QD-2MXP" } },
        agentOf: async (id: string) => ({ ag1: { id: "ag1", companyId: "c1", status: "ACTIVE" }, ag2: { id: "ag2", companyId: "c2", status: "ACTIVE" } } as any)[id] ?? null,
        revoke: async (id: string) => { reached.push(`revoke:${id}`) },
        reissueCode: async (id: string) => { reached.push(`reissue:${id}`); return { agent: { id }, code: "K7QD-2MXP" } },
        enrol: async (code: string) => {
            reached.push(`enrol:${code}`)
            if (code !== "K7QD-2MXP") throw new Error("ENROLMENT_CODE_INVALID")
            return { token: "mka_new", agentId: "ag1", name: "Office", company: "One", timeZone: "Africa/Cairo" }
        },
        authenticate: async (token: string) => TOKENS[token] ?? { refused: "UNAUTHENTICATED" },
        rotate: async (agent: { id: string }) => { reached.push(`rotate:${agent.id}`); return { token: "mka_next" } },
    },
}))

type Pkg = { hasCompanyManagement: boolean; hasHR: boolean; hasAttendanceTerminals?: boolean; hasAttendanceMobile?: boolean } | null
const TERMINALS: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceTerminals: true }
const MOBILE_ONLY: Pkg = { hasCompanyManagement: false, hasHR: true, hasAttendanceMobile: true }
const companies: Record<string, { adminSettingsEnabled: boolean; adminSettingsTabs: string[]; package: Pkg }> = {}

beforeEach(() => {
    reached.length = 0
    companies.c1 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: TERMINALS }
    companies.c2 = { adminSettingsEnabled: true, adminSettingsTabs: ["attendance"], package: TERMINALS }
    prismaMock.company.findUnique = async ({ where }: any) => companies[where.id] ? { id: where.id, ...companies[where.id] } : null
})

function signIn(user: { id: string; role: string; companyId: string | null; grants?: Record<string, string> }, pkg: Pkg = TERMINALS) {
    state.session = {
        user: stepUpConfirmed({
            ...user,
            grants: user.grants ? encodeGrants(user.grants as any) : undefined,
            featureAccess: serializeAccess(resolveBundles(pkg, { isSuperAdmin: user.role === "SUPER_ADMIN" })),
        }),
    }
}
const admin = (pkg: Pkg = TERMINALS) => signIn({ id: "admin", role: "ADMIN", companyId: "c1", grants: BUILT_IN_GRANTS.ADMIN }, pkg)
const employee = () => signIn({ id: "emp", role: "EMPLOYEE", companyId: "c1", grants: BUILT_IN_GRANTS.EMPLOYEE })
const viewer = () => signIn({ id: "hr", role: "EMPLOYEE", companyId: "c1", grants: { "settings.view": "COMPANY" } })
const superAdmin = () => signIn({ id: "sa", role: "SUPER_ADMIN", companyId: null })

const params = (id: string) => ({ params: Promise.resolve({ id }) }) as any
const list = async (query = "") => (await import("@/app/api/attendance/agents/route")).GET(new Request(url(`/api/attendance/agents${query}`)))
const add = async (body: unknown) => (await import("@/app/api/attendance/agents/route")).POST(withBody("POST", "/api/attendance/agents", body))
const revoke = async (id: string) => (await import("@/app/api/attendance/agents/[id]/route")).DELETE(new Request(url(`/api/attendance/agents/${id}`), { method: "DELETE" }), params(id))
const reissue = async (id: string) => (await import("@/app/api/attendance/agents/[id]/code/route")).POST(new Request(url(`/api/attendance/agents/${id}/code`), { method: "POST" }), params(id))

describe("on the website: the Attendance settings tab, with the Terminals add-on", () => {
    it("an Admin with the tab adds, lists, re-codes and revokes their own company's agents", async () => {
        admin()
        expect((await list()).status).toBe(200)
        const created = await add({ name: "Head office" })
        expect(created.status).toBe(201)
        expect((await created.json()).data.code).toBe("K7QD-2MXP")
        expect((await reissue("ag1")).status).toBe(200)
        expect((await revoke("ag1")).status).toBe(200)
        expect(reached).toEqual(["agents:c1", "createAgent:c1:Head office", "reissue:ag1", "revoke:ag1"])
    })

    it("is held to their own company: another's agent is as if absent", async () => {
        admin()
        expect((await add({ name: "Theirs", companyId: "c2" })).status).toBe(201)
        expect((await revoke("ag2")).status).toBe(404)
        expect((await reissue("ag2")).status).toBe(404)
        expect((await revoke("nope")).status).toBe(404)
        expect(reached).toEqual(["createAgent:c1:Theirs"])
    })

    it("lets whoever only sees settings look, not change", async () => {
        viewer()
        expect((await list()).status).toBe(200)
        expect((await add({ name: "Mine" })).status).toBe(403)
        expect((await revoke("ag1")).status).toBe(403)
        expect((await reissue("ag1")).status).toBe(403)
        expect(reached).toEqual(["agents:c1"])
    })

    it("shows nothing to an employee", async () => {
        employee()
        expect((await list()).status).toBe(404)
        expect((await add({ name: "Mine" })).status).toBe(404)
        expect(reached).toEqual([])
    })

    it("is closed to a company with attendance from the app only", async () => {
        companies.c1.package = MOBILE_ONLY
        admin(MOBILE_ONLY)
        expect((await list()).status).toBe(403)
        expect((await add({ name: "Head office" })).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("lets the Super Admin act for a company they name", async () => {
        superAdmin()
        expect((await list()).status).toBe(400)
        expect((await list("?companyId=c2")).status).toBe(200)
        expect((await revoke("ag2")).status).toBe(200)
        expect(reached).toEqual(["agents:c2", "revoke:ag2"])
    })
})

const agentCall = async (token: string | null, body: unknown = {}, extra: Record<string, string> = {}) =>
    (await import("@/app/api/agent/token/route")).POST(new Request(url("/api/agent/token"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
        body: typeof body === "string" ? body : JSON.stringify(body),
    }))
const enrol = async (body: unknown) => (await import("@/app/api/agent/enrol/route")).POST(withBody("POST", "/api/agent/enrol", body))

describe("on the agent's side: the token is the identity", () => {
    it("enrols with a valid code, and says nothing more for a wrong one", async () => {
        const ok = await enrol({ code: "K7QD-2MXP", hostname: "OFFICE-PC" })
        expect(ok.status).toBe(201)
        expect((await ok.json()).data.token).toBe("mka_new")
        const bad = await enrol({ code: "AAAA-AAAA" })
        expect(bad.status).toBe(400)
        expect((await bad.json()).code).toBe("ENROLMENT_CODE_INVALID")
        expect((await enrol({})).status).toBe(400)
        expect(reached).toEqual(["enrol:K7QD-2MXP", "enrol:AAAA-AAAA"])
    })

    it("refuses a request with no token, a malformed one, or one that is not an agent's", async () => {
        state.session = null
        for (const token of [null, "abc", "mka_revoked"]) {
            const res = await agentCall(token)
            expect(res.status).toBe(401)
            expect((await res.json()).code).toBe("UNAUTHENTICATED")
        }
        expect(reached).toEqual([])
    })

    it("refuses a banned company's agent, and one whose company no longer has terminals", async () => {
        expect((await (await agentCall("mka_banned")).json()).code).toBe("COMPANY_BANNED")
        expect((await agentCall("mka_unsold")).status).toBe(403)
        expect(reached).toEqual([])
    })

    it("lets an enrolled agent through, with no session at all", async () => {
        state.session = null
        const res = await agentCall("mka_good")
        expect(res.status).toBe(200)
        expect((await res.json()).data.token).toBe("mka_next")
        expect(reached).toEqual(["rotate:ag1"])
    })

    it("refuses a body that is not a JSON object, or too large", async () => {
        expect((await (await agentCall("mka_good", "[1,2]")).json()).code).toBe("INVALID_BODY")
        expect((await (await agentCall("mka_good", "{nope")).json()).code).toBe("INVALID_BODY")
        expect((await agentCall("mka_good", {}, { "Content-Length": String(3 * 1024 * 1024) })).status).toBe(413)
        expect(reached).toEqual([])
    })
})
