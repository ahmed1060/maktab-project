import { describe, it, expect } from "vitest"
import { withGrants } from "@/lib/permissions/test-actors"
import { dayOffRow, dayOffWhere, feedOrder, flaggedRow, flaggedWhere, internalRow, nameChangeRow, nameChangeWhere, internalWhere, missingPunchRow, missingPunchWhere, overtimeDecisionRow, overtimeDayRow, overtimeWhere, pageOf, permissionRow, permissionWhere, phoneRow, phoneWhere, roleOrder, roleRow, roleWhere, type FeedRow } from "./feed"

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

// --- Check-in phones (UI_PLAN.md §2.3, part 4b) -------------------------------

/** A role of a company's own that decides its team's phones. */
const phoneLead = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,53.2" }

describe("check-in phones", () => {
    const review = { ...waiting, tab: "review" as const }
    const done = { ...review, show: "done" as const }

    it("are under To review only: one's own phone stays on the Attendance page (decided on 2026-10-31)", () => {
        expect(phoneWhere(employee, waiting)).toBeNull()
        expect(phoneWhere(admin, waiting)).toBeNull()
    })

    it("waiting is everyone else's new phones waiting for approval, for whoever decides the company's", () => {
        expect(phoneWhere(admin, review)).toEqual({ companyId: "c1", userId: { not: "a1" }, status: "PENDING" })
    })

    it("done is those decided since: in use, rejected, revoked or replaced, and withdrawn", () => {
        expect(phoneWhere(admin, done)).toEqual({ companyId: "c1", userId: { not: "a1" }, status: { in: ["ACTIVE", "REJECTED", "REVOKED", "WITHDRAWN"] } })
    })

    it("are their team's for a role that decides its team's, the picked company's for the Super Admin, and one person's when picked", () => {
        expect(phoneWhere(phoneLead, { ...review, personId: "x9" })).toEqual({
            companyId: "c1", userId: { not: "h1" }, status: "PENDING", AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }, { userId: "x9" }],
        })
        expect(phoneWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", status: "PENDING" })
    })

    it("aren't there for whoever doesn't decide them, nor in a company without Attendance", () => {
        expect(phoneWhere(employee, review)).toBeNull()
        expect(phoneWhere(overtimeLead, review)).toBeNull()
        expect(phoneWhere(withoutAttendance(admin), review)).toBeNull()
    })

    it("are searched by why one was rejected or revoked, not by the word a replaced one keeps; a phone waiting has no words to match", () => {
        expect(phoneWhere(admin, { ...done, search: "lost" })).toMatchObject({ reason: { contains: "lost", mode: "insensitive", not: "REPLACED" } })
        expect(phoneWhere(admin, { ...review, search: "lost" })).toMatchObject({ id: { in: [] } })
    })
})

