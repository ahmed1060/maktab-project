import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { addDays, isDateString, toDateString } from "@/lib/attendance/calendar"
import { policyOn, type PolicyBody } from "@/lib/attendance/policy"
import { localToInstant } from "@/lib/attendance/punch-import"
import { AuditLogService } from "./audit-log.service"
import { AttendancePolicyService } from "./attendance-policy.service"
import { AttendanceCalendarService } from "./attendance-calendar.service"
import { recomputeAfter } from "./attendance-recompute"
import { lockMonths, lockedMonths, punchMonths } from "./attendance-lock"
import { insertManualPunch, type Visibility } from "./attendance-punch.service"
import { NotificationService } from "./notification.service"
import { optional, type NoticeParam } from "@/lib/notice"

/**
 * Attendance requests (ATTENDANCE_PLAN.md §6.4, §6.6, §8.4): permission hours
 * (إذن), decisions on overtime, and reports of a missing punch. Access is the
 * caller's — the routes check who may ask and who may decide; this service
 * checks what the policy allows, and that nobody decides their own.
 *
 * Every write takes the company-month lock first (§12.1): nothing is asked
 * for or decided in a month whose payroll is approved or paid, and two
 * requests made at once cannot both spend the last of an allowance.
 */

const dayParam = (date: string): NoticeParam => ({ date: `${date}T00:00:00.000Z` })
const reasonParam = (reason: string | null) => optional("notice_reason_suffix", { reason: reason ?? "" }, reason)

function fail(code: string): never {
    throw new Error(code)
}

const wallClock = (local: string) => new Date(`${local}Z`)
const wallClockText = (d: Date) => d.toISOString().slice(0, 19)
const monthOf = (date: string) => date.slice(0, 7)
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
/** A time of day, in minutes from that day's midnight, as a wall-clock text. */
const localAt = (date: string, minutes: number) => `${addDays(date, Math.floor(minutes / 1440))}T${hhmm(minutes % 1440)}:00`
const monthRange = (month: string) => ({ gte: wallClock(`${month}-01T00:00:00`), lt: wallClock(`${addDays(`${month}-28`, 4).slice(0, 7)}-01T00:00:00`) })

async function actorOf(tx: Prisma.TransactionClient, actorId: string) {
    const superAdmin = await tx.superAdmin.findUnique({ where: { id: actorId }, select: { id: true } })
    return superAdmin ? { superAdminId: actorId } : { userId: actorId }
}

async function companyOf(tx: Prisma.TransactionClient, companyId: string) {
    return await tx.company.findUnique({ where: { id: companyId }, select: { timezone: true } }) ?? fail("COMPANY_NOT_FOUND")
}

async function openMonth(tx: Prisma.TransactionClient, companyId: string, month: string) {
    await openMonths(tx, companyId, [month])
}

async function openMonths(tx: Prisma.TransactionClient, companyId: string, months: string[]) {
    await lockMonths(tx, companyId, months)
    if ((await lockedMonths(tx, companyId, months)).size > 0) fail("PAYROLL_MONTH_LOCKED")
}

/** Whose requests a viewer sees, as a filter on the request's person. */
function visibleWhere(v: Visibility) {
    if (v.kind === "COMPANY") return {}
    if (v.kind === "TEAM") return { user: { OR: [{ teamLeaderId: v.leaderId }, { id: v.leaderId }] } }
    return { userId: v.userId }
}

const PERSON = { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } } as const
const nameOf = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim()

export type PermissionBalance = {
    month: string
    enabled: boolean
    types: string[]
    /** The month's own allowance, and what is carried in from the month before. */
    allowanceMinutes: number
    carriedMinutes: number
    approvedMinutes: number
    pendingMinutes: number
    /** What a new request may still take: the allowance less what is approved or waiting. */
    remainingMinutes: number
    /** How far what is approved or waiting goes past the allowance: above 0 only when something was taken back. */
    overdrawnMinutes: number
    requests: number
    maxRequests: number | null
    minPerRequestMinutes: number
    maxPerRequestMinutes: number
    afterTheFactHours: number
}

