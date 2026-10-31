import { describe, it, expect } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"
import { dayOffRow, dayOffWhere, feedOrder, internalRow, internalWhere, missingPunchRow, missingPunchWhere, overtimeDecisionRow, overtimeDayRow, overtimeWhere, pageOf, permissionRow, permissionWhere, type FeedRow } from "./feed"

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

    it("once done, is ordered by when it was last changed, which is when it was done", () => {
        const done = new Date("2026-10-30T12:00:00Z")
        expect(internalRow(admin, request({ status: "COMPLETED", completedAt: done, updatedAt: done })).sortAt).toBe(done.toISOString())
        // One done before completedAt was kept has none: it's still ordered, by the same column the database orders by.
        expect(internalRow(admin, request({ status: "COMPLETED", completedAt: null, updatedAt: done })).sortAt).toBe(done.toISOString())
    })

    it("is read in the order the page merges in, ties by id, so a page boundary neither repeats nor drops one (found by Codex on PR 125)", () => {
        expect(feedOrder("waiting")).toEqual([{ createdAt: "desc" }, { id: "asc" }])
        expect(feedOrder("done")).toEqual([{ updatedAt: "desc" }, { id: "asc" }])
    })
})

// --- Day off (UI_PLAN.md §2.3, part 2c) ----------------------------------------

/** A company that hasn't the Day off module: Company Management only. */
const withoutDayOff = <T extends object>(who: T) => ({ ...who, featureAccess: { unrestricted: false, bundles: ["COMPANY_MANAGEMENT"] } })
/** A role of a company's own that sees and decides its team's leave. */
const hrTeam = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "32.2,33.2" }

describe("day off on Mine", () => {
    it("is one's own, waiting or decided", () => {
        expect(dayOffWhere(employee, waiting)).toEqual({ userId: "e1", status: "PENDING" })
        expect(dayOffWhere(employee, { ...waiting, show: "done" })).toEqual({ userId: "e1", status: { in: ["APPROVED", "REJECTED"] } })
    })

    it("is an Admin's own too, asked before their role may ask no more", () => {
        expect(dayOffWhere(admin, waiting)).toEqual({ userId: "a1", status: "PENDING" })
    })

    it("isn't the Super Admin's, nor anyone's in a company without Day off", () => {
        expect(dayOffWhere(superAdmin, waiting)).toBeNull()
        expect(dayOffWhere(withoutDayOff(employee), waiting)).toBeNull()
    })
})

describe("day off on To review", () => {
    const review = { ...waiting, tab: "review" as const }

    it("is everyone else's in the company, for whoever sees the company's leave", () => {
        expect(dayOffWhere(admin, review)).toEqual({ user: { companyId: "c1" }, userId: { not: "a1" }, status: "PENDING" })
    })

    it("is their team's, for a role that sees its team's, and not their own", () => {
        expect(dayOffWhere(hrTeam, review)).toEqual({
            user: { companyId: "c1", OR: [{ teamLeaderId: "h1" }, { id: "h1" }] }, userId: { not: "h1" }, status: "PENDING",
        })
    })

    it("isn't there for whoever doesn't see others' leave: an employee, or the built-in Team Leader", () => {
        expect(dayOffWhere(employee, review)).toBeNull()
        expect(dayOffWhere(leader, review)).toBeNull()
        expect(dayOffWhere(withoutDayOff(admin), review)).toBeNull()
    })

    it("is the picked company's for the Super Admin, or every company's", () => {
        expect(dayOffWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ user: { companyId: "c2" }, status: "PENDING" })
        expect(dayOffWhere(superAdmin, { ...review, show: "done" })).toEqual({ status: { in: ["APPROVED", "REJECTED"] } })
    })

    it("narrows to the days of leave, by the day each starts, as the Day off list did (decided on 2026-10-31)", () => {
        expect(dayOffWhere(admin, { ...review, from: "2026-11-01", to: "2026-11-07" })).toMatchObject({
            AND: [{ date: { gte: new Date("2026-11-01T00:00:00.000Z"), lt: new Date("2026-11-08T00:00:00.000Z") } }],
        })
        expect(dayOffWhere(employee, { ...waiting, from: "2026-11-01" })).toMatchObject({ AND: [{ date: { gte: new Date("2026-11-01T00:00:00.000Z") } }] })
        // A day that isn't one is left out, not sent on.
        expect(dayOffWhere(admin, { ...review, from: "2026-02-31" })).not.toHaveProperty("AND")
    })

    it("narrows to one person and words in the reason, within that reach", () => {
        expect(dayOffWhere(admin, { ...review, personId: "x9", search: "wedding" })).toMatchObject({
            user: { companyId: "c1" }, reason: { contains: "wedding", mode: "insensitive" }, AND: [{ userId: "x9" }],
        })
    })
})

