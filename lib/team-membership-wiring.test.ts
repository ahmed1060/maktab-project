import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * That the rules are wired in, and wired in at the right moment.
 *
 * lib/team-assignment.test.ts proves the rules themselves. This proves
 * UserService actually consults them — and, more usefully, that it consults
 * them about the person who will exist after the update rather than the one
 * who exists now. A single request can change a role and an assignment
 * together, and checking the current row would approve a combination that is
 * already invalid by the time it is written.
 *
 * The refusal fires before the write, so a small prisma stub is enough; the
 * one test that needs to see what would have been written makes the write
 * itself throw, carrying the data out. That is deliberately cheaper than
 * mocking the whole tail of update(), which fans out into employment history,
 * salary history and audit logging that none of this touches.
 */

const db = {
    target: null as any,
    leader: null as any,
    reports: [] as any[],
}

class Written extends Error {
    constructor(public data: any) { super("WRITTEN") }
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: async ({ where }: any) =>
                where.id === db.leader?.id ? db.leader : (where.id === db.target?.id ? db.target : null),
            findMany: async () => db.reports,
            update: async ({ data }: any) => { throw new Written(data) },
        },
        superAdmin: { findUnique: async () => null },
        dayOffRequest: { aggregate: async () => ({ _sum: { daysDeducted: 0 } }) },
    },
}))

const admin = { user: { id: "admin-1", role: "ADMIN", companyId: "co-1" } }

function person(over: any = {}) {
    return {
        id: "u-1", role: "EMPLOYEE", companyId: "co-1", status: "ACTIVE",
        firstName: "A", lastName: "B", email: "a@b.test", salary: 0,
        teamLeaderId: null, ...over,
    }
}

async function update(input: any, session: any = admin) {
    const { UserService } = await import("@/lib/services/user.service")
    return UserService.update({ id: db.target.id, ...input }, session)
}

/** Runs an update expected to reach the write, and returns what it would write. */
async function written(input: any, session: any = admin) {
    try {
        await update(input, session)
    } catch (e: any) {
        if (e instanceof Written) return e.data
        throw e
    }
    throw new Error("the update never reached the write")
}

beforeEach(() => {
    db.target = null
    db.leader = null
    db.reports = []
})

describe("a leader is not stripped out from under their team", () => {
    beforeEach(() => {
        db.target = person({ id: "tl-1", role: "TEAM_LEADER" })
    })

    it("refuses the demotion and names the people it is about", async () => {
        db.reports = [{ id: "e-1", firstName: "Laila", lastName: "Fouad" }]
        await expect(update({ role: "EMPLOYEE" })).rejects.toMatchObject({
            message: "LEADER_HAS_REPORTS",
            // Named, because "reassign them first" without saying who sends an
            // Admin hunting through a list — and the modal is built from this.
            reports: [{ firstName: "Laila", lastName: "Fouad" }],
        })
    })

    it("refuses archiving them too, which does not look like demotion", async () => {
        db.reports = [{ id: "e-1", firstName: "Laila", lastName: "Fouad" }]
        await expect(update({ status: "ARCHIVED" })).rejects.toThrow("LEADER_HAS_REPORTS")
    })

    it("allows the demotion once nobody reports to them", async () => {
        db.reports = []
        const data = await written({ role: "EMPLOYEE" })
        expect(data.role).toBe("EMPLOYEE")
    })
})

describe("the checks are about the resulting person, not the current one", () => {
    it("refuses promoting somebody to leader while handing them a leader", async () => {
        // The combination that reads as fine one field at a time. Against the
        // current row they are an EMPLOYEE, so an assignment looks legal;
        // against the row that would exist they are a TEAM_LEADER, and leaders
        // are not led.
        db.target = person({ id: "u-1", role: "EMPLOYEE" })
        db.leader = { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1", status: "ACTIVE" }
        await expect(update({ role: "TEAM_LEADER", teamLeaderId: "tl-1" }))
            .rejects.toThrow("ONLY_EMPLOYEES_HAVE_LEADERS")
    })

    it("clears the leader somebody had when they are promoted", async () => {
        db.target = person({ id: "u-1", role: "EMPLOYEE", teamLeaderId: "tl-1" })
        const data = await written({ role: "TEAM_LEADER" })
        expect(data.teamLeaderId).toBeNull()
    })

    it("clears it when a Super Admin moves them to another company", async () => {
        db.target = person({ id: "u-1", teamLeaderId: "tl-1" })
        const data = await written({ companyId: "co-2" }, { user: { id: "sa", role: "SUPER_ADMIN", companyId: null } })
        expect(data.teamLeaderId).toBeNull()
    })
})

describe("assignment goes through the rules, not the id it was handed", () => {
    beforeEach(() => { db.target = person({ id: "u-1" }) })

    it("refuses a leader who is not a team leader", async () => {
        db.leader = { id: "x-1", role: "EMPLOYEE", companyId: "co-1", status: "ACTIVE" }
        await expect(update({ teamLeaderId: "x-1" })).rejects.toThrow("NOT_A_LEADER")
    })

    it("refuses a leader from another company", async () => {
        db.leader = { id: "x-1", role: "TEAM_LEADER", companyId: "co-2", status: "ACTIVE" }
        await expect(update({ teamLeaderId: "x-1" })).rejects.toThrow("DIFFERENT_COMPANY")
    })

    it("refuses an id with no row behind it", async () => {
        db.leader = null
        await expect(update({ teamLeaderId: "ghost" })).rejects.toThrow("TEAM_LEADER_NOT_FOUND")
    })

    it("accepts a real leader from the same company", async () => {
        db.leader = { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1", status: "ACTIVE" }
        const data = await written({ teamLeaderId: "tl-1" })
        expect(data.teamLeaderId).toBe("tl-1")
    })

    it("lets an Admin unassign with an explicit null", async () => {
        // Absent means leave it alone; null means unassign. An Admin resolving
        // a hand-off needs the second one, so the two cannot be conflated.
        db.target = person({ id: "u-1", teamLeaderId: "tl-1" })
        const data = await written({ teamLeaderId: null })
        expect(data.teamLeaderId).toBeNull()
    })

    it("leaves it untouched when the field is absent", async () => {
        db.target = person({ id: "u-1", teamLeaderId: "tl-1" })
        const data = await written({ firstName: "Renamed" })
        expect(data.teamLeaderId).toBeUndefined()
    })
})
