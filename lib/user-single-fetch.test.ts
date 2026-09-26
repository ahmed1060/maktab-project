import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildSingleUserWhere, canViewSalaryOf } from "@/lib/services/user-query"

/**
 * GET /api/users?id=… — reading one person.
 *
 * It looked the user up by id alone. An Admin or Team Leader of one company
 * could read any user of another by passing their id, and an Admin got the
 * salary with it. A Team Leader could also read anyone in their own company,
 * not only their team.
 *
 * Two layers of tests. The pure builder is checked directly, and the real
 * exported handler is driven with a mocked session and an in-memory user table,
 * so the status code and the salary field are asserted as a caller sees them —
 * not inferred from a where clause.
 */

// --- fixtures -------------------------------------------------------------

const USERS = [
    { id: "a-1",  companyId: "co-1", role: "ADMIN",       teamLeaderId: null,   salary: 9000 },
    { id: "tl-1", companyId: "co-1", role: "TEAM_LEADER", teamLeaderId: null,   salary: 7000 },
    { id: "e-1",  companyId: "co-1", role: "EMPLOYEE",    teamLeaderId: "tl-1", salary: 5000 }, // on tl-1's team
    { id: "e-2",  companyId: "co-1", role: "EMPLOYEE",    teamLeaderId: null,   salary: 5100 }, // same company, no team
    { id: "x-1",  companyId: "co-2", role: "EMPLOYEE",    teamLeaderId: null,   salary: 4000 }, // another company
]

const s = (id: string, role: string, companyId: string | null = "co-1") => ({ user: { id, role, companyId } })
const admin = s("a-1", "ADMIN")
const leader = s("tl-1", "TEAM_LEADER")
const employee = s("e-1", "EMPLOYEE")
const superAdmin = s("sa-1", "SUPER_ADMIN", null)

// --- the pure builder -----------------------------------------------------

describe("buildSingleUserWhere", () => {
    it("scopes an Admin to their company", () => {
        expect(buildSingleUserWhere(admin, "x-1")).toEqual({ outcome: "query", where: { id: "x-1", companyId: "co-1" } })
    })

    it("scopes a Team Leader to their company and their team", () => {
        const r = buildSingleUserWhere(leader, "e-2")
        expect(r.outcome).toBe("query")
        const where = (r as any).where
        expect(where.companyId).toBe("co-1")
        expect(where.AND).toContainEqual({ OR: [{ teamLeaderId: "tl-1" }, { id: "tl-1" }] })
    })

    it("leaves a Super Admin unscoped", () => {
        expect(buildSingleUserWhere(superAdmin, "x-1")).toEqual({ outcome: "query", where: { id: "x-1" } })
    })

    it("lets anyone read themselves", () => {
        expect(buildSingleUserWhere(employee, "e-1")).toEqual({ outcome: "query", where: { id: "e-1" } })
    })

    it("refuses an Employee reading someone else", () => {
        expect(buildSingleUserWhere(employee, "e-2")).toEqual({ outcome: "forbidden" })
    })

    it("finds nobody for an Admin with no company, rather than dropping the company condition", () => {
        expect(buildSingleUserWhere(s("a-9", "ADMIN", null), "x-1")).toEqual({ outcome: "not-found" })
    })
})

describe("canViewSalaryOf", () => {
    it("an Admin and a Super Admin see it", () => {
        expect(canViewSalaryOf(admin, "e-1")).toBe(true)
        expect(canViewSalaryOf(superAdmin, "e-1")).toBe(true)
    })
    it("a Team Leader does not see a report's", () => {
        expect(canViewSalaryOf(leader, "e-1")).toBe(false)
    })
    it("everyone sees their own", () => {
        expect(canViewSalaryOf(employee, "e-1")).toBe(true)
        expect(canViewSalaryOf(leader, "tl-1")).toBe(true)
    })
})

// --- the real handler -----------------------------------------------------

/** Enough of Prisma's where semantics for the clauses the builder produces. An
 *  unrecognised key throws, so a change to the builder cannot pass here by being
 *  silently ignored. */
function matches(where: any, row: any): boolean {
    return Object.entries(where).every(([key, value]: [string, any]) => {
        if (key === "AND") return (value as any[]).every(w => matches(w, row))
        if (key === "OR") return (value as any[]).some(w => matches(w, row))
        if (["id", "companyId", "teamLeaderId"].includes(key)) return row[key] === value
        throw new Error(`test double does not understand where key "${key}"`)
    })
}

const prismaMock: any = {
    user: { findFirst: vi.fn(async ({ where }: any) => USERS.find(u => matches(where, u)) ?? null) },
    superAdmin: { findUnique: vi.fn(async () => null) },
}
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))

const session = { value: null as any }
vi.mock("next-auth", () => ({ getServerSession: async () => session.value }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))

async function fetchUser(as: any, id: string) {
    session.value = as
    const { GET } = await import("@/app/api/users/route")
    const res = await GET(new Request(`https://nizmo.test/api/users?id=${id}`))
    const body = res.status === 200 ? await res.json() : null
    return { status: res.status, user: body?.data ?? body }
}

describe("GET /api/users?id= — one person", () => {
    beforeEach(() => { session.value = null })

    it("an Admin of company A asking for a user of company B gets 404, and no salary", async () => {
        const r = await fetchUser(admin, "x-1")
        expect(r.status).toBe(404)
        expect(r.user).toBeNull()
    })

    it("a Team Leader asking for a same-company user outside their team gets 404", async () => {
        expect((await fetchUser(leader, "e-2")).status).toBe(404)
    })

    it("a Team Leader asking for someone in another company gets 404", async () => {
        expect((await fetchUser(leader, "x-1")).status).toBe(404)
    })

    it("a Team Leader asking for a team member gets them, without the salary", async () => {
        const r = await fetchUser(leader, "e-1")
        expect(r.status).toBe(200)
        expect(r.user.id).toBe("e-1")
        expect(r.user.salary).toBeUndefined()
    })

    it("an Admin asking for a same-company user gets them, with the salary", async () => {
        const r = await fetchUser(admin, "e-2")
        expect(r.status).toBe(200)
        expect(r.user.salary).toBe(5100)
    })

    it("an Employee asking for themselves gets their own salary", async () => {
        const r = await fetchUser(employee, "e-1")
        expect(r.status).toBe(200)
        expect(r.user.salary).toBe(5000)
    })

    it("an Employee asking for someone else is refused, as before", async () => {
        expect((await fetchUser(employee, "e-2")).status).toBe(403)
    })

    it("a Super Admin can read a user in any company", async () => {
        const r = await fetchUser(superAdmin, "x-1")
        expect(r.status).toBe(200)
        expect(r.user.salary).toBe(4000)
    })
})