describe("a day off's row", () => {
    const asked = new Date("2026-10-29T09:00:00Z")
    const request = (fields: object = {}) => ({
        id: "d1", userId: "e2", type: "REGULAR", status: "PENDING", reason: "A wedding", date: new Date("2026-11-03T00:00:00Z"),
        endDate: new Date("2026-11-05T00:00:00Z"), createdAt: asked, updatedAt: asked, daysDeducted: 0, deductionType: "CREDIT",
        rejectionReason: null, user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1", companyId: "c1", dayOffCredit: 12 }, ...fields,
    })

    it("says who asked, for what kind of leave, which days and why", () => {
        expect(dayOffRow(admin, request())).toMatchObject({
            kind: "dayOff", id: "d1", who: { id: "e2", name: "Mona Adel" }, what: "REGULAR", detail: "A wedding",
            asked: asked.toISOString(), status: "PENDING", sortAt: asked.toISOString(), mayDelete: false,
            dayOff: { from: "2026-11-03T00:00:00.000Z", to: "2026-11-05T00:00:00.000Z" },
        })
    })

    it("may be decided by whoever approves leave, within their team for a team's, until it's decided, and never their own", () => {
        expect(dayOffRow(admin, request()).mayDecide).toBe(true)
        expect(dayOffRow(hrTeam, request()).mayDecide).toBe(true)
        expect(dayOffRow(hrTeam, request({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2", companyId: "c1", dayOffCredit: 3 } })).mayDecide).toBe(false)
        expect(dayOffRow(employee, request()).mayDecide).toBe(false)
        expect(dayOffRow(admin, request({ status: "APPROVED" })).mayDecide).toBe(false)
        expect(dayOffRow(admin, request({ userId: "a1" })).mayDecide).toBe(false)
    })

    it("carries the asker's balance only to whoever may decide it", () => {
        expect(dayOffRow(admin, request()).dayOff?.credit).toBe(12)
        expect(dayOffRow(employee, request({ userId: "e1" })).dayOff?.credit).toBeNull()
    })

    it("once decided, says what came of it, and is ordered by when it was", () => {
        const decided = new Date("2026-10-30T12:00:00Z")
        const approved = dayOffRow(admin, request({ status: "APPROVED", daysDeducted: 2.5, deductionType: "SALARY", updatedAt: decided }))
        expect(approved).toMatchObject({ finished: decided.toISOString(), sortAt: decided.toISOString(), dayOff: { deducted: 2.5, deductedFrom: "SALARY" } })
        expect(dayOffRow(admin, request({ status: "REJECTED", rejectionReason: "Busy week", updatedAt: decided })).dayOff?.rejectionReason).toBe("Busy week")
    })
})

// --- Permission hours (UI_PLAN.md §2.3, part 3a) --------------------------------

/** A company that hasn't the Attendance module. */
const withoutAttendance = <T extends object>(who: T) => ({ ...who, featureAccess: { unrestricted: false, bundles: ["COMPANY_MANAGEMENT"] } })
/** A role of a company's own that decides its team's permission hours. */
const shiftLead = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,52.2" }

describe("permission hours on Mine", () => {
    it("are one's own in their company, waiting or ended: approved, rejected or withdrawn", () => {
        expect(permissionWhere(employee, waiting)).toEqual({ companyId: "c1", userId: "e1", status: "PENDING" })
        expect(permissionWhere(admin, { ...waiting, show: "done" })).toEqual({ companyId: "c1", userId: "a1", status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } })
    })

    it("aren't the Super Admin's, nor anyone's in a company without Attendance", () => {
        expect(permissionWhere(superAdmin, waiting)).toBeNull()
        expect(permissionWhere(withoutAttendance(employee), waiting)).toBeNull()
    })
})

describe("permission hours on To review", () => {
    const review = { ...waiting, tab: "review" as const }

    it("are everyone else's in the company, for whoever decides the company's", () => {
        expect(permissionWhere(admin, review)).toEqual({ companyId: "c1", userId: { not: "a1" }, status: "PENDING" })
    })

    it("are their team's, for a role that decides its team's, and not their own", () => {
        expect(permissionWhere(shiftLead, review)).toEqual({
            companyId: "c1", userId: { not: "h1" }, status: "PENDING", AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }],
        })
    })

    it("aren't there for whoever doesn't decide them: an employee, the built-in Team Leader, or a company without Attendance", () => {
        expect(permissionWhere(employee, review)).toBeNull()
        expect(permissionWhere(leader, review)).toBeNull()
        expect(permissionWhere(withoutAttendance(admin), review)).toBeNull()
    })

    it("are the picked company's for the Super Admin, or every company's", () => {
        expect(permissionWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", status: "PENDING" })
        expect(permissionWhere(superAdmin, { ...review, show: "done" })).toEqual({ status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } })
    })

    it("narrow to one person and words in the reason, within that reach", () => {
        expect(permissionWhere(shiftLead, { ...review, personId: "x9", search: "doctor" })).toMatchObject({
            reason: { contains: "doctor", mode: "insensitive" },
            AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }, { userId: "x9" }],
        })
    })
})

