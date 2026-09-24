import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * That UserService.update reports team changes — and only real ones. Saving a
 * name must not tell anybody their leader changed.
 */

const db = {
    target: null as any,
    leader: null as any,
    reports: [] as any[],
    sent: null as any[] | null,
}

vi.mock("@/lib/services/team-notify.service", () => ({
    notifyTeamMoves: async (moves: any[]) => { db.sent = moves },
}))
vi.mock("@/lib/services/audit-log.service", () => ({
    AuditLogService: { log: async () => ({}) },
}))

const userModel = {
    findUnique: async ({ where }: any) =>
        where.id === db.leader?.id ? db.leader : (where.id === db.target?.id ? db.target : null),
    findMany: async () => db.reports,
    updateMany: async () => ({ count: db.reports.length }),
    update: async ({ data }: any) => ({ ...db.target, ...data, salary: 0 }),
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: userModel,
        superAdmin: { findUnique: async () => null },
        $transaction: async (fn: any) => fn({ user: userModel, auditLog: { create: async () => ({}) } }),
    },
}))

const admin = { user: { id: "a-1", role: "ADMIN", companyId: "co-1" } }
const person = (over: any = {}) => ({
    id: "e-1", role: "EMPLOYEE", companyId: "co-1", status: "ACTIVE",
    firstName: "Laila", lastName: "Fouad", email: "l@f.test", salary: 0, teamLeaderId: null, ...over,
})

async function update(input: any) {
    const { UserService } = await import("@/lib/services/user.service")
    return UserService.update({ id: db.target.id, ...input }, admin)
}

beforeEach(() => {
    db.target = person()
    db.leader = { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1", status: "ACTIVE" }
    db.reports = []
    db.sent = null
})

describe("a real change is reported", () => {
    it("assigning a leader", async () => {
        await update({ teamLeaderId: "tl-1" })
        expect(db.sent).toEqual([{ userId: "e-1", from: null, to: "tl-1" }])
    })

    it("unassigning one", async () => {
        db.target = person({ teamLeaderId: "tl-1" })
        await update({ teamLeaderId: null })
        expect(db.sent).toEqual([{ userId: "e-1", from: "tl-1", to: null }])
    })

    it("a hand-off, reporting everybody who moved", async () => {
        db.target = person({ id: "tl-9", role: "TEAM_LEADER" })
        db.reports = [{ id: "e-1", firstName: "L", lastName: "F" }, { id: "e-2", firstName: "O", lastName: "S" }]
        await update({ role: "EMPLOYEE", reassignReportsTo: "tl-1" })
        expect(db.sent).toEqual([
            { userId: "e-1", from: "tl-9", to: "tl-1" },
            { userId: "e-2", from: "tl-9", to: "tl-1" },
        ])
    })
})

describe("nothing is reported when nothing about the team changed", () => {
    it("saving an unrelated field", async () => {
        await update({ firstName: "Renamed" })
        expect(db.sent).toBeNull()
    })

    it("re-saving the leader they already have", async () => {
        db.target = person({ teamLeaderId: "tl-1" })
        await update({ teamLeaderId: "tl-1" })
        expect(db.sent).toBeNull()
    })
})
