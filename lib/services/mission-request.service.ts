import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { toDateString } from "@/lib/attendance/calendar"
import { policyOn } from "@/lib/attendance/policy"
import { datesOf, missionSpan, type MissionKind, type MissionPart } from "@/lib/attendance/missions"
import { optional, type NoticeParam, type NoticeText } from "@/lib/notice"
import { AuditLogService } from "./audit-log.service"
import { AttendancePolicyService } from "./attendance-policy.service"
import { AttendanceCalendarService } from "./attendance-calendar.service"
import { NotificationService } from "./notification.service"
import { recomputeAfter } from "./attendance-recompute"
import { LOCK_WAIT, SETTLED, lockDateMonths, lockPersonDates } from "./attendance-lock"
import { refuseOwnerMonths } from "./owner.service"

/**
 * Missions asked for and decided (ATTENDANCE_PLAN.md §6.10, round 10,
 * decisions 4, 10, 11, 16, 18, 20 and 25, PR 283). The routes check who may
 * ask and who may decide; this checks what a mission may be.
 *
 * Asking takes the person's lock and the months' locks, as permission hours
 * do, and is refused while any of its dates falls under a policy with
 * missions off, over another mission or a day off waiting or approved, or
 * with a task that isn't one of theirs and open. A month whose payroll is
 * approved is no refusal (decision 16): once approved, the mission's days
 * are worked out again, and those in a closed month become discrepancies
 * (§12.3) through the recompute's own rule. Cancelling an approved one
 * (decision 25, PR 285) works them out again the same way, the other way
 * round.
 */

function fail(code: string): never {
    throw new Error(code)
}

/** A task one may name: theirs, and still open (decision 18). */
const OPEN_TASK = ["PENDING", "IN_PROGRESS"] as const
/** A mission or a day off that holds its dates. */
const HOLDING = ["PENDING", "APPROVED"]

const day = (date: string) => new Date(`${date}T00:00:00Z`)
const dayParam = (date: string): NoticeParam => ({ date: `${date}T00:00:00.000Z` })
const reasonParam = (reason: string | null) => optional("notice_reason_suffix", { reason: reason ?? "" }, reason)
/** A mission's day, or its first and last, as its notice names them. */
const whenParam = (start: string, end: string): NoticeText => start === end
    ? { key: "notice_mission_day", params: { date: dayParam(start) } }
    : { key: "notice_mission_days", params: { from: dayParam(start), to: dayParam(end) } }

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

/** One person's days off waiting or approved on any of these dates. A day off without an end is its one day. */
export function dayOffOver(userId: string, start: string, end: string) {
    return {
        userId,
        status: { in: HOLDING },
        OR: [
            { date: { lte: day(end) }, endDate: { gte: day(start) } },
            { endDate: null, date: { gte: day(start), lte: day(end) } },
        ],
    }
}

/** One person's missions waiting or approved on any of these dates. */
export function missionOver(userId: string, start: string, end: string) {
    return { userId, status: { in: HOLDING as ("PENDING" | "APPROVED")[] }, startDate: { lte: day(end) }, endDate: { gte: day(start) } }
}

export type MissionInput = {
    kind: MissionKind
    startDate: string
    endDate?: string | null
    hoursPart?: MissionPart | null
    taskId?: string | null
    reason: string
}

export class MissionRequestService {
    /** Whether today's policy lets missions be asked for: on in every policy, and where there's none (decision 11). */
    static async missionsOnToday(companyId: string) {
        const [today, policies] = await Promise.all([AttendanceCalendarService.today(companyId), AttendancePolicyService.versions(companyId)])
        return policyOn(policies, today)?.body.missions.enabled ?? true
    }

    /** One's open tasks, which a mission may name (decision 18): theirs, Pending or In progress, in their company. */
    static async openTasks(companyId: string, userId: string) {
        return prisma.task.findMany({
            where: { companyId, status: { in: [...OPEN_TASK] }, assignees: { some: { id: userId } } },
            select: { id: true, title: true },
            orderBy: [{ deadline: "asc" }, { title: "asc" }],
            take: 100,
        })
    }

