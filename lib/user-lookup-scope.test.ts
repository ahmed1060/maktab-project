import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Looking one person up by id.
 *
 * The role check on this route said which *kinds of people* may look somebody
 * up. It never said which *people*. So an Admin or Team Leader could fetch any
 * user in any company by id and receive the whole row — name, email, username,
 * role, status, leave balance — with salary included for an Admin, because the
 * salary decision keys on the role alone and never on the company.
 *
 * Every other per-user route calls verifyResourceAccess. This one, the one
 * that returns the entire record, did not.
 */

const db = {
    rows: {} as Record<string, any>,
    session: null as any,
}

vi.mock("next-auth", () => ({ getServerSession: async () => db.session }))
vi.mock("@/lib/auth", () => ({ authOptions: {} }))
vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: async ({ where }: any) => db.rows[where.id] ?? null,
            findMany: async () => [],
            count: async () => 0,
        },
        superAdmin: { findUnique: async () => null },
        company: { findUnique: async () => null },
    },
}))

const CO = "co-1"
function seed() {
    db.rows = {
        "mine": { id: "mine", companyId: CO, role: "EMPLOYEE", teamLeaderId: "tl-1", salary: 5000, firstName: "A", lastName: "B" },
        "other-team": { id: "other-team", companyId: CO, role: "EMPLOYEE", teamLeaderId: "tl-2", salary: 5000, firstName: "C", lastName: "D" },
        "other-company": { id: "other-company", companyId: "co-2", role: "EMPLOYEE", teamLeaderId: null, salary: 9000, firstName: "E", lastName: "F" },
        "tl-1": { id: "tl-1", companyId: CO, role: "TEAM_LEADER", teamLeaderId: null, salary: 7000, firstName: "G", lastName: "H" },
        "a-1": { id: "a-1", companyId: CO, role: "ADMIN", teamLeaderId: null, salary: 8000, firstName: "I", lastName: "J" },
    }
}

async function lookup(id: string, session: any) {
    db.session = session
    const { GET } = await import("@/app/api/users/route")
    return GET(new Request(`https://nizmo.test/api/users?id=${id}`))
}

const admin = { user: { id: "a-1", role: "ADMIN", companyId: CO } }
const leader = { user: { id: "tl-1", role: "TEAM_LEADER", companyId: CO } }

beforeEach(seed)

describe("the company boundary holds on a direct lookup", () => {
    it("refuses an Admin reaching into another company", async () => {
        // This returned the row, salary and all, until verifyResourceAccess
        // was called here.
        expect((await lookup("other-company", admin)).status).toBe(403)
    })

    it("refuses a Team Leader reaching into another company", async () => {
        expect((await lookup("other-company", leader)).status).toBe(403)
    })

    it("still lets an Admin look up their own company's people", async () => {
        expect((await lookup("other-team", admin)).status).toBe(200)
    })
})

describe("the team boundary holds on a direct lookup too", () => {
    it("refuses a Team Leader an id outside their team", async () => {
        expect((await lookup("other-team", leader)).status).toBe(403)
    })

    it("allows their own report", async () => {
        expect((await lookup("mine", leader)).status).toBe(200)
    })

    it("allows themselves", async () => {
        expect((await lookup("tl-1", leader)).status).toBe(200)
    })
})

describe("people can still see themselves", () => {
    it("an employee looking at their own record is not refused", async () => {
        const employee = { user: { id: "mine", role: "EMPLOYEE", companyId: CO } }
        expect((await lookup("mine", employee)).status).toBe(200)
    })
})