describe("permission hours' row", () => {
    const asked = new Date("2026-10-29T09:00:00Z")
    // In Cairo, +02:00 on 3 November: 16:00 there is 14:00 UTC.
    const request = (fields: object = {}) => ({
        id: "p1", companyId: "c1", userId: "e2", date: new Date("2026-11-03T00:00:00Z"), type: "EARLY_LEAVE", startMinutes: 960, endMinutes: 1020,
        minutes: 60, reason: "Doctor", status: "PENDING", createdAt: asked, updatedAt: asked, rejectionReason: null,
        user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1" }, company: { timezone: "Africa/Cairo" }, ...fields,
    })
    const before = new Date("2026-11-03T13:59:00Z")
    const begun = new Date("2026-11-03T14:00:00Z")

    it("says who asked, for what kind of permission, which day and hours, and why", () => {
        expect(permissionRow(admin, request(), before)).toMatchObject({
            kind: "permission", id: "p1", who: { id: "e2", name: "Mona Adel" }, what: "EARLY_LEAVE", detail: "Doctor",
            asked: asked.toISOString(), finished: null, status: "PENDING", sortAt: asked.toISOString(), mayDelete: false,
            permission: { date: "2026-11-03", start: "16:00", end: "17:00", minutes: 60, rejectionReason: null },
        })
    })

    it("reads a night's hours after midnight as that morning's", () => {
        expect(permissionRow(admin, request({ startMinutes: 1740, endMinutes: 1800 }), before).permission).toMatchObject({ start: "05:00", end: "06:00" })
    })

    it("may be decided by whoever decides permission hours, within their team for a team's, while it waits, and never their own", () => {
        expect(permissionRow(admin, request(), before).mayDecide).toBe(true)
        expect(permissionRow(shiftLead, request(), before).mayDecide).toBe(true)
        expect(permissionRow(superAdmin, request(), before).mayDecide).toBe(true)
        expect(permissionRow(shiftLead, request({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2" } }), before).mayDecide).toBe(false)
        expect(permissionRow(employee, request(), before).mayDecide).toBe(false)
        expect(permissionRow(admin, request({ status: "APPROVED" }), before).mayDecide).toBe(false)
        expect(permissionRow(admin, request({ userId: "a1" }), before).mayDecide).toBe(false)
    })

    it("may be withdrawn by whoever asked, while it waits, or once approved until it begins in the company's time", () => {
        const mine = (fields: object = {}) => request({ userId: "e1", ...fields })
        expect(permissionRow(employee, mine(), begun).mayWithdraw).toBe(true)
        expect(permissionRow(employee, mine({ status: "APPROVED" }), before).mayWithdraw).toBe(true)
        expect(permissionRow(employee, mine({ status: "APPROVED" }), begun).mayWithdraw).toBe(false)
        expect(permissionRow(employee, mine({ status: "REJECTED" }), before).mayWithdraw).toBe(false)
        expect(permissionRow(admin, request(), before).mayWithdraw).toBe(false)
    })

    it("once ended, says what came of it, and is ordered by when it was", () => {
        const ended = new Date("2026-10-30T12:00:00Z")
        expect(permissionRow(admin, request({ status: "REJECTED", rejectionReason: "Busy day", updatedAt: ended }), before)).toMatchObject({
            finished: ended.toISOString(), sortAt: ended.toISOString(), permission: { rejectionReason: "Busy day" },
        })
        expect(permissionRow(employee, request({ userId: "e1", status: "CANCELLED", updatedAt: ended }), before)).toMatchObject({ finished: ended.toISOString(), sortAt: ended.toISOString() })
    })
})

// --- Missing punches (UI_PLAN.md §2.3, part 3b) ---------------------------------

/** A role of a company's own that corrects its team's attendance. */
const teamCorrector = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,50.2" }

describe("missing punches on Mine", () => {
    it("are one's own reports in their company, waiting or ended: approved, rejected or withdrawn", () => {
        expect(missingPunchWhere(employee, waiting)).toEqual({ companyId: "c1", userId: "e1", status: "PENDING" })
        expect(missingPunchWhere(admin, { ...waiting, show: "done" })).toEqual({ companyId: "c1", userId: "a1", status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } })
    })

    it("aren't the Super Admin's, nor anyone's in a company without Attendance", () => {
        expect(missingPunchWhere(superAdmin, waiting)).toBeNull()
        expect(missingPunchWhere(withoutAttendance(employee), waiting)).toBeNull()
    })
})

describe("missing punches on To review", () => {
    const review = { ...waiting, tab: "review" as const }

    it("are everyone else's in the company, for whoever corrects the company's attendance", () => {
        expect(missingPunchWhere(admin, review)).toEqual({ companyId: "c1", userId: { not: "a1" }, status: "PENDING" })
    })

    it("are their team's, for a role that corrects its team's, and not their own", () => {
        expect(missingPunchWhere(teamCorrector, review)).toEqual({
            companyId: "c1", userId: { not: "h1" }, status: "PENDING", AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }],
        })
    })

    it("aren't there for whoever doesn't correct attendance: an employee, the built-in Team Leader, or a company without Attendance", () => {
        expect(missingPunchWhere(employee, review)).toBeNull()
        expect(missingPunchWhere(leader, review)).toBeNull()
        expect(missingPunchWhere(withoutAttendance(admin), review)).toBeNull()
    })

    it("are the picked company's for the Super Admin, or every company's, and narrow to one person and the reason", () => {
        expect(missingPunchWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", status: "PENDING" })
        expect(missingPunchWhere(teamCorrector, { ...review, personId: "x9", search: "terminal" })).toMatchObject({
            reason: { contains: "terminal", mode: "insensitive" },
            AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }, { userId: "x9" }],
        })
    })
})

