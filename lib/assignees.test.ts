import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { matchesUserWhere, withGrants } from "./permissions/test-actors"
import { encodeGrants } from "./permissions/grants"
import { serializeAccess, type Bundle } from "./features/bundles"
import { assigneesUrl } from "./assignees-url"

vi.setConfig({ testTimeout: 120_000 })

/**
 * Who the four pickers that hand work to someone offer (LATER_CHANGES_PLAN.md
 * §5.1 rule 5, PR 371): Add obligation, reassigning one, Create task and
 * Transfer task. They asked the employee list, which only "See employees"
 * reads, so a role that may hand out work and not see employees was refused.
 * Each now asks a list of its own, for whoever holds that action's
 * permission: names, and the role each checklist shows beside them, and for
 * Create task the username its bulk upload matches by, as its template
 * already has.
 *
 * The list and the check on saving (checkAssignees) are one rule, held to
 * the same people here. Two changes came with it: transferring a task under
 * a permission held for a team goes to the team, as creating and
 * reassigning do (the owner's decision, 2026-11-22); and a deleted account
 * is never offered, and the check refuses handing work to one, though
 * someone deleted who is already on the work stays.
 */

type Person = { id: string; companyId: string; role: string; teamLeaderId: string | null; status: string; firstName: string; lastName: string; username: string; email: string; phone: string }
const person = (id: string, companyId: string, role: string, teamLeaderId: string | null, status = "ACTIVE"): Person =>
    ({ id, companyId, role, teamLeaderId, status, firstName: id.toUpperCase(), lastName: "Made-up", username: `${id}-user`, email: `${id}@made-up.example`, phone: "0100" })
const PEOPLE: Person[] = [
    person("admin", "c1", "ADMIN", null),
    // An Admin someone put on a team: still never given work by its leader.
    person("boss", "c1", "ADMIN", "tl"),
    person("tl", "c1", "TEAM_LEADER", null),
    person("emp", "c1", "EMPLOYEE", "tl"),
    person("loner", "c1", "EMPLOYEE", null),
    person("gone", "c1", "EMPLOYEE", "tl", "DELETED"),
    person("other", "c2", "EMPLOYEE", null),
]

const pick = (p: Person, select?: Record<string, boolean>) => select ? Object.fromEntries(Object.keys(select).filter(k => select[k]).map(k => [k, (p as any)[k]])) : p
const users = { findMany: async ({ where, select }: any) => PEOPLE.filter(p => matchesUserWhere(p, where ?? {})).map(p => pick(p, select)) }
const empty = { findUnique: async () => null, findFirst: async () => null, findMany: async () => [], count: async () => 0 }
const prismaMock: any = new Proxy({}, { get: (_t, prop: string) => (prop === "user" ? { ...empty, ...users } : prop === "$transaction" ? async (fn: any) => fn(prismaMock) : empty) })

