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
    /** What the rehoming wrote, if it ran. */
    moved: null as { ids: string[]; to: string | null } | null,
    /** Whether the write happened inside a transaction. */
    inTransaction: false,
}

class Written extends Error {
    constructor(public data: any) { super("WRITTEN") }
}

const userModel = (inTx: boolean) => ({
    findUnique: async ({ where }: any) =>
        where.id === db.leader?.id ? db.leader : (where.id === db.target?.id ? db.target : null),
    findMany: async () => db.reports,
    updateMany: async ({ where, data }: any) => {
        db.moved = { ids: where.id.in, to: data.teamLeaderId }
        return { count: where.id.in.length }
    },
    update: async ({ data }: any) => {
        db.inTransaction = inTx
        throw new Written(data)
    },
})

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: userModel(false),
        superAdmin: { findUnique: async () => null },
        dayOffRequest: { aggregate: async () => ({ _sum: { daysDeducted: 0 } }) },
        // Runs the callback with a tx whose writes are marked as being inside
        // one, so a test can tell an atomic hand-off from two loose writes.
        $transaction: async (fn: any) => fn({ user: userModel(true) }),
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
    db.moved = null
    db.inTransaction = false
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

describe("the hand-off: where a stripped leader's team goes", () => {
    beforeEach(() => {
        db.target = person({ id: "tl-1", role: "TEAM_LEADER" })
        db.reports = [
            { id: "e-1", firstName: "Laila", lastName: "Fouad" },
            { id: "e-2", firstName: "Omar", lastName: "Said" },
        ]
    })

    it("still refuses when no answer is given", async () => {
        await expect(update({ role: "EMPLOYEE" })).rejects.toThrow("LEADER_HAS_REPORTS")
    })

    it("unassigns them when the answer is null", async () => {
        const w = await written({ role: "EMPLOYEE", reassignReportsTo: null })
        expect(w.role).toBe("EMPLOYEE")
        expect(db.moved).toEqual({ ids: ["e-1", "e-2"], to: null })
    })

    it("moves them when the answer is another leader", async () => {
        db.leader = { id: "tl-2", role: "TEAM_LEADER", companyId: "co-1", status: "ACTIVE" }
        const w = await written({ role: "EMPLOYEE", reassignReportsTo: "tl-2" })
        expect(w.role).toBe("EMPLOYEE")
        expect(db.moved).toEqual({ ids: ["e-1", "e-2"], to: "tl-2" })
    })

    it("refuses handing the team to the person who is leaving it", async () => {
        // Passes every other check — they are a TEAM_LEADER in the right
        // company — while meaning the reports go nowhere.
        await expect(update({ role: "EMPLOYEE", reassignReportsTo: "tl-1" }))
            .rejects.toThrow("REASSIGN_TARGET_IS_LEAVING")
    })

    it("refuses a destination who is not a team leader", async () => {
        db.leader = { id: "x-1", role: "EMPLOYEE", companyId: "co-1", status: "ACTIVE" }
        await expect(update({ role: "EMPLOYEE", reassignReportsTo: "x-1" })).rejects.toThrow("NOT_A_LEADER")
    })

    it("refuses a destination in another company", async () => {
        db.leader = { id: "x-1", role: "TEAM_LEADER", companyId: "co-2", status: "ACTIVE" }
        await expect(update({ role: "EMPLOYEE", reassignReportsTo: "x-1" })).rejects.toThrow("DIFFERENT_COMPANY")
    })

    it("writes the rehoming and the change together, not one then the other", async () => {
        // The half-done states are both bad in their own way: a rehoming
        // without the demotion leaves a leader who still leads, and a demotion
        // without the rehoming is exactly the state the refusal exists to
        // prevent — reached by the Admin who was trying to avoid it.
        db.leader = { id: "tl-2", role: "TEAM_LEADER", companyId: "co-1", status: "ACTIVE" }
        await written({ role: "EMPLOYEE", reassignReportsTo: "tl-2" })
        expect(db.inTransaction).toBe(true)
    })
})