/** The policy's permission hours in force on a date, or a refusal when there is none. */
function permissionRules(policies: Awaited<ReturnType<typeof AttendancePolicyService.versions>>, date: string): PolicyBody["permissionHours"] | null {
    return policyOn(policies, date)?.body.permissionHours ?? null
}

/**
 * One person's permission hours for a date's month: allowed, spent and
 * waiting, under the policy in force that date. CARRY_ONCE brings in what
 * last month's own allowance left neither used nor waiting — once: what was
 * carried into last month does not carry again.
 */
async function balanceIn(tx: Prisma.TransactionClient, companyId: string, userId: string, date: string, except?: string): Promise<PermissionBalance> {
    const month = monthOf(date)
    const policies = await AttendancePolicyService.versions(companyId)
    const rules = permissionRules(policies, date)
    const rows = await tx.permissionRequest.findMany({
        where: { companyId, userId, status: { in: ["APPROVED", "PENDING"] }, date: monthRange(month), ...(except ? { id: { not: except } } : {}) },
        select: { status: true, minutes: true },
    })
    const approvedMinutes = rows.filter(r => r.status === "APPROVED").reduce((s, r) => s + r.minutes, 0)
    const pendingMinutes = rows.filter(r => r.status === "PENDING").reduce((s, r) => s + r.minutes, 0)
    let carriedMinutes = 0
    if (rules?.enabled && rules.carryOver === "CARRY_ONCE") {
        const last = addDays(`${month}-01`, -1).slice(0, 7)
        const before = permissionRules(policies, addDays(`${month}-01`, -1))
        if (before?.enabled) {
            // What waits for a decision there is reserved, as it is in its own
            // month: carrying it too would let both months spend it (review on #14).
            const used = await tx.permissionRequest.aggregate({ where: { companyId, userId, status: { in: ["APPROVED", "PENDING"] }, date: monthRange(last) }, _sum: { minutes: true } })
            carriedMinutes = Math.max(0, before.monthlyAllowanceMinutes - (used._sum.minutes ?? 0))
        }
    }
    const allowanceMinutes = rules?.enabled ? rules.monthlyAllowanceMinutes : 0
    return {
        month,
        enabled: rules?.enabled ?? false,
        types: rules?.types ?? [],
        allowanceMinutes,
        carriedMinutes,
        approvedMinutes,
        pendingMinutes,
        remainingMinutes: Math.max(0, allowanceMinutes + carriedMinutes - approvedMinutes - pendingMinutes),
        overdrawnMinutes: Math.max(0, approvedMinutes + pendingMinutes - allowanceMinutes - carriedMinutes),
        requests: rows.length,
        maxRequests: rules?.maxRequestsPerMonth ?? null,
        minPerRequestMinutes: rules?.minPerRequestMinutes ?? 0,
        maxPerRequestMinutes: rules?.maxPerRequestMinutes ?? 0,
        afterTheFactHours: rules?.afterTheFactHours ?? 0,
    }
}

export type PermissionInput = { date: string; type: "LATE_ARRIVAL" | "EARLY_LEAVE" | "MIDDAY"; start: string; end: string; reason: string }
export type MissingPunchInput = { at: string; direction: "IN" | "OUT" | null; reason: string }
export type OvertimeInput = { userId: string; date: string; status: "APPROVED" | "REJECTED"; minutes?: number | null; note?: string | null }

/** "08:30" as minutes from midnight; an end before its start is the next morning. */
function minutesOf(text: string): number {
    const m = /^(\d{2}):(\d{2})$/.exec(text) ?? fail("INVALID_TIME")
    const [h, min] = [Number(m[1]), Number(m[2])]
    if (h > 23 || min > 59) fail("INVALID_TIME")
    return h * 60 + min
}

export class AttendanceRequestService {
    // --- permission hours -----------------------------------------------------

