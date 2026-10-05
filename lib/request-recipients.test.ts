import { describe, it, expect, vi, beforeEach } from "vitest"
import { whoMatches } from "@/lib/permissions/test-actors"

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

/**
 * Everybody who could be told. The recipient query is applied to them, so
 * what is asserted is who hears about it — since roles became data the query
 * asks for the roles holding requests.review, not for role names.
 */
const EVERYONE = [
    { id: "admin-1", role: "ADMIN",       companyId: "co-1", teamLeaderId: null },
    { id: "admin-2", role: "ADMIN",       companyId: "co-2", teamLeaderId: null },
    { id: "tl-1",    role: "TEAM_LEADER", companyId: "co-1", teamLeaderId: null },
    { id: "tl-2",    role: "TEAM_LEADER", companyId: "co-1", teamLeaderId: null },
    { id: "e-1",     role: "EMPLOYEE",    companyId: "co-1", teamLeaderId: "tl-1" },
    { id: "e-2",     role: "EMPLOYEE",    companyId: "co-1", teamLeaderId: null },
]

describe("a request reaches the people who can act on it", () => {
    it("reaches the company's admins", async () => {
        expect(whoMatches(EVERYONE, await raise())).toEqual(["admin-1"])
    })

    it("and the requester's own team leader", async () => {
        db.requester = { teamLeaderId: "tl-1" }
        expect(whoMatches(EVERYONE, await raise())).toEqual(["admin-1", "tl-1"])
    })

    it("but not every team leader in the company", async () => {
        db.requester = { teamLeaderId: "tl-1" }
        expect(whoMatches(EVERYONE, await raise())).not.toContain("tl-2")
    })

    it("matches no leader at all when the requester has none", async () => {
        // An undefined id would drop the constraint and match every Team
        // Leader — the exact behaviour being removed, reintroduced by a falsy
        // value.
        db.requester = { teamLeaderId: null }
        const where = await raise()
        expect(whoMatches(EVERYONE, where)).toEqual(["admin-1"])
        const leaderBranch = where.OR.find((b: any) => "id" in b)
        expect(leaderBranch.id).toBe("")
    })

    it("still notifies whoever the query returned", async () => {
        db.people = [{ id: "admin-1" }, { id: "tl-1" }]
        await raise()
        expect(db.notified).toEqual(["admin-1", "tl-1"])
    })
})