    /**
     * Asks for a mission, for oneself. `tasks` says whether the company has
     * Tasks: without, no task can be named.
     */
    static async ask(companyId: string, userId: string, input: MissionInput, { tasks = true }: { tasks?: boolean } = {}) {
        const reason = input.reason.trim()
        if (!reason) fail("REASON_REQUIRED")
        const today = await AttendanceCalendarService.today(companyId)
        const span = missionSpan(input, today)
        if ("refused" in span) fail(span.refused)
        const dates = datesOf(span.startDate, span.endDate)
        return prisma.$transaction(async tx => {
            await lockPersonDates(tx, userId)
            // Never on a day their final settlement counted: paid, with nothing after it to pay a change (Codex review on PR 430).
            if ((await lockDateMonths(tx, companyId, dates, userId)).includes(SETTLED)) fail("PAYROLL_MONTH_LOCKED")
            await refuseOwnerMonths(tx, userId, span.startDate, span.endDate)
            const policies = await AttendancePolicyService.versions(companyId, tx)
            if (dates.some(d => policyOn(policies, d)?.body.missions.enabled === false)) fail("MISSIONS_OFF")
            if (await tx.missionRequest.findFirst({ where: missionOver(userId, span.startDate, span.endDate), select: { id: true } })) fail("MISSION_OVERLAPS")
            if (await tx.dayOffRequest.findFirst({ where: dayOffOver(userId, span.startDate, span.endDate), select: { id: true } })) fail("MISSION_OVERLAPS_DAY_OFF")
            let task: { id: string; title: string } | null = null
            if (input.taskId) {
                task = tasks ? await tx.task.findFirst({
                    where: { id: input.taskId, companyId, status: { in: [...OPEN_TASK] }, assignees: { some: { id: userId } } },
                    select: { id: true, title: true },
                }) : null
                if (!task) fail("MISSION_TASK_NOT_OPEN")
            }
            const created = await tx.missionRequest.create({
                data: {
                    companyId, userId, kind: input.kind, startDate: day(span.startDate), endDate: day(span.endDate), hoursPart: span.hoursPart,
                    taskId: task?.id ?? null, taskTitle: task?.title ?? null, reason,
                },
            })
            await AuditLogService.log("REQUEST_ATTENDANCE_MISSION", "MISSION_REQUEST", created.id, {
                tx, userId, details: { companyId, type: input.kind, from: span.startDate, to: span.endDate, hoursPart: span.hoursPart, taskTitle: task?.title ?? null, reason },
            })
            return { id: created.id, status: created.status, startDate: span.startDate, endDate: span.endDate }
        }, LOCK_WAIT)
    }

