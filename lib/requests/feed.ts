import { prisma } from "@/lib/prisma"
import { can, grantFor, type Actor, type Target } from "@/lib/permissions/can"
import { and, teamMemberWhere } from "@/lib/team-scope"
import { sessionHasModule } from "@/lib/features/require"
import { dayOffListFilters } from "@/lib/services/day-off-query"
import { addDays, toDateString } from "@/lib/attendance/calendar"
import { localToInstant } from "@/lib/attendance/punch-import"
import { PLATFORM_REASON } from "@/lib/services/attendance-flag.service"
import { REQUEST_KINDS, type FeedRow, type RequestKind, type RequestsShow, type RequestsTab } from "./kinds"

/**
 * The one Requests page's feed (UI_PLAN.md §2.3): every kind of request,
 * read through its own rules of who sees and decides it, as one list of rows
 * that read the same way: who asked, what for, when, its status, and whether
 * this person may decide it.
 *
 * Each kind is a source with its own rule and query; the page asks each for
 * as many rows as reach the end of the page shown, merges them newest first,
 * and keeps that page. A kind joins by adding its source here (§2.3,
 * parts 2–5).
 */

export { REQUEST_KINDS, type FeedRow, type RequestKind, type RequestsShow, type RequestsTab }

export type FeedQuery = {
    tab: RequestsTab
    show: RequestsShow
    /** One kind, or every kind this person has on this tab. */
    kind: RequestKind | ""
    search: string
    /** On To review, one person's. */
    personId: string
    /** The company the Super Admin picked, if any. */
    companyId: string | null
    /** Day off's dates of leave, as calendar days (§2.3, part 2d): those starting from and to. */
    from?: string
    to?: string
    page: number
    limit: number
}

export type Viewer = Actor & { id: string; role?: string | null; companyId?: string | null; featureAccess?: unknown }

type Listed = { rows: FeedRow[]; total: number }

type Source = {
    kind: RequestKind
    /** Which of this kind this person has on this tab; null when none. */
    where: (v: Viewer, q: FeedQuery) => Record<string, any> | null
    list: (v: Viewer, q: FeedQuery, where: Record<string, any>, take: number) => Promise<Listed>
}

// --- Internal requests: a title and details, started then done ----------

const WAITING = ["PENDING", "IN_PROGRESS"]

/**
 * Which internal requests this person has on a tab, as the requests API's
 * rule: Mine is their own; To review is everyone else's they see with
 * requests.view, at its reach. Null when they have none there.
 */
export function internalWhere(v: Viewer, q: Pick<FeedQuery, "tab" | "show" | "search" | "personId" | "companyId">): Record<string, any> | null {
    const where: Record<string, any> = {}
    if (q.tab === "mine") {
        // The Super Admin isn't anyone's employee, so asks for nothing in a company.
        if (v.role === "SUPER_ADMIN") return null
        where.userId = v.id
    } else {
        const reach = grantFor(v, "requests.view")
        if (!reach) return null
        if (reach === "ALL") {
            if (q.companyId) where.companyId = q.companyId
        } else {
            if (!v.companyId) return null
            where.companyId = v.companyId
            // Their own are on Mine.
            where.userId = { not: v.id }
            // A Team Leader answers their own team's.
            if (reach === "TEAM") and(where, { user: teamMemberWhere(v.id) })
        }
        if (q.personId) and(where, { userId: q.personId })
    }
    where.status = q.show === "done" ? "COMPLETED" : { in: WAITING }
    if (q.search) where.title = { contains: q.search, mode: "insensitive" }
    return where
}

type InternalRequest = {
    id: string
    title: string
    details: string
    status: string
    companyId: string
    userId: string
    createdAt: Date
    updatedAt: Date
    inProgressAt: Date | null
    completedAt: Date | null
    user: { firstName: string; lastName: string; teamLeaderId: string | null }
}

/**
 * An internal request as a row. Whether it may be decided or taken off is
 * the request service's own rule (RequestService.updateStatus, .delete):
 * deciding needs requests.review and requests.view at its asker, and a done
 * one stays, but for the Super Admin.
 */
export function internalRow(v: Viewer, r: InternalRequest): FeedRow {
    const target: Target = { companyId: r.companyId, userId: r.userId, teamLeaderId: r.user.teamLeaderId }
    const superAdmin = v.role === "SUPER_ADMIN"
    const reaches = can(v, "requests.view", target) && can(v, "requests.review", target)
    const done = r.status === "COMPLETED"
    const asked = r.createdAt.toISOString()
    return {
        kind: "internal",
        id: r.id,
        who: { id: r.userId, name: `${r.user.firstName} ${r.user.lastName}`.trim() },
        what: r.title,
        detail: r.details || null,
        asked,
        started: r.inProgressAt?.toISOString() ?? null,
        finished: r.completedAt?.toISOString() ?? null,
        status: r.status,
        sortAt: done ? r.updatedAt.toISOString() : asked,
        mayDecide: !done && reaches,
        mayDelete: superAdmin || (!done && (r.userId === v.id || (r.companyId === v.companyId && reaches))),
    }
}

