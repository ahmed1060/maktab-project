import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { calendarDateStr } from "@/lib/time"
import { addDays, expectedDay, observedHolidays, scheduleIdOn, toDateString, versionOn, companyWeekOn, type ExpectedDay, type Schedule } from "@/lib/attendance/calendar"
import { policyOn, type PolicyBody } from "@/lib/attendance/policy"
import { assignPunches, measureDay, priceMonth, paidMinutesOf, type EnginePunch, type PricingInput } from "@/lib/attendance/engine"
import { localToInstant } from "@/lib/attendance/punch-import"
import { employmentSpans, suspensionSpans } from "@/lib/employment"
import { rateAt } from "@/lib/salary-history"
import { daysInMonth, toMinor } from "@/lib/payroll"
import { SCHEDULE_INCLUDE, serializeSchedule } from "./attendance-calendar.service"
import { AttendancePolicyService } from "./attendance-policy.service"
import { lockMonths, lockedMonths } from "./attendance-lock"
import { NotificationService } from "./notification.service"

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

/**
 * How recent a day must be for its becoming absent or incomplete to be told
 * to the person (§13.4): yesterday's, and a weekend's worth before it — not
 * the days of a month imported or rebuilt long after.
 */
export const NOTIFY_RECENT_DAYS = 3

/** The most days one list returns; the route asks for one more, to know it stopped short. */
export const DAY_LIST_LIMIT = 3000

export type RecomputeResult = { month: string; locked: boolean; derived: number; written: number; removed: number; discrepancies?: number }

/** One day as derived: the row recomputeMonth stores, and the simulator compares. */
type DerivedDay = {
    userId: string; date: string; row: Omit<Prisma.AttendanceDayUncheckedCreateInput, "companyId" | "userId" | "date" | "inputsHash">; inputsHash: string
    deductionDays: number; deductionMinor: number; overtimeMinor: number
}

/**
 * Derives a month's days for a company — everyone, or only these people —
 * and writes nothing. With a draft policy, every day is priced under it
 * instead of the versions in force.
 */
async function deriveMonth(
    tx: Prisma.TransactionClient, companyId: string, month: string, tz: string, today: string,
    userIds?: readonly string[], draft?: PolicyBody,
): Promise<{ from: string; through: string; days: DerivedDay[] }> {
    const first = await tx.attendancePunch.findFirst({
        where: { companyId, status: "ACCEPTED", voidedAt: null }, orderBy: { punchAtLocal: "asc" }, select: { punchAtLocal: true },
    })
    const from = [`${month}-01`, first ? wallClockText(first.punchAtLocal).slice(0, 10) : "9999-12-31"].sort()[1]
    const through = [monthEnd(month), addDays(today, -1)].sort()[0]
    const scope = userIds ? { userId: { in: [...userIds] } } : {}

    if (from > through) return { from, through, days: [] }

    // A day either side, for night shifts that start before the month or end after it.
    const loadFrom = addDays(from, -1), loadTo = addDays(through, 1)
    const [schedules, assignments, defaults, people, central, exclusions, own, punches, leave, permissions, decisions, excuses] = await Promise.all([
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
            select: { userId: true, date: true, type: true, startMinutes: true, endMinutes: true },
        }),
        tx.overtimeApproval.findMany({
            where: { companyId, ...scope, date: { gte: wallClock(`${from}T00:00:00`), lte: wallClock(`${through}T00:00:00`) } },
            select: { userId: true, date: true, status: true, approvedMinutes: true },
        }),
        // What somebody excused on the exceptions screen (§13.1).
        tx.attendanceDayDecision.findMany({
            where: { companyId, outcome: "EXCUSED", ...scope, date: { gte: wallClock(`${from}T00:00:00`), lte: wallClock(`${through}T00:00:00`) } },
            select: { userId: true, date: true, subject: true },
        }),
    ])
    // A draft (the simulator, §6.7) stands in for every version.
    const policies = draft ? [{ id: "draft", effectiveFrom: "0000-01-01", body: draft }] : await AttendancePolicyService.versions(companyId)

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

    const out: DerivedDay[] = []
    const excusedOn = (userId: string, day: string) => {
        const mine = excuses.filter(x => x.userId === userId && toDateString(x.date) === day).map(x => x.subject)
        return mine.length === 0 ? undefined : { lateness: mine.includes("LATENESS"), earlyLeave: mine.includes("EARLY_LEAVE"), absence: mine.includes("ABSENCE") }
    }
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
            const day = measureDay({
                date, expected: plan.expected, punches: grouped.get(date) ?? [],
                onLeave: leaveDays.has(date), suspended: suspended.some(covers),
                permissions: permissions.filter(p => p.userId === person.id && toDateString(p.date) === date),
                excused: excusedOn(person.id, date),
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
                    excusedAbsence: d.excusedAbsence,
                    minor: d.deductionParts,
                    holiday: e.kind === "HOLIDAY" ? e.holiday.name : null,
                } as Prisma.InputJsonValue,
            }
            out.push({
                userId: person.id, date: d.date, row, inputsHash: hashOf({ ...row, deductionDays: d.deductionDays }),
                deductionDays: d.deductionDays, deductionMinor: d.deductionMinor, overtimeMinor: d.overtimeMinor,
            })
        }
    }
    return { from, through, days: out }
}

