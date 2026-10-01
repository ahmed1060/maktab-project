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
