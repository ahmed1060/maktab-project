import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { calendarDateStr } from "@/lib/time"
import { addDays, expectedDay, observedHolidays, scheduleIdOn, toDateString, versionOn, companyWeekOn, type ExpectedDay, type Schedule } from "@/lib/attendance/calendar"
import { policyOn } from "@/lib/attendance/policy"
import { assignPunches, measureDay, priceMonth, paidMinutesOf, type EnginePunch, type PricingInput } from "@/lib/attendance/engine"
import { localToInstant } from "@/lib/attendance/punch-import"
import { employmentSpans, suspensionSpans } from "@/lib/employment"
import { rateAt } from "@/lib/salary-history"
import { daysInMonth, toMinor } from "@/lib/payroll"
import { SCHEDULE_INCLUDE, serializeSchedule } from "./attendance-calendar.service"
import { AttendancePolicyService } from "./attendance-policy.service"
import { lockMonths, lockedMonths } from "./attendance-lock"

/**
 * Rebuilding attendance days (ATTENDANCE_PLAN.md §11). Pure and idempotent:
 * the same inputs give the same days, so it runs whenever an input changes —
 * a punch, the calendar, the policy, a leave decision — and nightly as a
 * reconciliation. A day whose inputs did not change is not written again
 * (inputsHash); a day in a month whose payroll is approved or paid is never
 * rewritten (§12).
 *
 * Days are derived from the company's first punch on, never before it: a
 * company that switches attendance on in October has no September punches,
 * and calling every September working day an absence would be inventing
 * deductions for a month nobody was measured in. Nor are today's or later
 * days derived — a day is measured once it is over.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const wallClock = (local: string) => new Date(`${local}Z`)
const wallClockText = (d: Date) => d.toISOString().slice(0, 19)
const monthEnd = (month: string) => `${month}-${String(daysInMonth(Number(month.slice(0, 4)), Number(month.slice(5, 7)))).padStart(2, "0")}`

/** The months from one date's month to another's, inclusive. */
export function monthsBetween(from: string, to: string): string[] {
    const out: string[] = []
    let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]
    const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))]
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, "0")}`)
        m += 1
        if (m > 12) { m = 1; y += 1 }
    }
    return out
}

function hashOf(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

/** The most days one list returns; the route asks for one more, to know it stopped short. */
export const DAY_LIST_LIMIT = 3000

export type RecomputeResult = { month: string; locked: boolean; derived: number; written: number; removed: number }

export class AttendanceEngineService {
    /**
     * Rebuilds one month's days for a company — everyone, or only these
     * people. Takes the company-month lock first (§12.1), so it cannot cross
     * the payroll approval that freezes the month, nor another recompute.
     */
    static async recomputeMonth(companyId: string, month: string, userIds?: readonly string[]): Promise<RecomputeResult> {
        if (!MONTH.test(month)) throw new Error("INVALID_MONTH")
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
        if (!company) throw new Error("COMPANY_NOT_FOUND")
        const tz = company.timezone
        const today = calendarDateStr(new Date(), tz)
        const result: RecomputeResult = { month, locked: false, derived: 0, written: 0, removed: 0 }

        return prisma.$transaction(async tx => {
            await lockMonths(tx, companyId, [month])
            if ((await lockedMonths(tx, companyId, [month])).size > 0) return { ...result, locked: true }

            const first = await tx.attendancePunch.findFirst({
                where: { companyId, status: "ACCEPTED", voidedAt: null }, orderBy: { punchAtLocal: "asc" }, select: { punchAtLocal: true },
            })
            const from = [`${month}-01`, first ? wallClockText(first.punchAtLocal).slice(0, 10) : "9999-12-31"].sort()[1]
            const through = [monthEnd(month), addDays(today, -1)].sort()[0]
            const scope = userIds ? { userId: { in: [...userIds] } } : {}

            // Nothing to derive: drop whatever an earlier run left, unless locked.
            if (from > through) {
                const gone = await tx.attendanceDay.deleteMany({
                    where: { companyId, ...scope, date: { gte: wallClock(`${month}-01T00:00:00`), lte: wallClock(`${monthEnd(month)}T00:00:00`) }, lockedByPayrollRunId: null },
                })
                return { ...result, removed: gone.count }
            }

            // A day either side, for night shifts that start before the month or end after it.
            const loadFrom = addDays(from, -1), loadTo = addDays(through, 1)
            const [schedules, assignments, defaults, people, central, exclusions, own, punches, leave, permissions, decisions] = await Promise.all([
                tx.workSchedule.findMany({ where: { companyId }, include: SCHEDULE_INCLUDE }),
                tx.userSchedule.findMany({ where: { schedule: { companyId }, ...scope }, select: { userId: true, scheduleId: true, effectiveFrom: true } }),
                tx.scheduleDefault.findMany({ where: { companyId }, select: { scheduleId: true, effectiveFrom: true } }),
                tx.user.findMany({
                    where: { companyId, status: { not: "DELETED" }, ...(userIds ? { id: { in: [...userIds] } } : {}) },
                    select: {
                        id: true,
                        EmploymentEvent: { select: { type: true, effectiveFrom: true, deductSuspension: true, createdAt: true } },
                        SalaryChange: { select: { monthlyAmount: true, effectiveFrom: true, createdAt: true } },
                    },
                }),
                tx.publicHoliday.findMany({ where: { country: "EG", date: { gte: wallClock(`${loadFrom}T00:00:00`), lte: wallClock(`${loadTo}T00:00:00`) } } }),
                tx.companyHolidayExclusion.findMany({ where: { companyId }, select: { publicHolidayId: true } }),
                tx.companyHoliday.findMany({ where: { companyId, date: { gte: wallClock(`${loadFrom}T00:00:00`), lte: wallClock(`${loadTo}T00:00:00`) } } }),
                tx.attendancePunch.findMany({
                    where: {
                        companyId, status: "ACCEPTED", voidedAt: null, userId: { not: null }, ...scope,
                        punchAtLocal: { gte: wallClock(`${loadFrom}T00:00:00`), lt: wallClock(`${addDays(loadTo, 1)}T00:00:00`) },
                    },
                    select: { id: true, userId: true, punchAtLocal: true, direction: true },
                }),
                tx.dayOffRequest.findMany({
                    where: { status: "APPROVED", user: { companyId }, ...scope, date: { lte: wallClock(`${loadTo}T23:59:59`) } },
                    select: { userId: true, date: true, endDate: true },
                }),
                // Approved permission hours excuse lateness or early leave (§6.6).
                tx.permissionRequest.findMany({
                    where: { companyId, status: "APPROVED", ...scope, date: { gte: wallClock(`${from}T00:00:00`), lte: wallClock(`${through}T00:00:00`) } },
                    select: { userId: true, date: true, type: true, minutes: true },
                }),
                tx.overtimeApproval.findMany({
                    where: { companyId, ...scope, date: { gte: wallClock(`${from}T00:00:00`), lte: wallClock(`${through}T00:00:00`) } },
                    select: { userId: true, date: true, status: true, approvedMinutes: true },
                }),
            ])
            const policies = await AttendancePolicyService.versions(companyId)

            const bySchedule = new Map<string, Schedule>(schedules.map(s => [s.id, serializeSchedule(s)]))
            const defaultChanges = defaults.map(d => ({ scheduleId: d.scheduleId, effectiveFrom: toDateString(d.effectiveFrom) }))
            const weeks = policies.map(p => ({ effectiveFrom: p.effectiveFrom, workWeek: p.body.workWeek }))
            const holidays = observedHolidays(
                central.map(h => ({ id: h.id, date: toDateString(h.date), name: h.name })),
                new Set(exclusions.map(e => e.publicHolidayId)),
                own.map(h => ({ id: h.id, date: toDateString(h.date), name: h.name, isPaid: h.isPaid })),
                loadFrom, loadTo,
            )
            const dates: string[] = []
            for (let d = loadFrom; d <= loadTo; d = addDays(d, 1)) dates.push(d)

            const existing = await tx.attendanceDay.findMany({
                where: { companyId, ...scope, date: { gte: wallClock(`${month}-01T00:00:00`), lte: wallClock(`${monthEnd(month)}T00:00:00`) } },
                select: { id: true, userId: true, date: true, inputsHash: true, lockedByPayrollRunId: true },
            })
            const stored = new Map(existing.map(e => [`${e.userId}:${toDateString(e.date)}`, e]))
            const keep = new Set<string>()

            for (const person of people) {
                const mine = assignments.filter(a => a.userId === person.id).map(a => ({ scheduleId: a.scheduleId, effectiveFrom: toDateString(a.effectiveFrom) }))
                const plans = new Map<string, { expected: ExpectedDay; scheduleId: string | null; schedule: Schedule | null }>()
                for (const date of dates) {
                    const scheduleId = scheduleIdOn(mine, defaultChanges, date)
                    const schedule = scheduleId ? bySchedule.get(scheduleId) ?? null : null
                    plans.set(date, { scheduleId, schedule, expected: expectedDay({ date, schedule, companyWorkWeek: companyWeekOn(weeks, date), holiday: holidays.get(date) ?? null }) })
                }
                const own: EnginePunch[] = punches.filter(p => p.userId === person.id).map(p => ({ id: p.id, at: wallClockText(p.punchAtLocal), direction: p.direction }))
                const grouped = assignPunches(own, new Map([...plans].map(([d, p]) => [d, p.expected])))
                const employed = employmentSpans(person.EmploymentEvent as any)
                const suspended = suspensionSpans(person.EmploymentEvent as any)
                const leaveDays = new Set<string>()
                for (const l of leave.filter(l => l.userId === person.id)) {
                    const start = toDateString(l.date), end = l.endDate ? toDateString(l.endDate) : start
                    for (let d = start; d <= end; d = addDays(d, 1)) leaveDays.add(d)
                }

                const inputs: (PricingInput & { plan: { expected: ExpectedDay; scheduleId: string | null }; policyId: string | null })[] = []
                for (let date = from; date <= through; date = addDays(date, 1)) {
                    const noon = localToInstant(`${date}T12:00:00`, tz)
                    const dayStart = localToInstant(`${date}T00:00:00`, tz)
                    const nextStart = localToInstant(`${addDays(date, 1)}T00:00:00`, tz)
                    // The rules payroll's employment timeline uses (review on
                    // #13): a day employment touches at all is a working day of
                    // theirs, and only a whole day suspended is a suspended day.
                    const touches = (s: { from: Date; to: Date | null }) => s.from < nextStart && (s.to === null || s.to > dayStart)
                    const covers = (s: { from: Date; to: Date | null }) => s.from <= dayStart && (s.to === null || s.to >= nextStart)
                    // Before their first day or after their last, a person has no attendance.
                    if (person.EmploymentEvent.length > 0 && !employed.some(touches)) continue
                    const plan = plans.get(date)!
                        const excused = { late: 0, early: 0 }
                    for (const p of permissions) {
                        if (p.userId !== person.id || toDateString(p.date) !== date) continue
                        if (p.type === "LATE_ARRIVAL") excused.late += p.minutes
                        if (p.type === "EARLY_LEAVE") excused.early += p.minutes
                    }
                    const day = measureDay({
                        date, expected: plan.expected, punches: grouped.get(date) ?? [],
                        onLeave: leaveDays.has(date), suspended: suspended.some(covers), excused,
                    })
                    const decision = decisions.find(o => o.userId === person.id && toDateString(o.date) === date)
                    const policy = policyOn(policies, date)
                    const rate = rateAt(person.SalaryChange as any, noon)
                    const base = plan.schedule ? versionOn(plan.schedule.versions, date) : null
                    inputs.push({
                        day, plan, policyId: policy?.id ?? null,
                        policy: policy?.body ?? null,
                        monthlyMinor: rate ? toMinor(Number(rate.monthlyAmount)) : null,
                        daysInMonth: daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7))),
                        paidMinutes: paidMinutesOf(plan.expected, base),
                        overtimeDecision: decision && decision.status !== "PENDING" && decision.status !== "CANCELLED"
                            ? { status: decision.status, minutes: decision.approvedMinutes } : null,
                    })
                }

                const priced = priceMonth(inputs)
                for (const [i, d] of priced.entries()) {
                    const { plan, policyId } = inputs[i]
                    const e = plan.expected
                    const row = {
                        status: d.status,
                        scheduleId: plan.scheduleId,
                        scheduleVersionId: "versionId" in e ? e.versionId : null,
                        overrideId: e.kind === "WORK" ? e.overrideId : null,
                        policyId,
                        expectedStartMinutes: e.kind === "WORK" ? e.hours.startMinutes : null,
                        expectedEndMinutes: e.kind === "WORK" ? e.hours.endMinutes : null,
                        breakMinutes: e.kind === "WORK" ? e.hours.breakMinutes : null,
                        punchCount: d.punchCount,
                        firstInAt: d.firstIn ? wallClock(d.firstIn) : null,
                        lastOutAt: d.lastOut ? wallClock(d.lastOut) : null,
                        workedMinutes: d.workedMinutes, lateMinutes: d.lateMinutes, earlyLeaveMinutes: d.earlyLeaveMinutes,
                        overtimeMinutes: d.overtimeMinutes, excusedMinutes: d.excusedMinutes,
                        deductionDays: new Prisma.Decimal(d.deductionDays),
                        deductionMinor: d.deductionMinor, overtimeStatus: d.overtimeStatus, overtimeMinor: d.overtimeMinor,
                        breakdown: {
                            lateness: d.lateness, earlyLeave: d.earlyLeave, absenceDays: d.absenceDays, unpriced: d.unpriced,
                            holiday: e.kind === "HOLIDAY" ? e.holiday.name : null,
                        } as Prisma.InputJsonValue,
                    }
                    const inputsHash = hashOf({ ...row, deductionDays: d.deductionDays })
                    const key = `${person.id}:${d.date}`
                    keep.add(key)
                    result.derived += 1
                    const was = stored.get(key)
                    if (was?.lockedByPayrollRunId || was?.inputsHash === inputsHash) continue
                    await tx.attendanceDay.upsert({
                        where: { companyId_userId_date: { companyId, userId: person.id, date: wallClock(`${d.date}T00:00:00`) } },
                        create: { companyId, userId: person.id, date: wallClock(`${d.date}T00:00:00`), ...row, inputsHash },
                        update: { ...row, inputsHash, derivedAt: new Date() },
                    })
                    result.written += 1
                }
            }

            // Days no longer derived — before the first punch, outside employment — go.
            const stale = existing.filter(e => !keep.has(`${e.userId}:${toDateString(e.date)}`) && !e.lockedByPayrollRunId).map(e => e.id)
            if (stale.length > 0) result.removed = (await tx.attendanceDay.deleteMany({ where: { id: { in: stale } } })).count
            return result
        }, { timeout: 120_000 })
    }

    /** Rebuilds every month from a date's month to today's, skipping locked ones. */
    static async recomputeFrom(companyId: string, fromDate: string, userIds?: readonly string[]): Promise<RecomputeResult[]> {
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
        if (!company) return []
        const today = calendarDateStr(new Date(), company.timezone)
        // Nothing older than a year is rebuilt implicitly: a change dated that
        // far back is a correction for somebody to look at, not a cascade.
        const floor = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`
        const start = fromDate < floor ? floor : fromDate
        if (start > today) return []
        const out: RecomputeResult[] = []
        for (const month of monthsBetween(start, today)) out.push(await this.recomputeMonth(companyId, month, userIds))
        return out
    }

    /**
     * After a change to an input: rebuild what it touched, and never let a
     * failure here undo the change itself — the nightly run reconciles.
     */
    static async afterChange(companyId: string, fromDate: string, userIds?: readonly string[]) {
        try {
            await this.recomputeFrom(companyId, fromDate, userIds)
        } catch (error) {
            console.error("[attendance] recompute after change failed", companyId, fromDate, error)
        }
    }

    /**
     * The nightly reconciliation: this month and last, for every company with
     * attendance, and every month a salary or employment change recorded in
     * the last two days reaches back to — those do not always rebuild as they
     * happen (one written inside another change's transaction cannot), and a
     * backdated correction can reach months ago (review on #13). One company
     * failing is recorded and the rest go on (review on #13).
     */
    static async reconcileAll(companyIds: readonly string[]) {
        let months = 0
        const failed: { companyId: string; month: string; error: string }[] = []
        const since = new Date(Date.now() - 2 * 86_400_000)
        for (const companyId of companyIds) {
            try {
                const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
                if (!company) continue
                const today = calendarDateStr(new Date(), company.timezone)
                const [salary, employment] = await Promise.all([
                    prisma.salaryChange.findFirst({ where: { createdAt: { gte: since }, user: { companyId } }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true } }),
                    prisma.employmentEvent.findFirst({ where: { createdAt: { gte: since }, user: { companyId } }, orderBy: { effectiveFrom: "asc" }, select: { effectiveFrom: true } }),
                ])
                const changed = [salary, employment].flatMap(c => (c ? [calendarDateStr(c.effectiveFrom, company.timezone)] : [])).sort()[0]
                const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1)
                const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4, 7)}-01`
                const from = [lastMonth, changed && changed > yearAgo ? changed : changed ? yearAgo : lastMonth].sort()[0]
                for (const month of monthsBetween(from, today)) {
                    try {
                        await this.recomputeMonth(companyId, month)
                        months += 1
                    } catch (error) {
                        failed.push({ companyId, month, error: error instanceof Error ? error.message : String(error) })
                    }
                }
            } catch (error) {
                failed.push({ companyId, month: "", error: error instanceof Error ? error.message : String(error) })
            }
        }
        if (failed.length > 0) console.error("[attendance] reconciliation failures", failed)
        return { companies: companyIds.length, months, failed }
    }

    /** Days between two dates for the people the viewer sees. */
    static async days(companyId: string, query: { from: string; to: string; userId?: string | null }, visible: import("./attendance-punch.service").Visibility, limit = DAY_LIST_LIMIT) {
        const rows = await prisma.attendanceDay.findMany({
            where: {
                companyId,
                date: { gte: wallClock(`${query.from}T00:00:00`), lte: wallClock(`${query.to}T00:00:00`) },
                ...(query.userId ? { userId: query.userId } : {}),
                ...(visible.kind === "TEAM" ? { user: { OR: [{ teamLeaderId: visible.leaderId }, { id: visible.leaderId }] } } : visible.kind === "OWN" ? { userId: visible.userId } : {}),
            },
            // Date, then person: a list cut short always drops the same rows (review on #13).
            orderBy: [{ date: "desc" }, { userId: "asc" }],
            take: limit,
            omit: { inputsHash: true },
            include: { user: { select: { firstName: true, lastName: true, teamLeaderId: true } } },
        })
        return rows.map(({ user, date, firstInAt, lastOutAt, deductionDays, ...r }) => ({
            ...r,
            date: toDateString(date),
            firstIn: firstInAt ? wallClockText(firstInAt) : null,
            lastOut: lastOutAt ? wallClockText(lastOutAt) : null,
            deductionDays: Number(deductionDays),
            name: `${user.firstName} ${user.lastName}`.trim(),
            teamLeaderId: user.teamLeaderId,
        }))
    }
}

