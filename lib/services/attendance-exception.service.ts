import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { isDateString, toDateString } from "@/lib/attendance/calendar"
import { AuditLogService } from "./audit-log.service"
import { recomputeAfter } from "./attendance-recompute"
import { lockMonths, lockedMonths } from "./attendance-lock"
import type { Visibility } from "./attendance-punch.service"

/**
 * Daily exceptions (ATTENDANCE_PLAN.md §13.1): only what needs a decision —
 * lateness or early leave that counts, absences, days with a punch missing,
 * overtime waiting for approval — with what waits on the Requests and
 * Employee numbers tabs counted beside them. Access is the caller's: the
 * route shows what the viewer sees and lets them decide what they correct.
 *
 * A decision is excused (not charged, for a reason) or accepted (the charge
 * stands; the day leaves the list). Excuses are applied when the day is
 * priced (lib/attendance/engine.ts); every decision is audited and can be
 * withdrawn while its month is open.
 */

function fail(code: string): never {
    throw new Error(code)
}

const wallClock = (local: string) => new Date(`${local}Z`)
const wallClockText = (d: Date) => d.toISOString().slice(0, 19)

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

async function openMonth(tx: Prisma.TransactionClient, companyId: string, date: string) {
    await lockMonths(tx, companyId, [date.slice(0, 7)])
    if ((await lockedMonths(tx, companyId, [date.slice(0, 7)])).size > 0) fail("PAYROLL_MONTH_LOCKED")
}

function visibleWhere(v: Visibility) {
    if (v.kind === "COMPANY") return {}
    if (v.kind === "TEAM") return { user: { OR: [{ teamLeaderId: v.leaderId }, { id: v.leaderId }] } }
    return { userId: v.userId }
}

export type Subject = "LATENESS" | "EARLY_LEAVE" | "ABSENCE"
export type DecisionInput = { userId: string; date: string; subject: Subject; outcome: "EXCUSED" | "ACCEPTED"; reason?: string | null }

/** The most of each kind one list returns. */
export const EXCEPTION_LIST_LIMIT = 500

/** A rule outcome that needs a look: past grace, whether free this time or charged. */
const counts = (note: unknown) => note === "FREE_OCCURRENCE" || note === "CHARGED" || note === "ESCALATED" || note === "CAPPED"