describe("a check-in phone's row", () => {
    const asked = new Date("2026-10-29T08:00:00Z")
    const decided = new Date("2026-10-30T12:00:00Z")
    const phone = (fields: object = {}) => ({
        id: "ph1", companyId: "c1", userId: "e2", platform: "ANDROID", model: "Pixel 8", appVersion: "1.4.0", attested: true,
        status: "PENDING", requestedAt: asked, decidedAt: null, reason: null,
        user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1" }, _count: { punches: 3 }, ...fields,
    })

    it("waiting says whose, which phone, and how many check-ins it holds, and is in order of when it was asked for", () => {
        expect(phoneRow(admin, phone())).toMatchObject({
            kind: "phone", id: "ph1", who: { id: "e2", name: "Mona Adel" }, what: "Pixel 8", detail: null, status: "PENDING",
            asked: asked.toISOString(), sortAt: asked.toISOString(), finished: null, mayDelete: false, mayWithdraw: false, mayRevoke: false,
            phone: { platform: "ANDROID", model: "Pixel 8", appVersion: "1.4.0", attested: true, held: 3, reason: null, replaced: false },
        })
    })

    it("waiting may be decided by whoever decides phones, within their team for a team's, and never their own", () => {
        expect(phoneRow(admin, phone()).mayDecide).toBe(true)
        expect(phoneRow(phoneLead, phone()).mayDecide).toBe(true)
        expect(phoneRow(phoneLead, phone({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2" } })).mayDecide).toBe(false)
        expect(phoneRow(admin, phone({ userId: "a1" })).mayDecide).toBe(false)
    })

    it("once decided, is in order of when, says why it was refused, and the one in use may be revoked by whoever may decide it", () => {
        const inUse = phoneRow(admin, phone({ status: "ACTIVE", decidedAt: decided, _count: { punches: 0 } }))
        expect(inUse).toMatchObject({ status: "ACTIVE", finished: decided.toISOString(), sortAt: decided.toISOString(), mayDecide: false, mayRevoke: true, phone: { held: 0 } })
        expect(phoneRow(employee, phone({ status: "ACTIVE", decidedAt: decided })).mayRevoke).toBe(false)
        expect(phoneRow(admin, phone({ status: "ACTIVE", decidedAt: decided, userId: "a1" })).mayRevoke).toBe(false)
        expect(phoneRow(admin, phone({ status: "REJECTED", decidedAt: decided, reason: "Not a work phone" }))).toMatchObject({ mayRevoke: false, phone: { reason: "Not a work phone", replaced: false } })
    })

    it("one revoked when a new one was approved says it was replaced, not why it was revoked", () => {
        expect(phoneRow(admin, phone({ status: "REVOKED", decidedAt: decided, reason: "REPLACED" })).phone).toMatchObject({ reason: null, replaced: true })
        expect(phoneRow(admin, phone({ status: "REVOKED", decidedAt: decided, reason: "Lost" })).phone).toMatchObject({ reason: "Lost", replaced: false })
    })

    it("a phone with no model kept is named by the page, from its platform", () => {
        expect(phoneRow(admin, phone({ model: null })).what).toBe("")
    })
})

// --- Flagged check-ins (UI_PLAN.md §2.3, part 4c) -----------------------------

/** A role of a company's own that corrects its team's attendance, and one that also sees face photos. */
const correctsTeam = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,50.2" }
const seesFaces = { id: "h1", role: "TEAM_LEADER", companyId: "c1", grants: "49.2,50.2,54.3" }

describe("flagged check-ins", () => {
    const review = { ...waiting, tab: "review" as const }
    const done = { ...review, show: "done" as const }
    // The Super Admin's to look at, on their own page: never the company's.
    const notPlatform = { NOT: { flagReasons: { has: "ATTESTATION_UNVERIFIED" } } }

    it("are under To review only: nobody asks for them (decided on 2026-10-31)", () => {
        expect(flaggedWhere(employee, waiting)).toBeNull()
        expect(flaggedWhere(admin, waiting)).toBeNull()
    })

    it("waiting is everyone else's still flagged, for whoever corrects the company's attendance, but those the Super Admin looks at", () => {
        expect(flaggedWhere(admin, review)).toEqual({ companyId: "c1", userId: { not: "a1" }, status: "FLAGGED", voidedAt: null, ...notPlatform })
    })

    it("done is those decided, whatever came of them since", () => {
        expect(flaggedWhere(admin, done)).toEqual({ companyId: "c1", userId: { not: "a1" }, reviewedAt: { not: null }, ...notPlatform })
    })

    it("are their team's for a role that corrects its team's, the picked company's for the Super Admin, and one person's when picked", () => {
        expect(flaggedWhere(correctsTeam, { ...review, personId: "x9" })).toEqual({
            companyId: "c1", userId: { not: "h1" }, status: "FLAGGED", voidedAt: null, ...notPlatform,
            AND: [{ user: { OR: [{ teamLeaderId: "h1" }, { id: "h1" }] } }, { userId: "x9" }],
        })
        expect(flaggedWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", userId: { not: null }, status: "FLAGGED", voidedAt: null, ...notPlatform })
    })

    it("aren't there for whoever doesn't correct attendance, nor in a company without Attendance", () => {
        expect(flaggedWhere(employee, review)).toBeNull()
        expect(flaggedWhere(phoneLead, review)).toBeNull()
        expect(flaggedWhere(withoutAttendance(admin), review)).toBeNull()
    })

    it("are searched by why one was rejected; one waiting has no words to match", () => {
        expect(flaggedWhere(admin, { ...done, search: "home" })).toMatchObject({ reviewReason: { contains: "home", mode: "insensitive" } })
        expect(flaggedWhere(admin, { ...review, search: "home" })).toMatchObject({ id: { in: [] } })
    })
})

describe("a flagged check-in's row", () => {
    const received = new Date("2026-10-29T06:02:10Z")
    const reviewed = new Date("2026-10-30T12:00:00Z")
    const punch = (fields: object = {}) => ({
        id: "k1", companyId: "c1", userId: "e2", status: "FLAGGED", direction: "IN", punchAtLocal: new Date("2026-10-29T09:02:00Z"),
        receivedAt: received, reviewedAt: null, reviewReason: null, flagReasons: ["OUTSIDE_AREA", "IMPRECISE_LOCATION"],
        checkIn: { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 85.4, distanceMeters: 240, ip: "41.33.1.2", attested: true },
        workLocation: { name: "Head office" }, phone: { model: "Pixel 8", platform: "ANDROID" },
        user: { firstName: "Mona", lastName: "Adel", teamLeaderId: "h1" }, ...fields,
    })

    it("waiting says whose, when on the wall's clock, why, and where, in order of when it arrived", () => {
        expect(flaggedRow(admin, punch())).toMatchObject({
            kind: "flagged", id: "k1", who: { id: "e2", name: "Mona Adel" }, what: "IN", detail: null, status: "FLAGGED",
            asked: received.toISOString(), sortAt: received.toISOString(), finished: null, mayDelete: false, mayWithdraw: false,
            flagged: {
                at: "2026-10-29T09:02", direction: "IN", reasons: ["OUTSIDE_AREA", "IMPRECISE_LOCATION"], place: "Head office",
                distance: 240, accuracy: 85, ip: "41.33.1.2", latitude: 30.0444, longitude: 31.2357, phone: "Pixel 8", reason: null, mayViewFace: false,
            },
        })
    })

    it("waiting may be decided by whoever corrects attendance, within their team for a team's, and never their own", () => {
        expect(flaggedRow(admin, punch()).mayDecide).toBe(true)
        expect(flaggedRow(correctsTeam, punch()).mayDecide).toBe(true)
        expect(flaggedRow(correctsTeam, punch({ user: { firstName: "Sami", lastName: "Nabil", teamLeaderId: "h2" } })).mayDecide).toBe(false)
        expect(flaggedRow(admin, punch({ userId: "a1" })).mayDecide).toBe(false)
    })

    it("one whose face check failed has its photos for whoever sees face photos, while it waits", () => {
        const face = { flagReasons: ["FACE_UNVERIFIED"] }
        expect(flaggedRow(admin, punch(face)).flagged!.mayViewFace).toBe(true)
        expect(flaggedRow(seesFaces, punch(face)).flagged!.mayViewFace).toBe(true)
        expect(flaggedRow(correctsTeam, punch(face)).flagged!.mayViewFace).toBe(false)
        expect(flaggedRow(admin, punch()).flagged!.mayViewFace).toBe(false)
        expect(flaggedRow(admin, punch({ ...face, status: "ACCEPTED", reviewedAt: reviewed })).flagged!.mayViewFace).toBe(false)
    })

    it("once decided, is in order of when, and says why it was rejected", () => {
        expect(flaggedRow(admin, punch({ status: "REJECTED", reviewedAt: reviewed, reviewReason: "Worked from home" }))).toMatchObject({
            status: "REJECTED", finished: reviewed.toISOString(), sortAt: reviewed.toISOString(), mayDecide: false, flagged: { reason: "Worked from home" },
        })
    })

    it("reads what the phone said only as far as it said it", () => {
        const row = flaggedRow(admin, punch({ direction: null, checkIn: null, workLocation: null, phone: null }))
        expect(row.what).toBe("")
        expect(row.flagged).toMatchObject({ direction: null, place: null, distance: null, accuracy: null, ip: null, latitude: null, longitude: null, phone: null })
    })
})

// --- Name changes (UI_PLAN.md §2.3, part 5a) -----------------------------------

describe("name changes", () => {
    const review = { ...waiting, tab: "review" as const }

    it("on Mine are one's own, waiting or decided", () => {
        expect(nameChangeWhere(employee, waiting)).toEqual({ userId: "e1", status: "PENDING" })
        expect(nameChangeWhere(employee, { ...waiting, show: "done" })).toEqual({ userId: "e1", status: { in: ["APPROVED", "REJECTED"] } })
    })

    it("aren't the Super Admin's own, who has no name in a company to change", () => {
        expect(nameChangeWhere(superAdmin, waiting)).toBeNull()
    })

    it("on To review are everyone else's in the company, for whoever decides them, and the picked company's for the Super Admin", () => {
        expect(nameChangeWhere(admin, review)).toEqual({ user: { companyId: "c1" }, userId: { not: "a1" }, status: "PENDING" })
        expect(nameChangeWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ user: { companyId: "c2" }, status: "PENDING" })
        expect(nameChangeWhere(admin, { ...review, personId: "x9" })).toMatchObject({ AND: [{ userId: "x9" }] })
    })

    it("aren't there for whoever doesn't decide them", () => {
        expect(nameChangeWhere(employee, review)).toBeNull()
        expect(nameChangeWhere(leader, review)).toBeNull()
    })

    it("are searched by the new name, and once decided by the note it was decided with", () => {
        expect(nameChangeWhere(employee, { ...waiting, search: "sam" })).toMatchObject({
            OR: [{ newFirstName: { contains: "sam", mode: "insensitive" } }, { newLastName: { contains: "sam", mode: "insensitive" } }],
        })
        expect(nameChangeWhere(employee, { ...waiting, show: "done", search: "id" })).toMatchObject({
            OR: [{ newFirstName: { contains: "id", mode: "insensitive" } }, { newLastName: { contains: "id", mode: "insensitive" } }, { adminNote: { contains: "id", mode: "insensitive" } }],
        })
    })
})

describe("a name change's row", () => {
    const asked = new Date("2026-10-29T08:00:00Z")
    const decided = new Date("2026-10-30T12:00:00Z")
    const change = (fields: object = {}) => ({
        id: "n1", userId: "e2", oldFirstName: "Mona", oldLastName: "Adel", newFirstName: "Mona", newLastName: "Adel Fahmy",
        status: "PENDING", adminNote: null, createdAt: asked, updatedAt: asked,
        user: { firstName: "Mona", lastName: "Adel", companyId: "c1", teamLeaderId: null }, ...fields,
    })

    it("waiting says whose, the name it's for and the one it was, in order of when it was asked", () => {
        expect(nameChangeRow(admin, change())).toMatchObject({
            kind: "nameChange", id: "n1", who: { id: "e2", name: "Mona Adel" }, what: "Mona Adel Fahmy", detail: null, status: "PENDING",
            asked: asked.toISOString(), sortAt: asked.toISOString(), finished: null, mayDecide: true, mayDelete: false, mayWithdraw: false,
            nameChange: { from: "Mona Adel", to: "Mona Adel Fahmy", note: null },
        })
    })

    it("may be decided by whoever decides name changes, never their own, and not once decided", () => {
        expect(nameChangeRow(employee, change()).mayDecide).toBe(false)
        expect(nameChangeRow(admin, change({ userId: "a1" })).mayDecide).toBe(false)
        expect(nameChangeRow(admin, change({ status: "APPROVED", updatedAt: decided })).mayDecide).toBe(false)
    })

    it("once decided, is in order of when, with the note it was decided with", () => {
        expect(nameChangeRow(admin, change({ status: "REJECTED", updatedAt: decided, adminNote: "Use the name on your ID" }))).toMatchObject({
            finished: decided.toISOString(), sortAt: decided.toISOString(), nameChange: { note: "Use the name on your ID" },
        })
    })
})

// --- Role requests (UI_PLAN.md §2.3, part 5b) ----------------------------------

describe("role requests", () => {
    const review = { ...waiting, tab: "review" as const }
    // A company's own role on the Employee base, asking for roles: HR (ROLES_PLAN.md §6.12).
    const hr = { id: "h1", role: "EMPLOYEE", companyId: "c1", grants: "10.3" }

    it("on Mine are those one asked for, waiting, or decided or withdrawn", () => {
        expect(roleWhere(hr, waiting)).toEqual({ requestedById: "h1", status: "PENDING" })
        expect(roleWhere(hr, { ...waiting, show: "done" })).toEqual({ requestedById: "h1", status: { in: ["APPROVED", "REJECTED", "CANCELLED"] } })
    })

    it("aren't on Mine for whoever doesn't ask for roles, nor the Super Admin", () => {
        expect(roleWhere(employee, waiting)).toBeNull()
        expect(roleWhere(admin, waiting)).toBeNull()
        expect(roleWhere(superAdmin, waiting)).toBeNull()
    })

    it("on To review are the company's that somebody else asked for, for whoever gives roles, and the picked company's for the Super Admin", () => {
        expect(roleWhere(admin, review)).toEqual({ companyId: "c1", requestedById: { not: "a1" }, status: "PENDING" })
        expect(roleWhere(superAdmin, { ...review, companyId: "c2" })).toEqual({ companyId: "c2", status: "PENDING" })
        // Who asked, as the person filter reads every row by (found in the browser).
        expect(roleWhere(admin, { ...review, personId: "x9" })).toMatchObject({ AND: [{ requestedById: "x9" }] })
    })

    it("aren't on To review for whoever only asks for roles, or gives none", () => {
        expect(roleWhere(hr, review)).toBeNull()
        expect(roleWhere(leader, review)).toBeNull()
    })

    it("are searched by the note it was asked with, and once decided by the one it was decided with", () => {
        expect(roleWhere(hr, { ...waiting, search: "new hire" })).toMatchObject({ OR: [{ note: { contains: "new hire", mode: "insensitive" } }] })
        expect(roleWhere(hr, { ...waiting, show: "done", search: "audit" })).toMatchObject({
            OR: [{ note: { contains: "audit", mode: "insensitive" } }, { decisionNote: { contains: "audit", mode: "insensitive" } }],
        })
    })

    it("are in order of when each was asked, and once done, of when it was decided or withdrawn", () => {
        expect(roleOrder("waiting")).toEqual([{ createdAt: "desc" }, { id: "asc" }])
        // Reminding the deciders touches a request; when it was decided doesn't move.
        expect(roleOrder("done")).toEqual([{ decidedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }])
    })
})

describe("a role request's row", () => {
    const hr = { id: "h1", role: "EMPLOYEE", companyId: "c1", grants: "10.3" }
    const asked = new Date("2026-10-29T08:00:00Z")
    const decided = new Date("2026-10-30T12:00:00Z")
    const request = (fields: object = {}) => ({
        id: "r1", companyId: "c1", userId: "e2", requestedById: "h1", status: "PENDING", note: "Joins the accounts team", decisionNote: null,
        actingUntil: null, createdAt: asked, decidedAt: null, company: { timezone: "Africa/Cairo" },
        user: { firstName: "Mona", lastName: "Adel", teamLeaderId: null, assignedRole: { name: "Employee", builtIn: "EMPLOYEE" } },
        role: { name: "Accountant", builtIn: null },
        requestedBy: { firstName: "Hoda", lastName: "Samir" },
        decidedBy: null,
        ...fields,
    })

    it("waiting says who asked and why, the role, whose it would be and the one they hold, in order of when it was asked", () => {
        // Who asked is the row's person, as every row's is: the person it's for is beside the role (found in the browser).
        expect(roleRow(admin, request())).toMatchObject({
            kind: "role", id: "r1", who: { id: "h1", name: "Hoda Samir" }, what: "Accountant", detail: "Joins the accounts team", status: "PENDING",
            asked: asked.toISOString(), sortAt: asked.toISOString(), finished: null, mayDecide: true, mayDelete: false, mayWithdraw: false,
            role: { to: { name: "Accountant", builtIn: null }, now: { name: "Employee", builtIn: "EMPLOYEE" }, actingUntil: null, person: { id: "e2", name: "Mona Adel" }, decidedBy: null, note: null },
        })
    })

    it("as an acting role, says until when: the company's own day, as it was asked for (found by Codex on PR 138)", () => {
        // 5 November in Cairo is kept as its start there, the 4th in UTC (RoleAssignmentService.returnOn).
        expect(roleRow(admin, request({ actingUntil: new Date("2026-11-04T22:00:00Z") })).role?.actingUntil).toBe("2026-11-05")
        expect(roleRow(admin, request({ actingUntil: new Date("2026-11-05T05:00:00Z"), company: { timezone: "America/New_York" } })).role?.actingUntil).toBe("2026-11-05")
    })

    it("may be decided by whoever gives roles but not by whoever asked, and withdrawn by whoever asked, while it waits", () => {
        expect(roleRow(admin, request({ requestedById: "a1" })).mayDecide).toBe(false)
        expect(roleRow(hr, request())).toMatchObject({ mayDecide: false, mayWithdraw: true })
        expect(roleRow(admin, request({ status: "APPROVED", decidedAt: decided }))).toMatchObject({ mayDecide: false, mayWithdraw: false })
        expect(roleRow(hr, request({ status: "CANCELLED", decidedAt: decided })).mayWithdraw).toBe(false)
    })

    it("once decided, is in order of when, with who decided and the note they decided with, and no role held to compare", () => {
        expect(roleRow(admin, request({ status: "REJECTED", decidedAt: decided, decisionNote: "Wait for the audit", decidedBy: { firstName: "Amal", lastName: "One" } }))).toMatchObject({
            finished: decided.toISOString(), sortAt: decided.toISOString(),
            // Approving gave them the role: the one held now isn't the one it changed from.
            role: { now: null, decidedBy: "Amal One", note: "Wait for the audit" },
        })
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