    static async of(id: string) {
        return prisma.missionRequest.findUnique({ where: { id }, include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } } })
    }

    /** Withdraws one's own mission while it waits (decision 25). An approved one is cancelled instead, below. */
    static async withdraw(id: string, userId: string) {
        await prisma.$transaction(async tx => {
            const m = await tx.missionRequest.findUnique({ where: { id }, select: { userId: true, companyId: true, startDate: true, endDate: true } })
            if (!m || m.userId !== userId) fail("REQUEST_NOT_FOUND")
            // Only while it waits: a decision made meanwhile wins.
            const { count } = await tx.missionRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "WITHDRAWN" } })
            if (count === 0) fail("REQUEST_ALREADY_DECIDED")
            await AuditLogService.log("WITHDRAW_ATTENDANCE_MISSION", "MISSION_REQUEST", id, {
                tx, userId, details: { companyId: m.companyId, from: toDateString(m.startDate), to: toDateString(m.endDate) },
            })
        })
    }

    /**
     * Approves or rejects somebody else's mission, never one's own. The asker
     * hears either way (§13.4); once approved, its days are worked out again
     * from its first, a closed month's becoming discrepancies (decision 16).
     */
    static async decide(id: string, decision: { approve: boolean; reason?: string | null }, reviewerId: string) {
        const out = await prisma.$transaction(async tx => {
            const m = await tx.missionRequest.findUnique({ where: { id } }) ?? fail("REQUEST_NOT_FOUND")
            if (m.userId === reviewerId) fail("CANNOT_DECIDE_OWN")
            const from = toDateString(m.startDate), to = toDateString(m.endDate)
            if ((await lockDateMonths(tx, m.companyId, datesOf(from, to), m.userId)).includes(SETTLED)) fail("PAYROLL_MONTH_LOCKED")
            const status = decision.approve ? "APPROVED" : "REJECTED"
            const rejectionReason = decision.approve ? null : decision.reason?.trim() || null
            // Only while it waits: a withdrawal or another decision made meanwhile wins.
            const { count } = await tx.missionRequest.updateMany({
                where: { id, status: "PENDING" },
                data: { status, reviewedById: reviewerId, reviewedAt: new Date(), rejectionReason },
            })
            if (count === 0) fail("REQUEST_ALREADY_DECIDED")
            await AuditLogService.log(decision.approve ? "APPROVE_ATTENDANCE_MISSION" : "REJECT_ATTENDANCE_MISSION", "MISSION_REQUEST", id, {
                tx, ...(await actorOf(tx, reviewerId)), details: { companyId: m.companyId, userId: m.userId, from, to, reason: rejectionReason },
            })
            await NotificationService.notify(m.userId, "ATTENDANCE_REQUEST", {
                key: decision.approve ? "notice_att_mission_approved" : "notice_att_mission_rejected",
                params: { when: whenParam(from, to), reason: reasonParam(rejectionReason) },
            }, id, tx)
            return { companyId: m.companyId, userId: m.userId, from, to }
        }, LOCK_WAIT)
        if (decision.approve) await reworkMission(out.companyId, out.userId, out.from, out.to)
    }

    /**
     * Cancels somebody else's approved mission, with a reason (decision 25,
     * PR 285), never one's own. The asker hears why; its days are worked out
     * again from its first, so they count as they would without it, a closed
     * month's becoming discrepancies the other way round from approving it.
     * Its dates are free again for another mission or a day off.
     */
    static async cancel(id: string, why: string, actorId: string) {
        const reason = why.trim()
        if (!reason) fail("REASON_REQUIRED")
        const out = await prisma.$transaction(async tx => {
            const m = await tx.missionRequest.findUnique({ where: { id } }) ?? fail("REQUEST_NOT_FOUND")
            if (m.userId === actorId) fail("CANNOT_DECIDE_OWN")
            const from = toDateString(m.startDate), to = toDateString(m.endDate)
            if ((await lockDateMonths(tx, m.companyId, datesOf(from, to), m.userId)).includes(SETTLED)) fail("PAYROLL_MONTH_LOCKED")
            // Only an approved one: one waiting is rejected or withdrawn, and one cancelled meanwhile stays as it was.
            const { count } = await tx.missionRequest.updateMany({
                where: { id, status: "APPROVED" },
                data: { status: "CANCELLED", cancelledById: actorId, cancelledAt: new Date(), cancelReason: reason },
            })
            if (count === 0) fail("MISSION_NOT_APPROVED")
            await AuditLogService.log("CANCEL_ATTENDANCE_MISSION", "MISSION_REQUEST", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: m.companyId, userId: m.userId, from, to, reason },
            })
            await NotificationService.notify(m.userId, "ATTENDANCE_REQUEST", {
                key: "notice_att_mission_cancelled",
                params: { when: whenParam(from, to), reason: reasonParam(reason) },
            }, id, tx)
            return { companyId: m.companyId, userId: m.userId, from, to }
        }, LOCK_WAIT)
        await reworkMission(out.companyId, out.userId, out.from, out.to)
    }
}

/**
 * Once approved, or cancelled after it, a mission's days are worked out
 * again from its first, and the days after them, as after any change. The engine's own cascade reaches
 * a year back at most, which a mission asked near that edge can have passed
 * while it waited: its months before that are worked out by name (found by
 * Codex on PR 283).
 */
async function reworkMission(companyId: string, userId: string, from: string, to: string) {
    const { AttendanceEngineService: Engine, monthsBetween, reworkFloor } = await import("./attendance-engine.service")
    const floor = reworkFloor(await AttendanceCalendarService.today(companyId)).slice(0, 7)
    for (const month of monthsBetween(from, to).filter(m => m < floor)) {
        try {
            await Engine.recomputeMonth(companyId, month, [userId])
        } catch (error) {
            // Never undoing the decision, as after any change (AttendanceEngineService.afterChange).
            console.error("[attendance] recompute after a mission failed", companyId, month, error)
        }
    }
    await recomputeAfter(companyId, from, [userId])
}
