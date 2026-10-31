import { prisma } from "@/lib/prisma"
import { can, grantFor, type Actor, type Target } from "@/lib/permissions/can"
import { and, teamMemberWhere } from "@/lib/team-scope"
import { sessionHasModule } from "@/lib/features/require"
import { dayOffListFilters } from "@/lib/services/day-off-query"
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

const SOURCES: Source[] = [internal, dayOff]

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