/**
 * A month whose payroll is approved, derived again and set beside what was
 * paid (§12.3): every day whose money would now differ is recorded — opened,
 * kept current, reopened if it changes again after being settled — and a day
 * that has come back to what was paid closes its record. Nothing paid is
 * rewritten. Only for a month whose payslips carried attendance: otherwise
 * attendance took nothing from anybody, and there is nothing to settle.
 */
async function recordDiscrepancies(tx: Prisma.TransactionClient, companyId: string, month: string, tz: string, today: string, userIds?: readonly string[]): Promise<number> {
    // Whether this month's payslips carried attendance, as approved — not
    // today's setting, which may since have moved.
    const run = await tx.payrollRun.findFirst({
        where: { companyId, year: Number(month.slice(0, 4)), month: Number(month.slice(5, 7)), status: { in: ["APPROVED", "PAID"] }, attendanceIncluded: true },
        select: { id: true },
    })
    if (!run) return 0
    const scope = userIds ? { userId: { in: [...userIds] } } : {}
    const range = { gte: wallClock(`${month}-01T00:00:00`), lte: wallClock(`${monthEnd(month)}T00:00:00`) }
    const [derived, paid, open] = await Promise.all([
        deriveMonth(tx, companyId, month, tz, today, userIds),
        tx.attendanceDay.findMany({ where: { companyId, ...scope, date: range }, select: { userId: true, date: true, status: true, deductionMinor: true, overtimeMinor: true } }),
        tx.attendanceDiscrepancy.findMany({ where: { companyId, ...scope, date: range } }),
    ])
    const now = new Map(derived.days.map(d => [`${d.userId}:${d.date}`, d]))
    const was = new Map(paid.map(d => [`${d.userId}:${toDateString(d.date)}`, d]))
    const recorded = new Map(open.map(d => [`${d.userId}:${toDateString(d.date)}`, d]))
    let differing = 0
    for (const key of new Set([...now.keys(), ...was.keys()])) {
        const [userId, date] = key.split(":")
        const n = now.get(key), w = was.get(key)
        const figures = {
            paidDeductionMinor: w?.deductionMinor ?? 0, paidOvertimeMinor: w?.overtimeMinor ?? 0, paidStatus: w?.status ?? "NONE",
            nowDeductionMinor: n?.deductionMinor ?? 0, nowOvertimeMinor: n?.overtimeMinor ?? 0, nowStatus: n ? String(n.row.status) : null,
        }
        const r = recorded.get(key)
        if (figures.paidDeductionMinor === figures.nowDeductionMinor && figures.paidOvertimeMinor === figures.nowOvertimeMinor) {
            // Back to what was paid: nothing left to settle, unless somebody already did.
            if (r && !r.resolvedAt) await tx.attendanceDiscrepancy.delete({ where: { id: r.id } })
            continue
        }
        differing += 1
        if (r && r.nowDeductionMinor === figures.nowDeductionMinor && r.nowOvertimeMinor === figures.nowOvertimeMinor) continue
        await tx.attendanceDiscrepancy.upsert({
            where: { userId_date: { userId, date: wallClock(`${date}T00:00:00`) } },
            create: { companyId, userId, date: wallClock(`${date}T00:00:00`), payrollRunId: run.id, ...figures },
            // Changed again after being settled: open again, with the new figures.
            update: { ...figures, resolvedAt: null, resolvedById: null, resolution: null },
        })
    }
    return differing
}

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
            if ((await lockedMonths(tx, companyId, [month])).size > 0) {
                // Its days stay as they were paid; what has changed since is
                // recorded for an adjustment instead (§12.3).
                const discrepancies = await recordDiscrepancies(tx, companyId, month, tz, today, userIds)
                return { ...result, locked: true, discrepancies }
            }
            return this.recomputeMonthIn(tx, companyId, month, tz, today, userIds)
        }, { timeout: 120_000 })
    }

    /**
     * Rebuilds one month's days inside a transaction that already holds the
     * month's lock and knows the month is open — payroll approval's, which
     * recomputes as its last word before the month freezes (§12.1).
     */
    static async recomputeMonthIn(tx: Prisma.TransactionClient, companyId: string, month: string, tz: string, today: string, userIds?: readonly string[]): Promise<RecomputeResult> {
        const result: RecomputeResult = { month, locked: false, derived: 0, written: 0, removed: 0 }
        {
            const derived = await deriveMonth(tx, companyId, month, tz, today, userIds)
            const scope = userIds ? { userId: { in: [...userIds] } } : {}
            const existing = await tx.attendanceDay.findMany({
                where: { companyId, ...scope, date: { gte: wallClock(`${month}-01T00:00:00`), lte: wallClock(`${monthEnd(month)}T00:00:00`) } },
                select: { id: true, userId: true, date: true, status: true, inputsHash: true, lockedByPayrollRunId: true },
            })
            const stored = new Map(existing.map(e => [`${e.userId}:${toDateString(e.date)}`, e]))
            const keep = new Set<string>()
            const recent = addDays(today, -NOTIFY_RECENT_DAYS)
            for (const d of derived.days) {
                const key = `${d.userId}:${d.date}`
                keep.add(key)
                result.derived += 1
                const was = stored.get(key)
                if (was?.lockedByPayrollRunId || was?.inputsHash === d.inputsHash) continue
                await tx.attendanceDay.upsert({
                    where: { companyId_userId_date: { companyId, userId: d.userId, date: wallClock(`${d.date}T00:00:00`) } },
                    create: { companyId, userId: d.userId, date: wallClock(`${d.date}T00:00:00`), ...d.row, inputsHash: d.inputsHash },
                    update: { ...d.row, inputsHash: d.inputsHash, derivedAt: new Date() },
                })
                result.written += 1
                // A recent day that has just become absent or incomplete is told
                // to the person, once: a rebuild that finds it so already says nothing (§13.4).
                const status = d.row.status as string
                if ((status === "ABSENT" || status === "INCOMPLETE") && was?.status !== status && d.date >= recent) {
                    await NotificationService.notify(d.userId, "ATTENDANCE_DAY", {
                        key: status === "ABSENT" ? "notice_att_day_absent" : "notice_att_day_incomplete",
                        params: { date: { date: `${d.date}T00:00:00.000Z` } },
                    }, undefined, tx)
                }
            }

            // Days no longer derived — before the first punch, outside employment — go.
            const stale = existing.filter(e => !keep.has(`${e.userId}:${toDateString(e.date)}`) && !e.lockedByPayrollRunId).map(e => e.id)
            if (stale.length > 0) result.removed = (await tx.attendanceDay.deleteMany({ where: { id: { in: stale } } })).count
            return result
        }
    }

    /**
     * The rule simulator (§6.7): "under this rule, that month would have
     * been…". The month's days are derived twice — under the policy versions
     * in force and under the draft, which stands in for all of them — and
     * compared per person: days deducted, the deduction and the overtime pay.
     * Nothing is written, and no lock is taken: it reads, as the days screen
     * does, and a locked month can be simulated like any other.
     */
    static async simulate(companyId: string, month: string, draft: PolicyBody) {
        if (!MONTH.test(month)) throw new Error("INVALID_MONTH")
        const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } })
        if (!company) throw new Error("COMPANY_NOT_FOUND")
        const today = calendarDateStr(new Date(), company.timezone)
        const [current, proposed] = await Promise.all([
            deriveMonth(prisma, companyId, month, company.timezone, today),
            deriveMonth(prisma, companyId, month, company.timezone, today, undefined, draft),
        ])
        type Sum = { deductionDays: number; deductionMinor: number; overtimeMinor: number; days: number }
        const zero = (): Sum => ({ deductionDays: 0, deductionMinor: 0, overtimeMinor: 0, days: 0 })
        const byPerson = new Map<string, { current: Sum; draft: Sum }>()
        const add = (days: DerivedDay[], side: "current" | "draft") => {
            for (const d of days) {
                const entry = byPerson.get(d.userId) ?? { current: zero(), draft: zero() }
                const sum = entry[side]
                sum.deductionDays = Math.round((sum.deductionDays + d.deductionDays) * 10_000) / 10_000
                sum.deductionMinor += d.deductionMinor
                sum.overtimeMinor += d.overtimeMinor
                sum.days += 1
                byPerson.set(d.userId, entry)
            }
        }
        add(current.days, "current")
        add(proposed.days, "draft")
        const names = await prisma.user.findMany({ where: { id: { in: [...byPerson.keys()] } }, select: { id: true, firstName: true, lastName: true } })
        const nameOf = new Map(names.map(u => [u.id, `${u.firstName} ${u.lastName}`.trim()]))
        const people = [...byPerson].map(([userId, v]) => ({ userId, name: nameOf.get(userId) ?? "", ...v }))
            .sort((a, b) => (b.draft.deductionMinor - b.current.deductionMinor) - (a.draft.deductionMinor - a.current.deductionMinor) || a.name.localeCompare(b.name))
        const total = (side: "current" | "draft") => people.reduce((s, p) => ({
            deductionDays: Math.round((s.deductionDays + p[side].deductionDays) * 10_000) / 10_000,
            deductionMinor: s.deductionMinor + p[side].deductionMinor,
            overtimeMinor: s.overtimeMinor + p[side].overtimeMinor,
            days: s.days + p[side].days,
        }), zero())
        return { month, from: current.from, through: current.through, people, totals: { current: total("current"), draft: total("draft") } }
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