const state = { session: null as any }
vi.mock("next-auth", () => ({ getServerSession: async () => state.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/services/audit-log.service", () => ({ AuditLogService: { log: async () => {}, logSystemError: async () => "ref", friendlyErrorMessage: () => "error" } }))

const FOUR = ["tasks.create", "obligations.create", "obligations.edit", "tasks.transfer"] as const
type Four = typeof FOUR[number]
const holding = (scope: "TEAM" | "COMPANY") => encodeGrants(Object.fromEntries(FOUR.map(p => [p, scope])) as never)
const VIEWERS = {
    "the Admin": withGrants({ id: "admin", role: "ADMIN", companyId: "c1" }),
    "the Team Leader": withGrants({ id: "tl", role: "TEAM_LEADER", companyId: "c1" }),
    "a role holding the four for the company": { id: "emp", role: "EMPLOYEE", companyId: "c1", grants: holding("COMPANY") },
    "a role holding the four for a team it doesn't lead": { id: "loner", role: "EMPLOYEE", companyId: "c1", grants: holding("TEAM") },
}

beforeEach(() => { state.session = null })

async function list(user: any, permission: string, query = "") {
    state.session = { user }
    const { GET } = await import("@/app/api/assignees/route")
    const res = await GET(new Request(`https://nizmo.test/api/assignees?for=${permission}${query}`))
    return { status: res.status, body: await res.json() }
}
async function check(user: any, ids: string[], permission: Four, options?: { kept?: string[] }) {
    const { checkAssignees } = await import("./services/assignee-guard")
    return checkAssignees(ids, { user }, permission, options)
}

describe("the list and the check on saving offer the same people", () => {
    for (const [who, user] of Object.entries(VIEWERS)) {
        for (const permission of FOUR) {
            it(`${who}, for ${permission}`, async () => {
                const { status, body } = await list(user, permission)
                expect(status).toBe(200)
                const offered = (body.data as { id: string }[]).map(p => p.id).sort()
                const accepted: string[] = []
                for (const p of PEOPLE) if ((await check(user, [p.id], permission)).ok) accepted.push(p.id)
                expect(offered).toEqual(accepted.sort())
            })
        }
    }

    it("is, held for a team, oneself and the people one leads, no Admins; for the company, everyone in it; never a deleted account or another company's", async () => {
        const ids = async (user: any) => ((await list(user, "obligations.create")).body.data as { id: string }[]).map(p => p.id).sort()
        expect(await ids(VIEWERS["the Team Leader"])).toEqual(["emp", "tl"])
        expect(await ids(VIEWERS["a role holding the four for a team it doesn't lead"])).toEqual(["loner"])
        expect(await ids(VIEWERS["the Admin"])).toEqual(["admin", "boss", "emp", "loner", "tl"])
    })

    it("is, for a Super Admin, the company they picked, without its deleted accounts", async () => {
        const sa = { id: "sa", role: "SUPER_ADMIN", companyId: null }
        const { body } = await list(sa, "tasks.create", "&companyId=c1")
        expect((body.data as { id: string }[]).map(p => p.id).sort()).toEqual(["admin", "boss", "emp", "loner", "tl"])
        expect((await check(sa, ["gone"], "tasks.create")).ok).toBe(false)
    })
})

describe("what the list gives", () => {
    it("is each person's name and role, and nothing else of them", async () => {
        for (const permission of ["obligations.create", "obligations.edit", "tasks.transfer"]) {
            const { body } = await list(VIEWERS["the Admin"], permission)
            for (const p of body.data) expect(Object.keys(p).sort()).toEqual(["firstName", "id", "lastName", "role"])
        }
    })

    it("has, for Create task, the username too, as its bulk upload matches by it and its template lists it", async () => {
        const { body } = await list(VIEWERS["the Admin"], "tasks.create")
        for (const p of body.data) expect(Object.keys(p).sort()).toEqual(["firstName", "id", "lastName", "role", "username"])
        const template = stripComments(readFileSync("app/api/templates/download/route.ts", "utf8"))
        expect(template).toContain("select: { firstName: true, lastName: true, username: true, role: true }")
    })
})

describe("who may ask it", () => {
    it("only whoever holds that action's permission, and only for those four", async () => {
        const employee = withGrants({ id: "emp", role: "EMPLOYEE", companyId: "c1" })
        for (const permission of FOUR) expect((await list(employee, permission)).status).toBe(403)
        expect((await list(VIEWERS["the Admin"], "employees.view")).status).toBe(400)
        expect((await list(VIEWERS["the Admin"], "")).status).toBe(400)
    })

    it("only in a package with that action's area: Tasks for the task pickers, Obligations for the obligation ones", async () => {
        const inPackage = (...bundles: Bundle[]) => ({ ...VIEWERS["the Admin"], featureAccess: serializeAccess({ unrestricted: false, bundles: new Set(bundles) }) })
        for (const permission of FOUR) {
            expect((await list(inPackage("HR"), permission)).status, permission).toBe(403)
            expect((await list(inPackage("COMPANY_MANAGEMENT"), permission)).status, permission).toBe(200)
        }
    })

    it("needs no See employees", async () => {
        const role = { id: "emp", role: "EMPLOYEE", companyId: "c1", grants: encodeGrants({ "tasks.create": "COMPANY" } as never) }
        expect((await list(role, "tasks.create")).status).toBe(200)
    })

    it("gives a Super Admin with no company picked everyone's, as they may assign anywhere, and never lets anyone else name one", async () => {
        const sa = { id: "sa", role: "SUPER_ADMIN", companyId: null }
        const everyone = await list(sa, "tasks.create")
        expect((everyone.body.data as { id: string }[]).map(p => p.id).sort()).toEqual(["admin", "boss", "emp", "loner", "other", "tl"])
        for (const p of PEOPLE) expect((await check(sa, [p.id], "tasks.create")).ok).toBe(p.status !== "DELETED")
        const { body } = await list(VIEWERS["the Admin"], "tasks.create", "&companyId=c2")
        expect((body.data as { id: string }[]).map(p => p.id)).not.toContain("other")
    })
})

describe("a deleted account", () => {
    it("can't be given work, though someone deleted who is already on it stays", async () => {
        const leader = VIEWERS["the Team Leader"]
        expect(await check(leader, ["gone"], "obligations.edit")).toEqual({ ok: false, reason: "NOT_FOUND" })
        expect(await check(leader, ["emp", "gone"], "obligations.edit", { kept: ["gone"] })).toEqual({ ok: true })
        expect(await check(VIEWERS["the Admin"], ["gone"], "tasks.create")).toEqual({ ok: false, reason: "NOT_FOUND" })
    })

    it("is kept, on saving, only for whoever the work already has", () => {
        const obligations = stripComments(readFileSync("lib/services/obligation.service.ts", "utf8"))
        expect(obligations).toContain('checkAssignees(assigneeIds, session, "obligations.edit", { client: tx as any, kept: current.assignees.map(a => a.id) })')
        const tasks = stripComments(readFileSync("lib/services/task.service.ts", "utf8"))
        expect(tasks).toContain('checkAssignees(assigneeIds, session, "tasks.create", { kept: existingTask.assignees.map(a => a.id) })')
    })
})

describe("transferring a task", () => {
    it("goes through the same check, for what it adds: held for a team, to the team", async () => {
        const source = stripComments(readFileSync("lib/services/task.service.ts", "utf8"))
        expect(source).toContain('checkAssignees(addedIds, session, "tasks.transfer", { client: tx as any })')
        expect(source).not.toContain("TL_RESTRICTION")
        const leader = VIEWERS["the Team Leader"]
        expect(await check(leader, ["loner"], "tasks.transfer")).toEqual({ ok: false, reason: "OUTSIDE_TEAM" })
        expect(await check(leader, ["admin"], "tasks.transfer")).toEqual({ ok: false, reason: "ADMIN_TARGET" })
        expect(await check(leader, ["emp"], "tasks.transfer")).toEqual({ ok: true })
    })

    it("says why, for each refusal", () => {
        const route = stripComments(readFileSync("app/api/tasks/[id]/transfer/route.ts", "utf8"))
        for (const code of ["TRANSFER_ASSIGNEE_NOT_FOUND", "CROSS_COMPANY_TRANSFER_FORBIDDEN", "TRANSFER_TO_ADMIN_FORBIDDEN", "TRANSFER_OUTSIDE_TEAM_FORBIDDEN"]) {
            expect(route).toContain(`error.message === '${code}'`)
        }
    })
})

describe("the route, in ROLES_PLAN.md", () => {
    it("is with each of the four permissions", () => {
        const plan = readFileSync("ROLES_PLAN.md", "utf8")
        for (const permission of FOUR) {
            const row = plan.split("\n").find(line => line.includes(`| \`${permission}\` |`))
            expect(row, permission).toContain("`GET /assignees`")
        }
    })
})

describe("each picker's address", () => {
    it("names its action, and the company only when there is one", () => {
        expect(assigneesUrl("tasks.transfer", "c1")).toBe("/api/assignees?for=tasks.transfer&companyId=c1")
        expect(assigneesUrl("obligations.create", null)).toBe("/api/assignees?for=obligations.create")
    })
})