/**
 * The order every kind is read in, which must be the order the page merges
 * them in (pageOf): newest first by sortAt, then by id. Read in any other
 * order, a tie at a page's edge gave the next page a different first rows,
 * repeating one and never showing another (found by Codex on PR 125). Done
 * is by when it last changed, which is when it was done or decided: an
 * internal request's completedAt is null on those done before it was kept,
 * and Postgres puts nulls first.
 */
export function feedOrder(show: RequestsShow) {
    return show === "done"
        ? [{ updatedAt: "desc" as const }, { id: "asc" as const }]
        : [{ createdAt: "desc" as const }, { id: "asc" as const }]
}

const internal: Source = {
    kind: "internal",
    where: internalWhere,
    list: (v, q, where, take) => {
        return Promise.all([
            prisma.request.findMany({
                where,
                orderBy: feedOrder(q.show),
                take,
                include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } },
            }),
            prisma.request.count({ where }),
        ]).then(([rows, total]) => ({ rows: rows.map(r => internalRow(v, r)), total }))
    },
}

// --- Day off: asked for, then approved or rejected (§2.3, part 2c) -------

const DECIDED = ["APPROVED", "REJECTED"]

/**
 * Which day-off requests this person has on a tab, in a company that has Day
 * off, as its APIs' rules: Mine is their own, whether or not their role may
 * still ask; To review is everyone else's they see with dayoff.view, at its
 * reach. Null when they have none there.
 */
export function dayOffWhere(v: Viewer, q: Pick<FeedQuery, "tab" | "show" | "search" | "personId" | "companyId" | "from" | "to">): Record<string, any> | null {
    if (!sessionHasModule({ user: v }, "DAY_OFF")) return null
    const where: Record<string, any> = {}
    if (q.tab === "mine") {
        if (v.role === "SUPER_ADMIN") return null
        where.userId = v.id
    } else {
        const reach = grantFor(v, "dayoff.view")
        if (!reach) return null
        if (reach === "ALL") {
            if (q.companyId) where.user = { companyId: q.companyId }
        } else {
            if (!v.companyId) return null
            // A request has no company of its own: its asker's is.
            where.user = reach === "TEAM" ? { companyId: v.companyId, ...teamMemberWhere(v.id) } : { companyId: v.companyId }
            // Their own are on Mine.
            where.userId = { not: v.id }
        }
        if (q.personId) and(where, { userId: q.personId })
    }
    where.status = q.show === "done" ? { in: DECIDED } : "PENDING"
    if (q.search) where.reason = { contains: q.search, mode: "insensitive" }
    // Its dates of leave, by the day each starts, as the Day off list read
    // them; a day that isn't one is left out.
    if (q.from || q.to) for (const dates of dayOffListFilters(new URLSearchParams({ from: q.from ?? "", to: q.to ?? "" }))) and(where, dates)
    return where
}

type DayOffRequest = {
    id: string
    userId: string
    type: string
    status: string
    reason: string | null
    date: Date
    endDate: Date | null
    createdAt: Date
    updatedAt: Date
    daysDeducted: number | null
    deductionType: string
    rejectionReason: string | null
    user: { firstName: string; lastName: string; teamLeaderId: string | null; companyId: string | null; dayOffCredit: number }
}

/**
 * A day-off request as a row. Deciding it is the decision route's own rule
 * (PATCH /api/admin/day-off-requests/[id]): dayoff.approve, which is never
 * one's own, and dayoff.view at its asker. It's never taken off.
 */
export function dayOffRow(v: Viewer, r: DayOffRequest): FeedRow {
    const target: Target = { companyId: r.user.companyId, userId: r.userId, teamLeaderId: r.user.teamLeaderId }
    const decided = r.status !== "PENDING"
    const mayDecide = !decided && can(v, "dayoff.view", target) && can(v, "dayoff.approve", target)
    const asked = r.createdAt.toISOString()
    return {
        kind: "dayOff",
        id: r.id,
        who: { id: r.userId, name: `${r.user.firstName} ${r.user.lastName}`.trim() },
        what: r.type,
        detail: r.reason || null,
        asked,
        started: null,
        finished: decided ? r.updatedAt.toISOString() : null,
        status: r.status,
        sortAt: decided ? r.updatedAt.toISOString() : asked,
        mayDecide,
        mayDelete: false,
        dayOff: {
            from: r.date.toISOString(),
            to: r.endDate?.toISOString() ?? null,
            deducted: r.daysDeducted ?? 0,
            deductedFrom: r.deductionType === "SALARY" ? "SALARY" : "CREDIT",
            rejectionReason: r.rejectionReason,
            credit: mayDecide ? r.user.dayOffCredit : null,
        },
    }
}