    /**
     * A month's balance under the policy in force on a date in it: the date
     * asked about (the day a request would be for, review on #14), else
     * today when it is this month, else the month's first day.
     */
    static async permissionBalance(companyId: string, userId: string, month: string, date?: string | null) {
        if (date) {
            if (!isDateString(date)) fail("INVALID_DATE")
            return prisma.$transaction(tx => balanceIn(tx, companyId, userId, date))
        }
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail("INVALID_MONTH")
        const today = await this.todayIn(companyId)
        return prisma.$transaction(tx => balanceIn(tx, companyId, userId, monthOf(today) === month ? today : `${month}-01`))
    }

    /** Asks for permission hours, for oneself. */
    static async requestPermission(companyId: string, userId: string, input: PermissionInput) {
        if (!isDateString(input.date)) fail("INVALID_DATE")
        if (!input.reason.trim()) fail("REASON_REQUIRED")
        const asked = minutesOf(input.start)
        let askedEnd = minutesOf(input.end)
        if (askedEnd <= asked) askedEnd += 1440
        const minutes = askedEnd - asked
        const next = `${addDays(`${input.date.slice(0, 8)}28`, 4).slice(0, 7)}-01`
        const out = await prisma.$transaction(async tx => {
            const company = await companyOf(tx, companyId)
            // On a night shift, a span after midnight is the next morning's part of the date's shift: 05:00-06:00
            // of a 22:00-06:00 night was the evening before it began, so it excused nothing and was "too late"
            // to ask for the morning after (review on #14).
            const { plans } = await (await import("./attendance-engine.service")).AttendanceEngineService.plansFor(companyId, [userId], [input.date], tx)
            const shift = plans.get(userId)?.get(input.date)
            const nextMorning = shift?.kind === "WORK" && shift.hours.endMinutes > 1440 && askedEnd <= shift.hours.startMinutes && asked + 1440 < shift.hours.endMinutes
            const startMinutes = nextMorning ? asked + 1440 : asked
            const endMinutes = nextMorning ? askedEnd + 1440 : askedEnd
            // And the next month's, whose carried minutes this one can spend.
            await lockMonths(tx, companyId, [monthOf(input.date), monthOf(next)])
            await openMonth(tx, companyId, monthOf(input.date))
            const balance = await balanceIn(tx, companyId, userId, input.date)
            if (!balance.enabled) fail("PERMISSION_HOURS_OFF")
            if (!balance.types.includes(input.type)) fail("PERMISSION_TYPE_NOT_ALLOWED")
            if (minutes < balance.minPerRequestMinutes) fail("PERMISSION_TOO_SHORT")
            if (minutes > balance.maxPerRequestMinutes) fail("PERMISSION_TOO_LONG")
            if (balance.maxRequests !== null && balance.requests >= balance.maxRequests) fail("PERMISSION_TOO_MANY_REQUESTS")
            if (minutes > balance.remainingMinutes) fail("PERMISSION_OVER_ALLOWANCE")
            // In advance, or within the policy's hours after the time has passed.
            const now = Date.now()
            const starts = localToInstant(localAt(input.date, startMinutes), company.timezone).getTime()
            const ends = localToInstant(localAt(input.date, endMinutes), company.timezone).getTime()
            if (starts <= now && (balance.afterTheFactHours === 0 || now > ends + balance.afterTheFactHours * 3_600_000)) fail("PERMISSION_TOO_LATE")
            const overlapping = await tx.permissionRequest.findFirst({
                where: { userId, date: wallClock(`${input.date}T00:00:00`), status: { in: ["APPROVED", "PENDING"] }, startMinutes: { lt: endMinutes }, endMinutes: { gt: startMinutes } },
                select: { id: true },
            })
            if (overlapping) fail("PERMISSION_OVERLAPS")
            const created = await tx.permissionRequest.create({
                data: { companyId, userId, date: wallClock(`${input.date}T00:00:00`), type: input.type, startMinutes, endMinutes, minutes, reason: input.reason.trim() },
            })
            // Minutes the next month already spent from what this one would
            // have carried are not this month's to give again (review on #14).
            if ((await balanceIn(tx, companyId, userId, next)).overdrawnMinutes > 0) fail("PERMISSION_OVER_ALLOWANCE")
            await AuditLogService.log("REQUEST_ATTENDANCE_PERMISSION", "PERMISSION_REQUEST", created.id, {
                tx, userId, details: { companyId, date: input.date, type: input.type, minutes, reason: input.reason.trim() },
            })
            return created
        })
        return serializePermission(out)
    }

