import { Prisma } from "@prisma/client"
import type { AttendanceMoney } from "@/lib/register"

/**
 * Attendance at the payroll boundary (ATTENDANCE_PLAN.md §12).
 *
 * Before a company's chosen month, attendance is measured and priced but
 * reaches nobody's pay: the register shows what it would have cost — the dry
 * run (§20, Phase 1). From that month, its money is a line on the payslip,
 * and approval writes it down as entries, reconciled, never appended.
 */

type Db = Prisma.TransactionClient

const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`
const monthStart = (year: number, month: number) => new Date(`${monthKey(year, month)}-01T00:00:00Z`)
const nextMonthStart = (year: number, month: number) => (month === 12 ? monthStart(year + 1, 1) : monthStart(year, month + 1))

/** Whether this month's attendance reaches payroll: on or after the company's chosen month. */
export function attendanceReaches(from: Date | null, year: number, month: number): boolean {
    return from !== null && monthStart(year, month).getTime() >= from.getTime()
}

/**
 * Each person's attendance money for a month, from the days as derived: the
 * sum of each day's priced parts (§12.2). A day priced before the parts were
 * kept is split by the day-fractions each cause charged — and approval
 * rebuilds every day first, so what is approved is always exact.
 */
export async function attendanceMoney(db: Db, companyId: string, year: number, month: number): Promise<Map<string, AttendanceMoney>> {
    const days = await db.attendanceDay.findMany({
        where: { companyId, date: { gte: monthStart(year, month), lt: nextMonthStart(year, month) } },
        select: { userId: true, status: true, deductionMinor: true, overtimeMinor: true, breakdown: true },
    })
    const out = new Map<string, AttendanceMoney>()
    for (const d of days) {
        const sum = out.get(d.userId) ?? { lateness: 0, earlyLeave: 0, absence: 0, overtime: 0 }
        const b = (d.breakdown ?? {}) as {
            minor?: { lateness: number; earlyLeave: number; absence: number }
            lateness?: { days: number }; earlyLeave?: { days: number }; absenceDays?: number
        }
        if (b.minor) {
            sum.lateness += b.minor.lateness
            sum.earlyLeave += b.minor.earlyLeave
            sum.absence += b.minor.absence
        } else if (d.deductionMinor > 0) {
            // Priced before the parts were kept: split by each cause's share of
            // the day-fractions charged, the remainder to the last, so the
            // parts still add up to the day.
            const late = b.lateness?.days ?? 0, early = b.earlyLeave?.days ?? 0, absent = b.absenceDays ?? 0
            const total = late + early + absent
            if (total <= 0) sum.absence += d.deductionMinor
            else {
                const l = Math.round(d.deductionMinor * late / total), e = Math.round(d.deductionMinor * early / total)
                sum.lateness += l
                sum.earlyLeave += e
                sum.absence += d.deductionMinor - l - e
            }
        }
        sum.overtime += d.overtimeMinor
        out.set(d.userId, sum)
    }
    return out
}

/** A day of the month that payroll waits on (§6.9, decision 14, PR 276). */
export type DayToSettle = {
    userId: string; name: string; date: string; status: "INCOMPLETE" | "TO_CONFIRM"
    firstIn: string | null; lastOut: string | null
}
export type ToSettle = {
    count: number
    /** How many of each kind, so what's left over past the list opens its own (review on PR 276). */
    byStatus: { INCOMPLETE: number; TO_CONFIRM: number }
    days: DayToSettle[]
    /** The month's requests not yet decided: a warning, not a reason to wait (decision 24). */
    requests: { permissions: number; missing: number; overtime: number }
}

/**
 * What a month's payroll waits on, for the people on its register (§6.9,
 * §12.1, decisions 14 and 24, PR 276): its days still incomplete or a
 * departure to confirm, the first `take` of them listed, by date; and how
 * many of its requests are not yet decided. From the days as stored, so
 * inside approval's transaction it reads the month's last recompute.
 */
export async function daysToSettle(db: Db, companyId: string, year: number, month: number, userIds: string[], take = 50): Promise<ToSettle> {
    const date = { gte: monthStart(year, month), lt: nextMonthStart(year, month) }
    const people = { companyId, userId: { in: userIds }, date }
    const waiting = { ...people, status: { in: ["INCOMPLETE", "TO_CONFIRM"] as ("INCOMPLETE" | "TO_CONFIRM")[] } }
    // One after another: inside approval's transaction, two queries at once
    // on one connection is what #268 took out.
    const byStatus = {
        INCOMPLETE: await db.attendanceDay.count({ where: { ...people, status: "INCOMPLETE" } }),
        TO_CONFIRM: await db.attendanceDay.count({ where: { ...people, status: "TO_CONFIRM" } }),
    }
    const count = byStatus.INCOMPLETE + byStatus.TO_CONFIRM
    const days = count === 0 ? [] : await db.attendanceDay.findMany({
        where: waiting,
        orderBy: [{ date: "asc" }, { user: { firstName: "asc" } }, { userId: "asc" }],
        take,
        select: { userId: true, date: true, status: true, firstInAt: true, lastOutAt: true, user: { select: { firstName: true, lastName: true } } },
    })
    const permissions = await db.permissionRequest.count({ where: { ...people, status: "PENDING" } })
    const missing = await db.missingPunchRequest.count({ where: { ...people, status: "PENDING" } })
    const overtime = await db.attendanceDay.count({ where: { ...people, overtimeStatus: "PENDING" } })
    return {
        count,
        byStatus,
        days: days.map(d => ({
            userId: d.userId,
            name: [d.user.firstName, d.user.lastName].filter(Boolean).join(" "),
            date: d.date.toISOString().slice(0, 10),
            status: d.status as DayToSettle["status"],
            firstIn: d.firstInAt?.toISOString() ?? null,
            lastOut: d.lastOutAt?.toISOString() ?? null,
        })),
        requests: { permissions, missing, overtime },
    }
}

/** Whose days a refusal names: each once, in the order listed. */
export const namesOf = (days: DayToSettle[]) => days.map(d => d.name).filter((n, i, all) => all.indexOf(n) === i)

/** What a refusal carries of what waits: how many, whose, of each kind, and the first of them. */
export const waitingOf = (t: ToSettle) => ({ count: t.count, names: namesOf(t.days), byStatus: t.byStatus, days: t.days })

/**
 * Overtime still waiting for a decision when the month's payroll is approved
 * is rejected (§12.1): once paid, nobody can approve it into that month.
 */
export async function rejectPendingOvertime(tx: Db, companyId: string, year: number, month: number, actorId: string) {
    const waiting = await tx.attendanceDay.findMany({
        where: { companyId, overtimeStatus: "PENDING", date: { gte: monthStart(year, month), lt: nextMonthStart(year, month) } },
        select: { userId: true, date: true },
    })
    for (const d of waiting) {
        await tx.overtimeApproval.upsert({
            where: { userId_date: { userId: d.userId, date: d.date } },
            create: { companyId, userId: d.userId, date: d.date, status: "REJECTED", approvedMinutes: 0, note: "Not approved before payroll", decidedById: actorId },
            update: {},
        })
    }
    return waiting.length
}

const CATEGORIES = [
    ["LATENESS", "lateness"], ["EARLY_LEAVE", "earlyLeave"], ["ABSENCE", "absence"], ["OVERTIME", "overtime"],
] as const

/**
 * Writes what the approved payslips carry as attendance entries (§12.2), one
 * per person, month and category: replaced where it differs, left where it
 * matches, removed where it no longer applies. Approving again can therefore
 * never count twice.
 */
export async function reconcileEntries(
    tx: Db, companyId: string, year: number, month: number, payrollRunId: string,
    people: { userId: string; excluded: boolean; attendance?: AttendanceMoney }[],
) {
    const existing = await tx.attendancePayrollEntry.findMany({ where: { companyId, year, month } })
    const keep = new Set<string>()
    let written = 0
    for (const person of people) {
        if (person.excluded || !person.attendance) continue
        for (const [category, field] of CATEGORIES) {
            const amountMinor = person.attendance[field]
            if (amountMinor <= 0) continue
            keep.add(`${person.userId}:${category}`)
            const was = existing.find(e => e.userId === person.userId && e.category === category)
            if (was && was.amountMinor === amountMinor && was.payrollRunId === payrollRunId) continue
            await tx.attendancePayrollEntry.upsert({
                where: { companyId_userId_year_month_category: { companyId, userId: person.userId, year, month, category } },
                create: { companyId, userId: person.userId, year, month, category, amountMinor, payrollRunId },
                update: { amountMinor, payrollRunId },
            })
            written += 1
        }
    }
    const stale = existing.filter(e => !keep.has(`${e.userId}:${e.category}`)).map(e => e.id)
    if (stale.length > 0) await tx.attendancePayrollEntry.deleteMany({ where: { id: { in: stale } } })
    return { written, removed: stale.length }
}

/** Stamps the month's days with the run that paid them: the record of which approval froze each. */
export async function stampDays(tx: Db, companyId: string, year: number, month: number, payrollRunId: string) {
    return (await tx.attendanceDay.updateMany({
        where: { companyId, lockedByPayrollRunId: null, date: { gte: monthStart(year, month), lt: nextMonthStart(year, month) } },
        data: { lockedByPayrollRunId: payrollRunId },
    })).count
}

export { monthKey }
