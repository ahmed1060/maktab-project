import { describe, it, expect } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"
import { internalRow, internalWhere, pageOf, type FeedRow } from "./feed"

/**
 * The one Requests page's feed (UI_PLAN.md §2.3): every kind read through
 * its own rules of who sees and decides it, on Mine and To review, and
 * merged into one list, newest first.
 */

const admin = withGrants({ id: "a1", role: "ADMIN", companyId: "c1" })
const leader = withGrants({ id: "l1", role: "TEAM_LEADER", companyId: "c1" })
const employee = withGrants({ id: "e1", role: "EMPLOYEE", companyId: "c1" })
const superAdmin = { id: "s1", role: "SUPER_ADMIN", companyId: null }
const waiting = { tab: "mine" as const, show: "waiting" as const, search: "", personId: "", companyId: null }

describe("internal requests on Mine", () => {
    it("are one's own, waiting or done", () => {
        expect(internalWhere(employee, waiting)).toEqual({ userId: "e1", status: { in: ["PENDING", "IN_PROGRESS"] } })
        expect(internalWhere(admin, { ...waiting, show: "done" })).toEqual({ userId: "a1", status: "COMPLETED" })
    })

    it("aren't the Super Admin's, who asks for nothing in a company", () => {
        expect(internalWhere(superAdmin, waiting)).toBeNull()
    })
})

describe("internal requests on To review", () => {
    const review = { ...waiting, tab: "review" as const }

    it("are everyone else's in the company, for an Admin", () => {
        expect(internalWhere(admin, review)).toEqual({ companyId: "c1", userId: { not: "a1" }, status: { in: ["PENDING", "IN_PROGRESS"] } })
    })

    it("are their team's, for a Team Leader, and not their own", () => {
        expect(internalWhere(leader, review)).toEqual({
            companyId: "c1", userId: { not: "l1" }, status: { in: ["PENDING", "IN_PROGRESS"] },
            AND: [{ user: { OR: [{ teamLeaderId: "l1" }, { id: "l1" }] } }],
        })
    })

    it("aren't there for an employee, who sees only their own", () => {
        expect(internalWhere(employee, review)).toBeNull()
    })

    it("are the picked company's for the Super Admin, or every company's", () => {
        expect(internalWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", status: { in: ["PENDING", "IN_PROGRESS"] } })
        expect(internalWhere(superAdmin, review)).toEqual({ status: { in: ["PENDING", "IN_PROGRESS"] } })
    })

    it("narrow to one person and a title, within that reach", () => {
        expect(internalWhere(leader, { ...review, personId: "x9", search: "chair" })).toMatchObject({
            title: { contains: "chair", mode: "insensitive" },
            AND: [{ user: { OR: [{ teamLeaderId: "l1" }, { id: "l1" }] } }, { userId: "x9" }],
        })
    })
})

describe("an internal request's row", () => {
    const asked = new Date("2026-10-29T09:00:00Z")
    const request = (fields: object = {}) => ({
        id: "r1", title: "A new chair", details: "Mine is broken.", status: "PENDING", companyId: "c1", userId: "e2",
        createdAt: asked, updatedAt: asked, inProgressAt: null, completedAt: null,
        user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "l1" }, ...fields,
    })

    it("says who asked, what for and when", () => {
        expect(internalRow(admin, request())).toMatchObject({
            kind: "internal", id: "r1", who: { id: "e2", name: "Mona Adel" }, what: "A new chair", detail: "Mine is broken.",
            asked: asked.toISOString(), status: "PENDING", sortAt: asked.toISOString(),
        })
    })

    it("may be decided by whoever reviews it, within their team for a Team Leader, until it's done", () => {
        expect(internalRow(admin, request()).mayDecide).toBe(true)
        expect(internalRow(leader, request()).mayDecide).toBe(true)
        expect(internalRow(leader, request({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "l2" } })).mayDecide).toBe(false)
        expect(internalRow(employee, request()).mayDecide).toBe(false)
        expect(internalRow(admin, request({ status: "COMPLETED" })).mayDecide).toBe(false)
    })

    it("may be taken off by whoever asked or reviews it, and once done only by the Super Admin", () => {
        expect(internalRow(employee, request({ userId: "e1" })).mayDelete).toBe(true)
        expect(internalRow(employee, request()).mayDelete).toBe(false)
        expect(internalRow(admin, request()).mayDelete).toBe(true)
        expect(internalRow(admin, request({ status: "COMPLETED" })).mayDelete).toBe(false)
        expect(internalRow(superAdmin, request({ status: "COMPLETED" })).mayDelete).toBe(true)
    })

    it("once done, is ordered by when it was done", () => {
        const done = new Date("2026-10-30T12:00:00Z")
        expect(internalRow(admin, request({ status: "COMPLETED", completedAt: done })).sortAt).toBe(done.toISOString())
    })
})

describe("the page of rows", () => {
    const row = (id: string, sortAt: string): FeedRow => ({
        kind: "internal", id, who: { id: "u", name: "U" }, what: id, detail: null, asked: sortAt, started: null, finished: null,
        status: "PENDING", sortAt, mayDecide: false, mayDelete: false,
    })

    it("merges every kind's newest first, and counts them all", () => {
        const a = { rows: [row("a2", "2026-10-30T10:00:00.000Z"), row("a1", "2026-10-28T10:00:00.000Z")], total: 2 }
        const b = { rows: [row("b1", "2026-10-29T10:00:00.000Z")], total: 7 }
        const first = pageOf([a, b], 1, 2)
        expect(first.rows.map(r => r.id)).toEqual(["a2", "b1"])
        expect(first.total).toBe(9)
        expect(first.totalPages).toBe(5)
        expect(pageOf([a, b], 2, 2).rows.map(r => r.id)).toEqual(["a1"])
    })

    it("has a page even with nothing on it", () => {
        expect(pageOf([], 1, 10)).toEqual({ rows: [], total: 0, totalPages: 1 })
    })
})