const dayOff: Source = {
    kind: "dayOff",
    where: dayOffWhere,
    list: (v, q, where, take) => {
        return Promise.all([
            prisma.dayOffRequest.findMany({
                where,
                orderBy: feedOrder(q.show),
                take,
                include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true, companyId: true, dayOffCredit: true } } },
            }),
            prisma.dayOffRequest.count({ where }),
        ]).then(([rows, total]) => ({ rows: rows.map(r => dayOffRow(v, r)), total }))
    },
}

// --- Permission hours: asked for, then approved, rejected or withdrawn (§2.3, part 3a)

const ENDED = ["APPROVED", "REJECTED", "CANCELLED"]

/**
 * Which permission hours this person has on a tab, in a company that has
 * Attendance, as its APIs' rules (app/api/attendance/permissions): Mine is
 * their own in their company; To review is everyone else's they decide with
 * attendance.approve_permissions, at its reach. Null when they have none there.
 */
export function permissionWhere(v: Viewer, q: Pick<FeedQuery, "tab" | "show" | "search" | "personId" | "companyId">): Record<string, any> | null {
    if (!sessionHasModule({ user: v }, "ATTENDANCE")) return null
    const where: Record<string, any> = {}
    if (q.tab === "mine") {
        // The Super Admin has no attendance of their own.
        if (v.role === "SUPER_ADMIN" || !v.companyId) return null
        where.companyId = v.companyId
        where.userId = v.id
    } else {
        const reach = grantFor(v, "attendance.approve_permissions")
        if (!reach) return null
        if (reach === "ALL") {
            if (q.companyId) where.companyId = q.companyId
        } else {
            if (!v.companyId) return null
            where.companyId = v.companyId
            // Their own are on Mine.
            where.userId = { not: v.id }
            if (reach === "TEAM") and(where, { user: teamMemberWhere(v.id) })
        }
        if (q.personId) and(where, { userId: q.personId })
    }
    where.status = q.show === "done" ? { in: ENDED } : "PENDING"
    if (q.search) where.reason = { contains: q.search, mode: "insensitive" }
    return where
}

type PermissionRequest = {
    id: string
    companyId: string
    userId: string
    date: Date
    type: string
    startMinutes: number
    endMinutes: number
    minutes: number
    reason: string
    status: string
    createdAt: Date
    updatedAt: Date
    rejectionReason: string | null
    user: { firstName: string; lastName: string; teamLeaderId: string | null }
    company: { timezone: string }
}