    static async permissionOf(id: string) {
        return prisma.permissionRequest.findUnique({ where: { id }, include: PERSON })
    }

    /** Withdraws one's own request: while it waits, or before an approved one begins. */
    static async cancelPermission(id: string, userId: string) {
        const out = await prisma.$transaction(async tx => {
            const r = await tx.permissionRequest.findUnique({ where: { id } }) ?? fail("REQUEST_NOT_FOUND")
            if (r.userId !== userId) fail("REQUEST_NOT_FOUND")
            const date = toDateString(r.date)
            await openMonth(tx, r.companyId, monthOf(date))
            if (r.status === "APPROVED") {
                const company = await companyOf(tx, r.companyId)
                if (localToInstant(localAt(date, r.startMinutes), company.timezone).getTime() <= Date.now()) fail("REQUEST_ALREADY_STARTED")
            } else if (r.status !== "PENDING") fail("REQUEST_ALREADY_DECIDED")
            await tx.permissionRequest.update({ where: { id }, data: { status: "CANCELLED" } })
            await AuditLogService.log("CANCEL_ATTENDANCE_PERMISSION", "PERMISSION_REQUEST", id, { tx, userId, details: { companyId: r.companyId, date } })
            return { companyId: r.companyId, date, wasApproved: r.status === "APPROVED" }
        })
        if (out.wasApproved) await recomputeAfter(out.companyId, out.date, [userId])
    }

    /**
     * Approves or rejects a request. An approval checks the allowance again —
     * the policy may have changed since it was asked for — counting only what
     * is already approved, so a request ahead of it in the queue does not hold
     * it up.
     */
    static async decidePermission(id: string, decision: { approve: boolean; reason?: string | null }, reviewerId: string) {
        const out = await prisma.$transaction(async tx => {
            const r = await tx.permissionRequest.findUnique({ where: { id } }) ?? fail("REQUEST_NOT_FOUND")
            if (r.userId === reviewerId) fail("CANNOT_DECIDE_OWN")
            const date = toDateString(r.date)
            await openMonth(tx, r.companyId, monthOf(date))
            if (r.status !== "PENDING") fail("REQUEST_ALREADY_DECIDED")
            if (decision.approve) {
                const balance = await balanceIn(tx, r.companyId, r.userId, date, id)
                if (!balance.enabled) fail("PERMISSION_HOURS_OFF")
                const left = balance.allowanceMinutes + balance.carriedMinutes - balance.approvedMinutes
                if (r.minutes > left) fail("PERMISSION_OVER_ALLOWANCE")
            }
            const status = decision.approve ? "APPROVED" : "REJECTED"
            const rejectionReason = decision.approve ? null : decision.reason?.trim() || null
            await tx.permissionRequest.update({ where: { id }, data: { status, reviewedById: reviewerId, reviewedAt: new Date(), rejectionReason } })
            await AuditLogService.log(decision.approve ? "APPROVE_ATTENDANCE_PERMISSION" : "REJECT_ATTENDANCE_PERMISSION", "PERMISSION_REQUEST", id, {
                tx, ...(await actorOf(tx, reviewerId)), details: { companyId: r.companyId, userId: r.userId, date, minutes: r.minutes, reason: rejectionReason },
            })
            // The person who asked hears either way (§13.4).
            await NotificationService.notify(r.userId, "ATTENDANCE_REQUEST", {
                key: decision.approve ? "notice_att_permission_approved" : "notice_att_permission_rejected",
                params: { date: dayParam(date), start: hhmm(r.startMinutes), end: hhmm(r.endMinutes), reason: reasonParam(rejectionReason) },
            }, id, tx)
            return { companyId: r.companyId, userId: r.userId, date }
        })
        if (decision.approve) await recomputeAfter(out.companyId, out.date, [out.userId])
    }