describe("a missing punch's row", () => {
    const asked = new Date("2026-10-29T09:00:00Z")
    // The time claimed is the clock on the wall, kept as it reads.
    const report = (fields: object = {}) => ({
        id: "m1", companyId: "c1", userId: "e2", claimedAt: new Date("2026-10-28T17:05:00Z"), direction: "OUT", reason: "The terminal was down",
        status: "PENDING", createdAt: asked, updatedAt: asked, rejectionReason: null,
        user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1" }, ...fields,
    })

    it("says who reported it, the punch, its day and time, and why", () => {
        expect(missingPunchRow(admin, report())).toMatchObject({
            kind: "missingPunch", id: "m1", who: { id: "e2", name: "Mona Adel" }, what: "OUT", detail: "The terminal was down",
            asked: asked.toISOString(), finished: null, status: "PENDING", sortAt: asked.toISOString(), mayDelete: false,
            missingPunch: { at: "2026-10-28T17:05", direction: "OUT", rejectionReason: null },
        })
        expect(missingPunchRow(admin, report({ direction: null })).missingPunch?.direction).toBeNull()
    })

    it("may be decided by whoever corrects attendance, within their team for a team's, while it waits, and never their own", () => {
        expect(missingPunchRow(admin, report()).mayDecide).toBe(true)
        expect(missingPunchRow(teamCorrector, report()).mayDecide).toBe(true)
        expect(missingPunchRow(superAdmin, report()).mayDecide).toBe(true)
        expect(missingPunchRow(teamCorrector, report({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2" } })).mayDecide).toBe(false)
        expect(missingPunchRow(employee, report()).mayDecide).toBe(false)
        expect(missingPunchRow(admin, report({ status: "APPROVED" })).mayDecide).toBe(false)
        expect(missingPunchRow(admin, report({ userId: "a1" })).mayDecide).toBe(false)
    })

    it("may be withdrawn by whoever reported it, only while it waits", () => {
        expect(missingPunchRow(employee, report({ userId: "e1" })).mayWithdraw).toBe(true)
        expect(missingPunchRow(employee, report({ userId: "e1", status: "APPROVED" })).mayWithdraw).toBe(false)
        expect(missingPunchRow(admin, report()).mayWithdraw).toBe(false)
    })

    it("once ended, says why it was refused, and is ordered by when it ended", () => {
        const ended = new Date("2026-10-30T12:00:00Z")
        expect(missingPunchRow(admin, report({ status: "REJECTED", rejectionReason: "No sign of it", updatedAt: ended }))).toMatchObject({
            finished: ended.toISOString(), sortAt: ended.toISOString(), missingPunch: { rejectionReason: "No sign of it" },
        })
    })
})

// --- Overtime (UI_PLAN.md §2.3, part 4a) ---------------------------------------

/** A role of a company's own that decides its team's overtime. */
const overtimeLead = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,51.2" }

describe("overtime", () => {
    const review = { ...waiting, tab: "review" as const }

    it("is under To review only: nobody asks for it, so it isn't on Mine (decided on 2026-10-31)", () => {
        expect(overtimeWhere(employee, waiting)).toBeNull()
        expect(overtimeWhere(admin, waiting)).toBeNull()
    })

    it("waiting is everyone else's days whose overtime waits for a decision, for whoever decides the company's", () => {
        expect(overtimeWhere(admin, review)).toEqual({ companyId: "c1", userId: { not: "a1" }, overtimeStatus: "PENDING" })
    })

    it("done is the decisions made, approved or rejected", () => {
        expect(overtimeWhere(admin, { ...review, show: "done" })).toEqual({ companyId: "c1", userId: { not: "a1" }, status: { in: ["APPROVED", "REJECTED"] } })
    })

    it("is their team's for a role that decides its team's, the picked company's for the Super Admin, and one person's when picked", () => {
        expect(overtimeWhere(overtimeLead, { ...review, personId: "x9" })).toEqual({
            companyId: "c1", userId: { not: "h1" }, overtimeStatus: "PENDING", AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }, { userId: "x9" }],
        })
        expect(overtimeWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", overtimeStatus: "PENDING" })
    })

    it("isn't there for whoever doesn't decide it, nor in a company without Attendance", () => {
        expect(overtimeWhere(employee, review)).toBeNull()
        expect(overtimeWhere(leader, review)).toBeNull()
        expect(overtimeWhere(withoutAttendance(admin), review)).toBeNull()
    })

    it("is searched by a decision's note; a day waiting has no words to match", () => {
        expect(overtimeWhere(admin, { ...review, show: "done", search: "busy" })).toMatchObject({ note: { contains: "busy", mode: "insensitive" } })
        expect(overtimeWhere(admin, { ...review, search: "busy" })).toMatchObject({ id: { in: [] } })
    })
})

describe("overtime's rows", () => {
    const day = (fields: object = {}) => ({
        id: "d1", companyId: "c1", userId: "e2", date: new Date("2026-10-29T00:00:00Z"), overtimeMinutes: 90,
        firstInAt: new Date("2026-10-29T09:00:00Z"), lastOutAt: new Date("2026-10-29T18:30:00Z"),
        user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1" }, ...fields,
    })
    const decided = new Date("2026-10-30T12:00:00Z")
    const decision = (fields: object = {}) => ({
        id: "o1", companyId: "c1", userId: "e2", date: new Date("2026-10-29T00:00:00Z"), status: "APPROVED", approvedMinutes: 90, note: null,
        decidedAt: decided, user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1" }, ...fields,
    })

    it("a day waiting says whose, which day, how much, and when they came and left, as the clock on the wall read", () => {
        expect(overtimeDayRow(admin, day())).toMatchObject({
            kind: "overtime", id: "d1", who: { id: "e2", name: "Mona Adel" }, status: "PENDING", asked: "2026-10-29T00:00:00.000Z",
            sortAt: "2026-10-29T00:00:00.000Z", finished: null, mayDelete: false, mayWithdraw: false,
            overtime: { companyId: "c1", userId: "e2", date: "2026-10-29", minutes: 90, approvedMinutes: null, firstIn: "09:00", lastOut: "18:30", note: null },
        })
    })

    it("a day waiting may be decided by whoever decides overtime, within their team for a team's, and never their own", () => {
        expect(overtimeDayRow(admin, day()).mayDecide).toBe(true)
        expect(overtimeDayRow(overtimeLead, day()).mayDecide).toBe(true)
        expect(overtimeDayRow(overtimeLead, day({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2" } })).mayDecide).toBe(false)
        expect(overtimeDayRow(admin, day({ userId: "a1" })).mayDecide).toBe(false)
    })

    it("a decision says what came of it, is ordered by when it was made, and may be withdrawn by whoever may decide it again", () => {
        expect(overtimeDecisionRow(admin, decision())).toMatchObject({
            kind: "overtime", id: "o1", status: "APPROVED", finished: decided.toISOString(), sortAt: decided.toISOString(), mayDecide: false, mayWithdraw: true,
            overtime: { date: "2026-10-29", minutes: null, approvedMinutes: 90, note: null },
        })
        expect(overtimeDecisionRow(admin, decision({ status: "REJECTED", approvedMinutes: 0, note: "Not asked for" })).overtime).toMatchObject({ approvedMinutes: null, note: "Not asked for" })
        expect(overtimeDecisionRow(employee, decision()).mayWithdraw).toBe(false)
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

    it("breaks a tie by id, as the database is read", () => {
        const at = "2026-10-30T10:00:00.000Z"
        // Read a, b, c, d by the database; pages of two are a, b then c, d.
        const read = { rows: ["a", "b", "c", "d"].map(id => row(id, at)), total: 4 }
        expect(pageOf([read], 1, 2).rows.map(r => r.id)).toEqual(["a", "b"])
        expect(pageOf([{ ...read, rows: read.rows.slice(0, 4) }], 2, 2).rows.map(r => r.id)).toEqual(["c", "d"])
    })

    it("has a page even with nothing on it", () => {
        expect(pageOf([], 1, 10)).toEqual({ rows: [], total: 0, totalPages: 1 })
    })
})
