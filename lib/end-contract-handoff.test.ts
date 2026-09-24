import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Ending a Team Leader's contract asks where their team goes.
 *
 * It used not to: the edit form refused to demote or archive a leader with a
 * team, but End contract went through SettlementService, which never asked,
 * and the team was left pointing at an archived account that no leader could
 * see past. The question now lives in settleAndEnd itself, so there is no way
 * of ending a contract that skips it.
 *
 * The settlement arithmetic is proven elsewhere; here the preview is stubbed
 * and the database is a small in-memory stand-in that records what was
 * written and whether it happened inside the transaction.
 */

const PAST = new Date("2026-01-01T00:00:00Z")

const db = {
    reports: [] as { id: string; firstName: string; lastName: string }[],
    leaders: {} as Record<string, any>,
    moved: null as { ids: string[]; to: string | null; inTx: boolean } | null,
    audited: null as any,
    settled: false,
    archived: [] as { id: string; inTx: boolean }[],
    notified: [] as any[],
    transactions: 0,
    candidates: [] as any[],
}

const userModel = (inTx: boolean) => ({
    findMany: async ({ where }: any) => {
        if (where?.teamLeaderId) return db.reports
        if (where?.EmploymentEvent) return db.candidates
        if (where?.id?.in) return where.id.in.map((id: string) => ({ id, firstName: id, lastName: "" }))
        return []
    },
    findUnique: async ({ where }: any) => db.leaders[where.id] ?? null,
    updateMany: async ({ where, data }: any) => {
        db.moved = { ids: where.id.in, to: data.teamLeaderId, inTx }
        return { count: where.id.in.length }
    },
    update: async ({ where, data }: any) => {
        if (data.status === "ARCHIVED") db.archived.push({ id: where.id, inTx })
        return { id: where.id, ...data }
    },
})

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: userModel(false),
        notification: { createMany: async ({ data }: any) => { db.notified.push(...data); return { count: data.length } } },
        $transaction: async (fn: any) => {
            db.transactions++
            return fn({
                user: userModel(true),
                auditLog: { create: async ({ data }: any) => { db.audited = data; return { id: "a-1" } } },
                employmentEvent: { create: async ({ data }: any) => ({ id: "ev-1", ...data }) },
                finalSettlement: { create: async ({ data }: any) => { db.settled = true; return { id: "st-1", ...data } } },
                debt: { findUnique: async () => null, update: async () => ({}), create: async () => ({ id: "d-1" }) },
            })
        },
    },
}))

const preview = {
    endsAt: PAST, earnedMinor: 0, paidMinor: 0, netMinor: 0, debtRecoveredMinor: 0,
    dueDate: PAST, debtAllocations: [],
}

async function end(reassignReportsTo?: string | null, extra: any = {}) {
    const { SettlementService } = await import("@/lib/services/settlement.service")
    vi.spyOn(SettlementService, "preview").mockResolvedValue(preview as any)
    vi.spyOn(SettlementService as any, "policyFor").mockResolvedValue({ companyId: "co-1", payrollDay: 25, timeZone: "Africa/Cairo" })
    return SettlementService.settleAndEnd({
        userId: "tl-1",
        lastWorkingDay: "2025-12-31",
        createdById: "admin-1",
        actorRole: "ADMIN",
        ...(reassignReportsTo !== undefined && { reassignReportsTo }),
        ...extra,
    })
}

beforeEach(() => {
    db.reports = []
    db.leaders = { "tl-2": { id: "tl-2", role: "TEAM_LEADER", companyId: "co-1", status: "ACTIVE" } }
    db.moved = null
    db.audited = null
    db.settled = false
    db.archived = []
    db.notified = []
    db.transactions = 0
    db.candidates = []
})