export class AttendanceExceptionService {
    /**
     * What needs a decision between two dates, for the people the viewer
     * sees. `waiting` counts what the other tabs hold for whoever decides it:
     * null where the viewer decides none of it.
     */
    static async list(
        companyId: string,
        query: { from: string; to: string },
        visible: Visibility,
        waitingFor: { permissions: Visibility | null; missing: Visibility | null; unmatched: boolean },
    ) {
        const range = { gte: wallClock(`${query.from}T00:00:00`), lte: wallClock(`${query.to}T00:00:00`) }
        const [days, decisions, permissions, missing, unmatched] = await Promise.all([
            prisma.attendanceDay.findMany({
                where: {
                    companyId, date: range, ...visibleWhere(visible),
                    OR: [{ lateMinutes: { gt: 0 } }, { earlyLeaveMinutes: { gt: 0 } }, { status: { in: ["ABSENT", "INCOMPLETE"] } }, { overtimeStatus: "PENDING" }],
                },
                orderBy: [{ date: "desc" }, { userId: "asc" }],
                omit: { inputsHash: true },
                include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } },
            }),
            prisma.attendanceDayDecision.findMany({
                where: { companyId, date: range, ...visibleWhere(visible) },
                orderBy: [{ date: "desc" }, { decidedAt: "desc" }],
                include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } },
            }),
            waitingFor.permissions ? prisma.permissionRequest.count({ where: { companyId, status: "PENDING", ...visibleWhere(waitingFor.permissions) } }) : null,
            waitingFor.missing ? prisma.missingPunchRequest.count({ where: { companyId, status: "PENDING", ...visibleWhere(waitingFor.missing) } }) : null,
            waitingFor.unmatched ? prisma.attendancePunch.count({ where: { companyId, userId: null, voidedAt: null } }) : null,
        ])

        const decided = new Set(decisions.map(d => `${d.userId}:${toDateString(d.date)}:${d.subject}`))
        const open = (userId: string, date: Date, subject: Subject) => !decided.has(`${userId}:${toDateString(date)}:${subject}`)
        const shape = ({ user, date, firstInAt, lastOutAt, deductionDays, ...d }: (typeof days)[number]) => ({
            ...d,
            date: toDateString(date),
            firstIn: firstInAt ? wallClockText(firstInAt) : null,
            lastOut: lastOutAt ? wallClockText(lastOutAt) : null,
            deductionDays: Number(deductionDays),
            name: `${user.firstName} ${user.lastName}`.trim(),
            teamLeaderId: user.teamLeaderId,
        })
        const breakdown = (d: (typeof days)[number]) => (d.breakdown ?? {}) as { lateness?: { note?: unknown }; earlyLeave?: { note?: unknown } }
        const take = <T>(rows: T[]) => rows.slice(0, EXCEPTION_LIST_LIMIT)

        const late = take(days.filter(d => d.status === "PRESENT" && d.lateMinutes > 0 && counts(breakdown(d).lateness?.note) && open(d.userId, d.date, "LATENESS")).map(shape))
        const early = take(days.filter(d => d.status === "PRESENT" && d.earlyLeaveMinutes > 0 && counts(breakdown(d).earlyLeave?.note) && open(d.userId, d.date, "EARLY_LEAVE")).map(shape))
        const absent = take(days.filter(d => d.status === "ABSENT" && open(d.userId, d.date, "ABSENCE")).map(shape))
        const incomplete = take(days.filter(d => d.status === "INCOMPLETE").map(shape))
        const overtime = take(days.filter(d => d.overtimeStatus === "PENDING").map(shape))
        return {
            late, early, absent, incomplete, overtime,
            decided: take(decisions).map(({ user, date, ...d }) => ({ ...d, date: toDateString(date), name: `${user.firstName} ${user.lastName}`.trim(), teamLeaderId: user.teamLeaderId })),
            counts: {
                late: late.length, early: early.length, absent: absent.length, incomplete: incomplete.length, overtime: overtime.length,
                permissions, missing, unmatched,
            },
        }
    }

    /** Excuses or accepts one part of somebody's day. Deciding again replaces the decision. */
    static async decide(companyId: string, input: DecisionInput, actorId: string) {
        if (!isDateString(input.date)) fail("INVALID_DATE")
        if (input.userId === actorId) fail("CANNOT_CORRECT_OWN")
        const reason = input.reason?.trim() || null
        if (input.outcome === "EXCUSED" && !reason) fail("REASON_REQUIRED")
        const date = wallClock(`${input.date}T00:00:00`)
        const saved = await prisma.$transaction(async tx => {
            const person = await tx.user.findFirst({ where: { id: input.userId, companyId, status: { not: "DELETED" } }, select: { id: true } })
            if (!person) fail("USER_NOT_FOUND")
            await openMonth(tx, companyId, input.date)
            // Only an exception that is there now can be decided — or a decision
            // already made, changed. Otherwise a future day could be excused in
            // advance and the waiver applied, unseen, when it came (review on #15).
            const already = await tx.attendanceDayDecision.findUnique({ where: { userId_date_subject: { userId: input.userId, date, subject: input.subject } }, select: { id: true } })
            if (!already) {
                const day = await tx.attendanceDay.findUnique({
                    where: { companyId_userId_date: { companyId, userId: input.userId, date } },
                    select: { status: true, lateMinutes: true, earlyLeaveMinutes: true },
                })
                const fits = !!day && (
                    input.subject === "LATENESS" ? day.status === "PRESENT" && day.lateMinutes > 0
                        : input.subject === "EARLY_LEAVE" ? day.status === "PRESENT" && day.earlyLeaveMinutes > 0
                            : day.status === "ABSENT")
                if (!fits) fail("NOTHING_TO_DECIDE")
            }
            const row = await tx.attendanceDayDecision.upsert({
                where: { userId_date_subject: { userId: input.userId, date, subject: input.subject } },
                create: { companyId, userId: input.userId, date, subject: input.subject, outcome: input.outcome, reason, decidedById: actorId },
                update: { outcome: input.outcome, reason, decidedById: actorId, decidedAt: new Date() },
            })
            await AuditLogService.log("DECIDE_ATTENDANCE_DAY", "ATTENDANCE_DAY_DECISION", row.id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId, userId: input.userId, date: input.date, subject: input.subject, outcome: input.outcome, reason },
            })
            return row
        })
        await recomputeAfter(companyId, input.date, [input.userId])
        return { ...saved, date: input.date }
    }

    static async decisionOf(id: string) {
        return prisma.attendanceDayDecision.findUnique({ where: { id }, include: { user: { select: { teamLeaderId: true } } } })
    }

    /** Takes a decision back: the day is charged as measured, and listed again. */
    static async withdraw(id: string, actorId: string) {
        const out = await prisma.$transaction(async tx => {
            const d = await tx.attendanceDayDecision.findUnique({ where: { id } }) ?? fail("DECISION_NOT_FOUND")
            if (d.userId === actorId) fail("CANNOT_CORRECT_OWN")
            const date = toDateString(d.date)
            await openMonth(tx, d.companyId, date)
            await tx.attendanceDayDecision.delete({ where: { id } })
            await AuditLogService.log("WITHDRAW_ATTENDANCE_DAY_DECISION", "ATTENDANCE_DAY_DECISION", id, {
                tx, ...(await actorOf(tx, actorId)),
                details: { companyId: d.companyId, userId: d.userId, date, subject: d.subject },
            })
            return { companyId: d.companyId, userId: d.userId, date }
        })
        await recomputeAfter(out.companyId, out.date, [out.userId])
    }
}