/** Minutes from a day's midnight as the clock reads them; a night's after midnight are the next morning's. */
const clock = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`

/**
 * Permission hours as a row. Deciding them is the decision route's own rule
 * (POST /api/attendance/permissions/[id]/decide): attendance.approve_permissions
 * at the asker, which is never one's own. Whoever asked may withdraw them
 * while they wait, or once approved until they begin, in the company's time
 * (AttendanceRequestService.cancelPermission).
 */
export function permissionRow(v: Viewer, r: PermissionRequest, now: Date): FeedRow {
    const target: Target = { companyId: r.companyId, userId: r.userId, teamLeaderId: r.user.teamLeaderId }
    const waits = r.status === "PENDING"
    const date = toDateString(r.date)
    const starts = localToInstant(`${addDays(date, Math.floor(r.startMinutes / 1440))}T${clock(r.startMinutes % 1440)}:00`, r.company.timezone)
    const asked = r.createdAt.toISOString()
    return {
        kind: "permission",
        id: r.id,
        who: { id: r.userId, name: `${r.user.firstName} ${r.user.lastName}`.trim() },
        what: r.type,
        detail: r.reason || null,
        asked,
        started: null,
        finished: waits ? null : r.updatedAt.toISOString(),
        status: r.status,
        sortAt: waits ? asked : r.updatedAt.toISOString(),
        mayDecide: waits && can(v, "attendance.approve_permissions", target),
        mayDelete: false,
        mayWithdraw: r.userId === v.id && (waits || (r.status === "APPROVED" && starts.getTime() > now.getTime())),
        permission: { date, start: clock(r.startMinutes), end: clock(r.endMinutes), minutes: r.minutes, rejectionReason: r.rejectionReason },
    }
}

const permission: Source = {
    kind: "permission",
    where: permissionWhere,
    list: (v, q, where, take) => {
        return Promise.all([
            prisma.permissionRequest.findMany({
                where,
                orderBy: feedOrder(q.show),
                take,
                include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true } }, company: { select: { timezone: true } } },
            }),
            prisma.permissionRequest.count({ where }),
        ]).then(([rows, total]) => {
            const now = new Date()
            return { rows: rows.map(r => permissionRow(v, r, now)), total }
        })
    },
}

// --- Missing punches: reported, then approved, rejected or withdrawn (§2.3, part 3b)

/**
 * Which reports of a missing punch this person has on a tab, in a company
 * that has Attendance, as its APIs' rules (app/api/attendance/missing-punches):
 * Mine is their own in their company; To review is everyone else's they
 * correct with attendance.correct, at its reach. Null when they have none there.
 */
export function missingPunchWhere(v: Viewer, q: Pick<FeedQuery, "tab" | "show" | "search" | "personId" | "companyId">): Record<string, any> | null {
    if (!sessionHasModule({ user: v }, "ATTENDANCE")) return null
    const where: Record<string, any> = {}
    if (q.tab === "mine") {
        // The Super Admin has no attendance of their own.
        if (v.role === "SUPER_ADMIN" || !v.companyId) return null
        where.companyId = v.companyId
        where.userId = v.id
    } else {
        const reach = grantFor(v, "attendance.correct")
        if (!reach) return null
        if (reach === "ALL") {
            if (q.companyId) where.companyId = q.companyId
        } else {
            if (!v.companyId) return null
            where.companyId = v.companyId
            // Their own are on Mine.
            where.userId = { not: v.id }
            if (reach === "TEAM") and(where, { user: teamMemberWhere(v.id) })
        }
        if (q.personId) and(where, { userId: q.personId })
    }
    where.status = q.show === "done" ? { in: ENDED } : "PENDING"
    if (q.search) where.reason = { contains: q.search, mode: "insensitive" }
    return where
}

type MissingPunchRequest = {
    id: string
    companyId: string
    userId: string
    claimedAt: Date
    direction: string | null
    reason: string
    status: string
    createdAt: Date
    updatedAt: Date
    rejectionReason: string | null
    user: { firstName: string; lastName: string; teamLeaderId: string | null }
}

/**
 * A report of a missing punch as a row. Deciding it is the decision route's
 * own rule (POST /api/attendance/missing-punches/[id]/decide):
 * attendance.correct at the one who reported it, which is never one's own.
 * Whoever reported it may withdraw it while it waits
 * (AttendanceRequestService.cancelMissingPunch).
 */
export function missingPunchRow(v: Viewer, r: MissingPunchRequest): FeedRow {
    const target: Target = { companyId: r.companyId, userId: r.userId, teamLeaderId: r.user.teamLeaderId }
    const waits = r.status === "PENDING"
    const asked = r.createdAt.toISOString()
    const direction = r.direction === "IN" || r.direction === "OUT" ? r.direction : null
    return {
        kind: "missingPunch",
        id: r.id,
        who: { id: r.userId, name: `${r.user.firstName} ${r.user.lastName}`.trim() },
        what: direction ?? "",
        detail: r.reason || null,
        asked,
        started: null,
        finished: waits ? null : r.updatedAt.toISOString(),
        status: r.status,
        sortAt: waits ? asked : r.updatedAt.toISOString(),
        mayDecide: waits && can(v, "attendance.correct", target),
        mayDelete: false,
        mayWithdraw: r.userId === v.id && waits,
        // A wall-clock time, kept as it reads (lib/services/attendance-request.service.ts).
        missingPunch: { at: r.claimedAt.toISOString().slice(0, 16), direction, rejectionReason: r.rejectionReason },
    }
}

const missingPunch: Source = {
    kind: "missingPunch",
    where: missingPunchWhere,
    list: (v, q, where, take) => {
        return Promise.all([
            prisma.missingPunchRequest.findMany({
                where,
                orderBy: feedOrder(q.show),
                take,
                include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } },
            }),
            prisma.missingPunchRequest.count({ where }),
        ]).then(([rows, total]) => ({ rows: rows.map(r => missingPunchRow(v, r)), total }))
    },
}

// --- Overtime: a day's waiting, then a decision on it (§2.3, part 4a) ---------

/**
 * Which overtime this person has on a tab, in a company that has Attendance,
 * as its API's rule (app/api/attendance/overtime): under To review only,
 * since nobody asks for it (decided on 2026-10-31), everyone else's they
 * decide with attendance.approve_overtime, at its reach. Waiting is the days
 * whose overtime waits for a decision (AttendanceDay); Done is the decisions
 * made (OvertimeApproval). Null when they have none there.
 */
export function overtimeWhere(v: Viewer, q: Pick<FeedQuery, "tab" | "show" | "search" | "personId" | "companyId">): Record<string, any> | null {
    if (!sessionHasModule({ user: v }, "ATTENDANCE")) return null
    if (q.tab === "mine") return null
    const reach = grantFor(v, "attendance.approve_overtime")
    if (!reach) return null
    const where: Record<string, any> = {}
    if (reach === "ALL") {
        if (q.companyId) where.companyId = q.companyId
    } else {
        if (!v.companyId) return null
        where.companyId = v.companyId
        // Nobody decides their own.
        where.userId = { not: v.id }
        if (reach === "TEAM") and(where, { user: teamMemberWhere(v.id) })
    }
    if (q.personId) and(where, { userId: q.personId })
    if (q.show === "done") {
        where.status = { in: DECIDED }
        if (q.search) where.note = { contains: q.search, mode: "insensitive" }
    } else {
        where.overtimeStatus = "PENDING"
        // A day waiting has no words to search.
        if (q.search) where.id = { in: [] }
    }
    return where
}

type OvertimePerson = { firstName: string; lastName: string; teamLeaderId: string | null }

type OvertimeDay = {
    id: string
    companyId: string
    userId: string
    date: Date
    overtimeMinutes: number
    firstInAt: Date | null
    lastOutAt: Date | null
    user: OvertimePerson
}

type OvertimeDecision = {
    id: string
    companyId: string
    userId: string
    date: Date
    status: string
    approvedMinutes: number
    note: string | null
    decidedAt: Date
    user: OvertimePerson
}

/** A wall-clock time's hour and minute, as it reads (lib/services/attendance-request.service.ts). */
const wallTime = (d: Date | null) => d ? d.toISOString().slice(11, 16) : null

/**
 * A day whose overtime waits, as a row. Deciding it is the decision route's
 * own rule (POST /api/attendance/overtime): attendance.approve_overtime at
 * whose day it is, which is never one's own. Its day is when it was "asked":
 * the page reads it as a day.
 */
export function overtimeDayRow(v: Viewer, d: OvertimeDay): FeedRow {
    const target: Target = { companyId: d.companyId, userId: d.userId, teamLeaderId: d.user.teamLeaderId }
    const day = d.date.toISOString()
    return {
        kind: "overtime",
        id: d.id,
        who: { id: d.userId, name: `${d.user.firstName} ${d.user.lastName}`.trim() },
        what: "",
        detail: null,
        asked: day,
        started: null,
        finished: null,
        status: "PENDING",
        sortAt: day,
        mayDecide: can(v, "attendance.approve_overtime", target),
        mayDelete: false,
        mayWithdraw: false,
        overtime: {
            companyId: d.companyId, userId: d.userId, date: toDateString(d.date), minutes: d.overtimeMinutes,
            firstIn: wallTime(d.firstInAt), lastOut: wallTime(d.lastOutAt), approvedMinutes: null, note: null,
        },
    }
}

/**
 * A decision on overtime, as a row, ordered by when it was made. Whoever may
 * decide it may withdraw it (DELETE /api/attendance/overtime/[id]), and the
 * day waits again.
 */
export function overtimeDecisionRow(v: Viewer, a: OvertimeDecision): FeedRow {
    const target: Target = { companyId: a.companyId, userId: a.userId, teamLeaderId: a.user.teamLeaderId }
    const decided = a.decidedAt.toISOString()
    return {
        kind: "overtime",
        id: a.id,
        who: { id: a.userId, name: `${a.user.firstName} ${a.user.lastName}`.trim() },
        what: "",
        detail: null,
        asked: a.date.toISOString(),
        started: null,
        finished: decided,
        status: a.status,
        sortAt: decided,
        mayDecide: false,
        mayDelete: false,
        mayWithdraw: can(v, "attendance.approve_overtime", target),
        overtime: {
            companyId: a.companyId, userId: a.userId, date: toDateString(a.date), minutes: null, firstIn: null, lastOut: null,
            approvedMinutes: a.status === "APPROVED" ? a.approvedMinutes : null, note: a.note,
        },
    }
}

const OVERTIME_PERSON = { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } } as const

const overtime: Source = {
    kind: "overtime",
    where: overtimeWhere,
    list: (v, q, where, take) => {
        // Each table in the order its rows' sortAt is: a day by its date, a decision by when it was made.
        if (q.show === "done") {
            return Promise.all([
                prisma.overtimeApproval.findMany({ where, orderBy: [{ decidedAt: "desc" }, { id: "asc" }], take, include: OVERTIME_PERSON }),
                prisma.overtimeApproval.count({ where }),
            ]).then(([rows, total]) => ({ rows: rows.map(r => overtimeDecisionRow(v, r)), total }))
        }
        return Promise.all([
            prisma.attendanceDay.findMany({
                where, orderBy: [{ date: "desc" }, { id: "asc" }], take,
                select: { id: true, companyId: true, userId: true, date: true, overtimeMinutes: true, firstInAt: true, lastOutAt: true, ...OVERTIME_PERSON },
            }),
            prisma.attendanceDay.count({ where }),
        ]).then(([rows, total]) => ({ rows: rows.map(r => overtimeDayRow(v, r)), total }))
    },
}

// --- Check-in phones: a new one waits, then is in use, rejected, revoked or withdrawn (§2.3, part 4b)

/** Decided since: approved and in use, rejected, revoked or replaced, or withdrawn by its owner. */
const PHONE_DONE = ["ACTIVE", "REJECTED", "REVOKED", "WITHDRAWN"]

/** The reason a phone keeps when a new one of its owner's was approved: not anybody's words. */
const REPLACED = "REPLACED"

/**
 * Which check-in phones this person has on a tab, in a company that has
 * Attendance, as its API's rule (app/api/attendance/phones): under To review
 * only, since one's own phone stays on the Attendance page (decided on
 * 2026-10-31), everyone else's they decide with attendance.approve_devices,
 * at its reach. Null when they have none there.
 */
export function phoneWhere(v: Viewer, q: Pick<FeedQuery, "tab" | "show" | "search" | "personId" | "companyId">): Record<string, any> | null {
    if (!sessionHasModule({ user: v }, "ATTENDANCE")) return null
    if (q.tab === "mine") return null
    const reach = grantFor(v, "attendance.approve_devices")
    if (!reach) return null
    const where: Record<string, any> = {}
    if (reach === "ALL") {
        if (q.companyId) where.companyId = q.companyId
    } else {
        if (!v.companyId) return null
        where.companyId = v.companyId
        // Nobody decides their own.
        where.userId = { not: v.id }
        if (reach === "TEAM") and(where, { user: teamMemberWhere(v.id) })
    }
    if (q.personId) and(where, { userId: q.personId })
    where.status = q.show === "done" ? { in: PHONE_DONE } : "PENDING"
    if (q.search) {
        // Why one was rejected or revoked; a phone waiting has no words to match.
        if (q.show === "done") where.reason = { contains: q.search, mode: "insensitive", not: REPLACED }
        else where.id = { in: [] }
    }
    return where
}

type CheckInPhone = {
    id: string
    companyId: string
    userId: string
    platform: string
    model: string | null
    appVersion: string | null
    attested: boolean
    status: string
    requestedAt: Date
    decidedAt: Date | null
    reason: string | null
    user: { firstName: string; lastName: string; teamLeaderId: string | null }
    /** The check-ins it holds. */
    _count: { punches: number }
}

/**
 * A check-in phone as a row: waiting, in order of when it was asked for;
 * decided, of when it was, which every change of its status keeps
 * (AttendancePhoneService). Deciding it and revoking the one in use are the
 * routes' own rule (app/api/attendance/phones/[id]): attendance.approve_devices
 * at its owner, which is never one's own.
 */
export function phoneRow(v: Viewer, p: CheckInPhone): FeedRow {
    const target: Target = { companyId: p.companyId, userId: p.userId, teamLeaderId: p.user.teamLeaderId }
    const waits = p.status === "PENDING"
    const decides = can(v, "attendance.approve_devices", target)
    const asked = p.requestedAt.toISOString()
    // Never null once decided; were it, last, as the database reads Done.
    const finished = waits ? null : p.decidedAt?.toISOString() ?? null
    const replaced = p.status === "REVOKED" && p.reason === REPLACED
    return {
        kind: "phone",
        id: p.id,
        who: { id: p.userId, name: `${p.user.firstName} ${p.user.lastName}`.trim() },
        what: p.model ?? "",
        detail: null,
        asked,
        started: null,
        finished,
        status: p.status,
        sortAt: waits ? asked : finished ?? "",
        mayDecide: waits && decides,
        mayDelete: false,
        mayWithdraw: false,
        mayRevoke: p.status === "ACTIVE" && decides,
        phone: {
            platform: p.platform === "IOS" ? "IOS" : "ANDROID", model: p.model, appVersion: p.appVersion, attested: p.attested,
            held: p._count.punches, reason: replaced ? null : p.reason, replaced,
        },
    }
}

const phone: Source = {
    kind: "phone",
    where: phoneWhere,
    list: (v, q, where, take) => {
        // Each in the order its rows' sortAt is: waiting by when it was asked for, decided by when it was.
        const orderBy = q.show === "done"
            ? [{ decidedAt: { sort: "desc" as const, nulls: "last" as const } }, { id: "asc" as const }]
            : [{ requestedAt: "desc" as const }, { id: "asc" as const }]
        return Promise.all([
            prisma.checkInPhone.findMany({
                where, orderBy, take,
                select: {
                    id: true, companyId: true, userId: true, platform: true, model: true, appVersion: true, attested: true,
                    status: true, requestedAt: true, decidedAt: true, reason: true,
                    user: { select: { firstName: true, lastName: true, teamLeaderId: true } },
                    _count: { select: { punches: { where: { status: "PENDING_DEVICE" } } } },
                },
            }),
            prisma.checkInPhone.count({ where }),
        ]).then(([rows, total]) => ({ rows: rows.map(r => phoneRow(v, r)), total }))
    },
}

// --- Flagged check-ins: waiting for someone to accept or reject them (§2.3, part 4c)

/**
 * Which flagged check-ins this person has on a tab, in a company that has
 * Attendance, as its API's rule (app/api/attendance/flagged): under To
 * review only, since nobody asks for them (decided on 2026-10-31), everyone
 * else's they correct with attendance.correct, at its reach. Not those
 * flagged because our app couldn't prove itself: the Super Admin looks at
 * them on their own page. Waiting is those still flagged and not withdrawn;
 * Done is those decided, whatever came of them since. Null when they have
 * none there.
 */
export function flaggedWhere(v: Viewer, q: Pick<FeedQuery, "tab" | "show" | "search" | "personId" | "companyId">): Record<string, any> | null {
    if (!sessionHasModule({ user: v }, "ATTENDANCE")) return null
    if (q.tab === "mine") return null
    const reach = grantFor(v, "attendance.correct")
    if (!reach) return null
    const where: Record<string, any> = {}
    if (reach === "ALL") {
        if (q.companyId) where.companyId = q.companyId
        // A check-in the app sent is always somebody's.
        where.userId = { not: null }
    } else {
        if (!v.companyId) return null
        where.companyId = v.companyId
        // Nobody decides their own.
        where.userId = { not: v.id }
        if (reach === "TEAM") and(where, { user: teamMemberWhere(v.id) })
    }
    if (q.personId) and(where, { userId: q.personId })
    if (q.show === "done") where.reviewedAt = { not: null }
    else Object.assign(where, { status: "FLAGGED", voidedAt: null })
    where.NOT = { flagReasons: { has: PLATFORM_REASON } }
    if (q.search) {
        // Why one was rejected; one waiting has no words to match.
        if (q.show === "done") where.reviewReason = { contains: q.search, mode: "insensitive" }
        else where.id = { in: [] }
    }
    return where
}

type FlaggedPunch = {
    id: string
    companyId: string
    userId: string | null
    status: string
    direction: string | null
    punchAtLocal: Date
    receivedAt: Date
    reviewedAt: Date | null
    reviewReason: string | null
    flagReasons: string[]
    checkIn: unknown
    workLocation: { name: string } | null
    phone: { model: string | null; platform: string } | null
    user: { firstName: string; lastName: string; teamLeaderId: string | null } | null
}

/** What the phone said, read as it was kept: a number is only one if it is one. */
const numberIn = (o: unknown, key: string) => {
    const n = o && typeof o === "object" ? (o as Record<string, unknown>)[key] : undefined
    return typeof n === "number" && Number.isFinite(n) ? n : null
}

/**
 * A flagged check-in as a row: waiting, in order of when it arrived; decided,
 * of when it was. Deciding it is the decision route's own rule (POST
 * /api/attendance/flagged/[id]/decide): attendance.correct at whose it is,
 * which is never one's own. A failed face check's photos are seen by whoever
 * approves faces, and only while it waits, as the photo route's rule.
 */
export function flaggedRow(v: Viewer, p: FlaggedPunch): FeedRow {
    const target: Target = { companyId: p.companyId, userId: p.userId, teamLeaderId: p.user?.teamLeaderId ?? null }
    const waits = p.status === "FLAGGED" && !p.reviewedAt
    const asked = p.receivedAt.toISOString()
    const finished = p.reviewedAt?.toISOString() ?? null
    const direction = p.direction === "IN" || p.direction === "OUT" ? p.direction : null
    const round = (n: number | null) => n === null ? null : Math.round(n)
    const ip = p.checkIn && typeof p.checkIn === "object" ? (p.checkIn as Record<string, unknown>).ip : null
    return {
        kind: "flagged",
        id: p.id,
        who: { id: p.userId ?? "", name: p.user ? `${p.user.firstName} ${p.user.lastName}`.trim() : "" },
        what: direction ?? "",
        detail: null,
        asked,
        started: null,
        finished,
        status: p.status,
        sortAt: waits ? asked : finished ?? "",
        mayDecide: waits && can(v, "attendance.correct", target),
        mayDelete: false,
        mayWithdraw: false,
        flagged: {
            // A wall-clock time, kept as it reads (lib/services/attendance-flag.service.ts).
            at: p.punchAtLocal.toISOString().slice(0, 16),
            direction,
            reasons: p.flagReasons,
            place: p.workLocation?.name ?? null,
            distance: round(numberIn(p.checkIn, "distanceMeters")),
            accuracy: round(numberIn(p.checkIn, "accuracyMeters")),
            ip: typeof ip === "string" && ip ? ip : null,
            latitude: numberIn(p.checkIn, "latitude"),
            longitude: numberIn(p.checkIn, "longitude"),
            phone: p.phone?.model ?? null,
            reason: p.reviewReason,
            mayViewFace: waits && p.flagReasons.includes("FACE_UNVERIFIED") && can(v, "attendance.approve_face", target),
        },
    }
}

/**
 * Those in a month whose payroll is approved or paid, left out of Waiting as
 * the Attendance page's list leaves them out: deciding one would be refused
 * (AttendanceFlagService.decide), and it would wait forever. By the month it
 * was on; one at a month's edge that a night shift carries over is refused
 * when it's decided, and says so.
 */
async function closedMonths(where: Record<string, any>) {
    const runs = await prisma.payrollRun.findMany({
        where: { status: { in: ["APPROVED", "PAID"] }, ...(typeof where.companyId === "string" ? { companyId: where.companyId } : {}) },
        select: { companyId: true, year: true, month: true },
    })
    return runs.map(r => ({
        companyId: r.companyId,
        punchAtLocal: { gte: new Date(Date.UTC(r.year, r.month - 1, 1)), lt: new Date(Date.UTC(r.year, r.month, 1)) },
    }))
}

const flagged: Source = {
    kind: "flagged",
    where: flaggedWhere,
    list: async (v, q, where, take) => {
        const closed = q.show === "done" ? [] : await closedMonths(where)
        const shown = closed.length > 0 ? and({ ...where }, { NOT: { OR: closed } }) : where
        // Each in the order its rows' sortAt is: waiting by when it arrived, decided by when it was.
        const orderBy = q.show === "done"
            ? [{ reviewedAt: "desc" as const }, { id: "asc" as const }]
            : [{ receivedAt: "desc" as const }, { id: "asc" as const }]
        const [rows, total] = await Promise.all([
            prisma.attendancePunch.findMany({
                where: shown, orderBy, take,
                select: {
                    id: true, companyId: true, userId: true, status: true, direction: true, punchAtLocal: true, receivedAt: true,
                    reviewedAt: true, reviewReason: true, flagReasons: true, checkIn: true,
                    workLocation: { select: { name: true } }, phone: { select: { model: true, platform: true } },
                    user: { select: { firstName: true, lastName: true, teamLeaderId: true } },
                },
            }),
            prisma.attendancePunch.count({ where: shown }),
        ])
        return { rows: rows.map(r => flaggedRow(v, r)), total }
    },
}

const SOURCES: Source[] = [internal, dayOff, permission, missingPunch, overtime, phone, flagged]

// --- The page --------------------------------------------------------

/** Every kind's rows, merged newest first, and the page of them shown. */
export function pageOf(lists: Listed[], page: number, limit: number) {
    // By character, as the database orders ids, not by the locale's rules.
    const byId = (a: FeedRow, b: FeedRow) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    const rows = lists.flatMap(l => l.rows).sort((a, b) => (a.sortAt < b.sortAt ? 1 : a.sortAt > b.sortAt ? -1 : 0) || byId(a, b))
    const total = lists.reduce((sum, l) => sum + l.total, 0)
    return { rows: rows.slice((page - 1) * limit, page * limit), total, totalPages: Math.max(1, Math.ceil(total / limit)) }
}

/** Whether this person has a tab at all: some kind they ask for, or some they see others'. */
export function tabsFor(v: Viewer): Record<RequestsTab, boolean> {
    const probe: FeedQuery = { tab: "mine", show: "waiting", kind: "", search: "", personId: "", companyId: null, page: 1, limit: 1 }
    return {
        mine: SOURCES.some(s => s.where(v, probe) !== null),
        review: SOURCES.some(s => s.where(v, { ...probe, tab: "review" }) !== null),
    }
}

export async function requestFeed(v: Viewer, q: FeedQuery) {
    const offered = SOURCES.map(source => ({ source, where: source.where(v, q) }))
        .filter((o): o is { source: Source; where: Record<string, any> } => o.where !== null)
    const kinds = offered.map(o => o.source.kind)
    const shown = offered.filter(o => !q.kind || o.source.kind === q.kind)
    // Each kind's rows up to the end of the page shown, so the merge has them all.
    const lists = await Promise.all(shown.map(o => o.source.list(v, q, o.where, q.page * q.limit)))
    return { ...pageOf(lists, q.page, q.limit), kinds }
}