describe("ending a leader's contract", () => {
    beforeEach(() => {
        db.reports = [
            { id: "e-1", firstName: "Laila", lastName: "Fouad" },
            { id: "e-2", firstName: "Omar", lastName: "Said" },
        ]
    })

    it("is refused until somebody says where the team goes, naming them", async () => {
        await expect(end()).rejects.toMatchObject({
            message: "LEADER_HAS_REPORTS",
            reports: [{ firstName: "Laila" }, { firstName: "Omar" }],
        })
    })

    it("writes nothing when refused — no statement for a contract that did not end", async () => {
        await expect(end()).rejects.toThrow("LEADER_HAS_REPORTS")
        expect(db.transactions).toBe(0)
        expect(db.settled).toBe(false)
        expect(db.moved).toBeNull()
    })

    it("moves the team to the chosen leader, in the same transaction as the settlement", async () => {
        await end("tl-2")
        expect(db.moved).toEqual({ ids: ["e-1", "e-2"], to: "tl-2", inTx: true })
        expect(db.settled).toBe(true)
        expect(db.transactions).toBe(1)
    })

    it("leaves them unassigned when that is the answer", async () => {
        await end(null)
        expect(db.moved).toEqual({ ids: ["e-1", "e-2"], to: null, inTx: true })
    })

    it("records the hand-off against the Admin who made it", async () => {
        await end("tl-2")
        expect(db.audited?.action).toBe("REASSIGN_TEAM")
        expect(db.audited?.userId).toBe("admin-1")
        expect(db.audited?.details).toMatchObject({ from: "tl-1", to: "tl-2", affected: ["e-1", "e-2"] })
    })

    it("tells the people who moved, after it has committed", async () => {
        await end("tl-2")
        expect(db.notified.map(n => n.userId)).toEqual(expect.arrayContaining(["e-1", "e-2", "tl-2"]))
    })

    it("will not hand the team to the person leaving it", async () => {
        db.leaders["tl-1"] = { id: "tl-1", role: "TEAM_LEADER", companyId: "co-1", status: "ACTIVE" }
        await expect(end("tl-1")).rejects.toThrow("REASSIGN_TARGET_IS_LEAVING")
        expect(db.settled).toBe(false)
    })

    it("will not hand it to somebody who cannot lead them", async () => {
        db.leaders["x-1"] = { id: "x-1", role: "TEAM_LEADER", companyId: "co-2", status: "ACTIVE" }
        await expect(end("x-1")).rejects.toThrow("DIFFERENT_COMPANY")
        db.leaders["x-2"] = { id: "x-2", role: "EMPLOYEE", companyId: "co-1", status: "ACTIVE" }
        await expect(end("x-2")).rejects.toThrow("NOT_A_LEADER")
        await expect(end("nobody")).rejects.toThrow("TEAM_LEADER_NOT_FOUND")
        expect(db.settled).toBe(false)
    })
})

describe("ending the contract of somebody with no team", () => {
    it("goes ahead without asking, and writes no hand-off", async () => {
        await end()
        expect(db.settled).toBe(true)
        expect(db.moved).toBeNull()
        expect(db.audited).toBeNull()
    })
})

describe("the nightly job archiving a leader whose contract has ended", () => {
    // The team moves when the ending is recorded. A future-dated ending leaves
    // the leader working until then, and somebody can be given to them in the
    // meantime; when the job archives them, nobody is there to ask.
    function leaderDueToday() {
        db.candidates = [{
            id: "tl-1", status: "ACTIVE", role: "TEAM_LEADER",
            EmploymentEvent: [
                { type: "HIRED", effectiveFrom: new Date("2020-01-01T00:00:00Z"), createdAt: PAST, deductSuspension: null, reason: null },
                { type: "CONTRACT_ENDED", effectiveFrom: PAST, createdAt: PAST, deductSuspension: null, reason: null },
            ],
        }]
    }

    it("unassigns whoever is left, together with the archive", async () => {
        leaderDueToday()
        db.reports = [{ id: "e-9", firstName: "Nour", lastName: "Adel" }]
        const { EmploymentService } = await import("@/lib/services/employment.service")
        await EmploymentService.applyDueEvents(new Date("2026-02-01T00:00:00Z"))
        expect(db.archived).toEqual([{ id: "tl-1", inTx: true }])
        expect(db.moved).toEqual({ ids: ["e-9"], to: null, inTx: true })
        // Nobody made this change; the log must not name somebody who did not.
        expect(db.audited).toMatchObject({ action: "REASSIGN_TEAM", userId: null, superAdminId: null })
    })

    it("archives a leader with nobody left exactly as before", async () => {
        leaderDueToday()
        const { EmploymentService } = await import("@/lib/services/employment.service")
        await EmploymentService.applyDueEvents(new Date("2026-02-01T00:00:00Z"))
        expect(db.archived).toEqual([{ id: "tl-1", inTx: true }])
        expect(db.moved).toBeNull()
        expect(db.audited).toBeNull()
    })
})

describe("the employment route carries the question and the answer", () => {
    it("passes the answer to settleAndEnd, keeping 'not answered' distinct from null", async () => {
        const { readFileSync } = await import("node:fs")
        const { stripComments } = await import("./strip-comments")
        const route = stripComments(readFileSync("app/api/users/[id]/employment/route.ts", "utf8"))
        // Absent must stay absent: defaulting it to null would unassign a
        // whole team without anybody having been asked.
        expect(route).toContain("typeof json === 'object' && 'reassignReportsTo' in json ? json.reassignReportsTo : undefined")
        expect(route).toMatch(/settleAndEnd\(\{[\s\S]*?reassignReportsTo,[\s\S]*?\}\)/)
        // And the refusal goes back with the names, like the edit form's.
        expect(route).toContain("teamRefusalResponse(error)")
    })

    it("answers the hand-off question with the names it is about", async () => {
        const { teamRefusalResponse } = await import("./team-handoff-response")
        const err: any = new Error("LEADER_HAS_REPORTS")
        err.reports = [{ id: "e-1", firstName: "Laila", lastName: "Fouad" }]
        const res = teamRefusalResponse(err)!
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.details.reports).toEqual(err.reports)
        expect(teamRefusalResponse(new Error("SOMETHING_ELSE"))).toBeNull()
    })
})