    static async permissions(companyId: string, query: { status?: string | null; from?: string | null; to?: string | null }, visible: Visibility) {
        const rows = await prisma.permissionRequest.findMany({
            where: {
                companyId,
                ...(query.status ? { status: query.status as any } : {}),
                ...(query.from || query.to ? { date: { ...(query.from ? { gte: wallClock(`${query.from}T00:00:00`) } : {}), ...(query.to ? { lte: wallClock(`${query.to}T00:00:00`) } : {}) } } : {}),
                ...visibleWhere(visible),
            },
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            take: 500,
            include: PERSON,
        })
        return rows.map(serializePermission)
    }

    // --- missing punches ------------------------------------------------------

    /** Reports a punch one forgot: a time that has passed, and why. */
    static async reportMissingPunch(companyId: string, userId: string, input: MissingPunchInput) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.at)) fail("INVALID_DATE")
        const local = `${input.at}:00`
        // A month 13 or a 25th hour is an invalid Date, which cannot be formatted (review on #14).
        if (isNaN(wallClock(local).getTime()) || wallClockText(wallClock(local)) !== local) fail("INVALID_DATE")
        if (!input.reason.trim()) fail("REASON_REQUIRED")
        const date = local.slice(0, 10)
        const out = await prisma.$transaction(async tx => {
            const company = await companyOf(tx, companyId)
            if (localToInstant(local, company.timezone).getTime() > Date.now()) fail("PUNCH_IN_FUTURE")
            // Its own month, and the month before when it is a night's check-out (review on #14).
            await openMonths(tx, companyId, await punchMonths(tx, companyId, userId, local))
            const same = await tx.missingPunchRequest.findFirst({ where: { userId, claimedAt: wallClock(local), status: { in: ["PENDING", "APPROVED"] } }, select: { id: true } })
            if (same) fail("MISSING_PUNCH_ALREADY_REPORTED")
            const created = await tx.missingPunchRequest.create({
                data: { companyId, userId, date: wallClock(`${date}T00:00:00`), claimedAt: wallClock(local), direction: input.direction, reason: input.reason.trim() },
            })
            await AuditLogService.log("REPORT_MISSING_PUNCH", "MISSING_PUNCH_REQUEST", created.id, {
                tx, userId, details: { companyId, at: local, direction: input.direction, reason: input.reason.trim() },
            })
            return created
        })
        return serializeMissing(out)
    }

    static async missingPunchOf(id: string) {
        return prisma.missingPunchRequest.findUnique({ where: { id }, include: PERSON })
    }

    static async cancelMissingPunch(id: string, userId: string) {
        await prisma.$transaction(async tx => {
            const r = await tx.missingPunchRequest.findUnique({ where: { id } }) ?? fail("REQUEST_NOT_FOUND")
            if (r.userId !== userId) fail("REQUEST_NOT_FOUND")
            if (r.status !== "PENDING") fail("REQUEST_ALREADY_DECIDED")
            await tx.missingPunchRequest.update({ where: { id }, data: { status: "CANCELLED" } })
            await AuditLogService.log("CANCEL_MISSING_PUNCH", "MISSING_PUNCH_REQUEST", id, { tx, userId, details: { companyId: r.companyId, at: wallClockText(r.claimedAt) } })
        })
    }

    /** Approving adds the punch, by hand, in the approver's name; rejecting adds nothing. */
    static async decideMissingPunch(id: string, decision: { approve: boolean; reason?: string | null }, reviewerId: string) {
        const out = await prisma.$transaction(async tx => {
            const r = await tx.missingPunchRequest.findUnique({ where: { id } }) ?? fail("REQUEST_NOT_FOUND")
            if (r.userId === reviewerId) fail("CANNOT_DECIDE_OWN")
            const local = wallClockText(r.claimedAt)
            await openMonths(tx, r.companyId, await punchMonths(tx, r.companyId, r.userId, local))
            if (r.status !== "PENDING") fail("REQUEST_ALREADY_DECIDED")
            let punchId: string | null = null
            if (decision.approve) {
                const company = await companyOf(tx, r.companyId)
                punchId = await insertManualPunch(tx, {
                    companyId: r.companyId, timezone: company.timezone, userId: r.userId, local, direction: r.direction,
                    note: r.reason, actorId: reviewerId,
                })
            }
            const rejectionReason = decision.approve ? null : decision.reason?.trim() || null
            await tx.missingPunchRequest.update({
                where: { id },
                data: { status: decision.approve ? "APPROVED" : "REJECTED", punchId, reviewedById: reviewerId, reviewedAt: new Date(), rejectionReason },
            })
            await AuditLogService.log(decision.approve ? "APPROVE_MISSING_PUNCH" : "REJECT_MISSING_PUNCH", "MISSING_PUNCH_REQUEST", id, {
                tx, ...(await actorOf(tx, reviewerId)), details: { companyId: r.companyId, userId: r.userId, at: local, reason: rejectionReason },
            })
            await NotificationService.notify(r.userId, "ATTENDANCE_REQUEST", {
                key: decision.approve ? "notice_att_missing_approved" : "notice_att_missing_rejected",
                params: { date: dayParam(local.slice(0, 10)), time: local.slice(11, 16), reason: reasonParam(rejectionReason) },
            }, id, tx)
            return { companyId: r.companyId, userId: r.userId, date: local.slice(0, 10) }
        })
        // From the day before: a punch after midnight may close the night before's shift.
        if (decision.approve) await recomputeAfter(out.companyId, addDays(out.date, -1), [out.userId])
    }

    static async missingPunches(companyId: string, query: { status?: string | null }, visible: Visibility) {
        const rows = await prisma.missingPunchRequest.findMany({
            where: { companyId, ...(query.status ? { status: query.status as any } : {}), ...visibleWhere(visible) },
            orderBy: [{ claimedAt: "desc" }],
            take: 500,
            include: PERSON,
        })
        return rows.map(serializeMissing)
    }

    // --- overtime ---------------------------------------------------------------

    /**
     * Decides one person's overtime on one date: after the fact, for a day
     * the engine holds as waiting, or ahead of it. Deciding again replaces the
     * decision. An approval with no minutes approves all that day's overtime.
     */
    static async decideOvertime(companyId: string, input: OvertimeInput, deciderId: string) {
        if (!isDateString(input.date)) fail("INVALID_DATE")
        if (input.userId === deciderId) fail("CANNOT_DECIDE_OWN")
        const out = await prisma.$transaction(async tx => {
            const person = await tx.user.findFirst({ where: { id: input.userId, companyId, status: { not: "DELETED" } }, select: { id: true } })
            if (!person) fail("USER_NOT_FOUND")
            await openMonth(tx, companyId, monthOf(input.date))
            const policy = policyOn(await AttendancePolicyService.versions(companyId), input.date)
            if (!policy?.body.overtime.enabled) fail("OVERTIME_OFF")
            if (!policy.body.overtime.requiresApproval) fail("OVERTIME_NEEDS_NO_APPROVAL")
            let minutes = 0
            if (input.status === "APPROVED") {
                const day = await tx.attendanceDay.findUnique({
                    where: { companyId_userId_date: { companyId, userId: input.userId, date: wallClock(`${input.date}T00:00:00`) } },
                    select: { overtimeMinutes: true },
                })
                minutes = input.minutes ?? day?.overtimeMinutes ?? 0
                if (minutes < 1 || minutes > 1440) fail("OVERTIME_MINUTES_REQUIRED")
            }
            const note = input.note?.trim() || null
            const saved = await tx.overtimeApproval.upsert({
                where: { userId_date: { userId: input.userId, date: wallClock(`${input.date}T00:00:00`) } },
                create: { companyId, userId: input.userId, date: wallClock(`${input.date}T00:00:00`), status: input.status, approvedMinutes: minutes, note, decidedById: deciderId },
                update: { status: input.status, approvedMinutes: minutes, note, decidedById: deciderId, decidedAt: new Date() },
            })
            await AuditLogService.log("DECIDE_ATTENDANCE_OVERTIME", "OVERTIME_APPROVAL", saved.id, {
                tx, ...(await actorOf(tx, deciderId)), details: { companyId, userId: input.userId, date: input.date, status: input.status, minutes, note },
            })
            await NotificationService.notify(input.userId, "ATTENDANCE_REQUEST", {
                key: input.status === "APPROVED" ? "notice_att_overtime_approved" : "notice_att_overtime_rejected",
                params: { date: dayParam(input.date), minutes, reason: reasonParam(note) },
            }, saved.id, tx)
            return saved
        })
        await recomputeAfter(companyId, input.date, [input.userId])
        return serializeDecision(out)
    }

    static async decisionOf(id: string) {
        return prisma.overtimeApproval.findUnique({ where: { id }, include: PERSON })
    }

    /** Takes a decision back: the day's overtime waits again. */
    static async withdrawOvertime(id: string, actorId: string) {
        const out = await prisma.$transaction(async tx => {
            const d = await tx.overtimeApproval.findUnique({ where: { id } }) ?? fail("DECISION_NOT_FOUND")
            if (d.userId === actorId) fail("CANNOT_DECIDE_OWN")
            const date = toDateString(d.date)
            await openMonth(tx, d.companyId, monthOf(date))
            await tx.overtimeApproval.delete({ where: { id } })
            await AuditLogService.log("WITHDRAW_OVERTIME_DECISION", "OVERTIME_APPROVAL", id, {
                tx, ...(await actorOf(tx, actorId)), details: { companyId: d.companyId, userId: d.userId, date },
            })
            return { companyId: d.companyId, userId: d.userId, date }
        })
        await recomputeAfter(out.companyId, out.date, [out.userId])
    }

    /** Days whose overtime waits for a decision, and decisions made, for the people the viewer sees. */
    static async overtime(companyId: string, query: { from: string; to: string }, visible: Visibility) {
        const range = { gte: wallClock(`${query.from}T00:00:00`), lte: wallClock(`${query.to}T00:00:00`) }
        const [waiting, decisions] = await Promise.all([
            prisma.attendanceDay.findMany({
                where: { companyId, overtimeStatus: "PENDING", date: range, ...visibleWhere(visible) },
                orderBy: [{ date: "desc" }, { userId: "asc" }],
                take: 500,
                select: { userId: true, date: true, status: true, overtimeMinutes: true, firstInAt: true, lastOutAt: true, ...PERSON },
            }),
            prisma.overtimeApproval.findMany({
                where: { companyId, date: range, ...visibleWhere(visible) },
                orderBy: [{ date: "desc" }],
                take: 500,
                include: PERSON,
            }),
        ])
        return {
            waiting: waiting.map(({ user, date, firstInAt, lastOutAt, ...d }) => ({
                ...d, date: toDateString(date), name: nameOf(user), teamLeaderId: user.teamLeaderId,
                firstIn: firstInAt ? wallClockText(firstInAt) : null, lastOut: lastOutAt ? wallClockText(lastOutAt) : null,
            })),
            decisions: decisions.map(serializeDecision),
        }
    }

    /** Today in the company's calendar, for screens that default to it. */
    static async todayIn(companyId: string) {
        return AttendanceCalendarService.today(companyId)
    }
}

type WithPerson = { user?: { firstName: string; lastName: string; teamLeaderId: string | null } }

function serializePermission<T extends { date: Date; startMinutes: number; endMinutes: number } & WithPerson>({ user, date, ...r }: T) {
    return {
        ...r, date: toDateString(date), start: hhmm(r.startMinutes), end: hhmm(r.endMinutes),
        ...(user ? { name: nameOf(user), teamLeaderId: user.teamLeaderId } : {}),
    }
}

function serializeMissing<T extends { date: Date; claimedAt: Date } & WithPerson>({ user, date, claimedAt, ...r }: T) {
    return { ...r, date: toDateString(date), at: wallClockText(claimedAt).slice(0, 16), ...(user ? { name: nameOf(user), teamLeaderId: user.teamLeaderId } : {}) }
}

function serializeDecision<T extends { date: Date } & WithPerson>({ user, date, ...r }: T) {
    return { ...r, date: toDateString(date), ...(user ? { name: nameOf(user), teamLeaderId: user.teamLeaderId } : {}) }
}
