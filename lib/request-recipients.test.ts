import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Who hears about a new request.
 *
 * It used to be every Admin and every Team Leader in the company, which was
 * right while a leader could act on anybody's request. After scoping they
 * cannot, so most of those notifications became an invitation to open
 * something the recipient is refused access to — and the ones that mattered
 * were buried among them. A notification nobody can act on is worse than none,
 * because it teaches people to ignore the rest.
 */

const db = {
    requester: null as any,
    /** What the recipient query was asked for. */
    query: null as any,
    people: [] as any[],
    notified: [] as string[],
}

vi.mock("@/lib/prisma", () => ({
    prisma: {
        $transaction: async (fn: any) => fn({
            request: { create: async ({ data }: any) => ({ id: "r-1", ...data }) },
            user: {
                findUnique: async () => db.requester,
                findMany: async ({ where }: any) => { db.query = where; return db.people },
            },
            // The audit write joins the same transaction — it is handed `tx`
            // rather than reaching for the global client, which on a small
            // pool would be a second connection held open inside the first.
            auditLog: { create: async () => ({ id: "a-1" }) },
        }),
    },
}))

vi.mock("@/lib/services/notification.service", () => ({
    NotificationService: {
        notifyMany: async (ids: string[]) => { db.notified = ids },
    },
}))

const employee = { user: { id: "e-1", role: "EMPLOYEE", companyId: "co-1", firstName: "Laila" } }

async function raise() {
    const { RequestService } = await import("@/lib/services/request.service")
    db.notified = []
    db.query = null
    await RequestService.create({ title: "Need a day", details: "..." } as any, employee)
    return db.query
}

beforeEach(() => {
    db.requester = { teamLeaderId: null }
    db.people = [{ id: "admin-1" }]
})

describe("a request reaches the people who can act on it", () => {
    it("asks for the company's admins", async () => {
        const where = await raise()
        expect(where.companyId).toBe("co-1")
        expect(where.OR).toContainEqual({ role: "ADMIN" })
    })

    it("adds the requester's own team leader", async () => {
        db.requester = { teamLeaderId: "tl-1" }
        const where = await raise()
        expect(where.OR).toContainEqual({ id: "tl-1", role: "TEAM_LEADER" })
    })

    it("no longer asks for every team leader in the company", async () => {
        db.requester = { teamLeaderId: "tl-1" }
        const where = await raise()
        expect(JSON.stringify(where)).not.toContain('"role":{"in":["ADMIN","TEAM_LEADER"]}')
    })

    it("matches no leader at all when the requester has none", async () => {
        // The empty string is deliberate. Leaving the id undefined would drop
        // the constraint and match every TEAM_LEADER — the exact behaviour
        // being removed, reintroduced by a falsy value.
        db.requester = { teamLeaderId: null }
        const where = await raise()
        const leaderBranch = where.OR.find((b: any) => b.role === "TEAM_LEADER")
        expect(leaderBranch.id).toBe("")
        expect(leaderBranch.id).not.toBeUndefined()
    })

    it("still notifies whoever the query returned", async () => {
        db.people = [{ id: "admin-1" }, { id: "tl-1" }]
        await raise()
        expect(db.notified).toEqual(["admin-1", "tl-1"])
    })
})
