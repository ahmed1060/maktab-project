import { Prisma } from "@prisma/client"
import { addDays } from "@/lib/attendance/calendar"
import { LATE_MARGIN_MINUTES } from "@/lib/attendance/engine"

/**
 * The company-month lock (ATTENDANCE_PLAN.md §12.1). Approving a month's
 * payroll, and every write to that month's attendance — a punch imported,
 * added or withdrawn, a number mapped — take the same transaction-scoped
 * Postgres advisory lock for the company and month before writing. So a punch
 * either lands before the approval or is refused after it; it can never slip
 * in between the approval's check and its commit.
 */

const lockKey = (companyId: string, month: string) => `attendance-month:${companyId}:${month}`

/** Takes the lock for each month, in order, so two writers never wait on each other in a circle. */
export async function lockMonths(tx: Prisma.TransactionClient, companyId: string, months: Iterable<string>) {
    for (const month of [...new Set(months)].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(companyId, month)}))::text`
}

/** Which of these months have an approved or paid payroll run. Read after the lock. */
export async function lockedMonths(tx: Prisma.TransactionClient, companyId: string, months: Iterable<string>): Promise<Set<string>> {
    const wanted = [...new Set(months)]
    if (wanted.length === 0) return new Set()
    const runs = await tx.payrollRun.findMany({
        where: {
            companyId, status: { in: ["APPROVED", "PAID"] },
            OR: wanted.map(m => ({ year: Number(m.slice(0, 4)), month: Number(m.slice(5, 7)) })),
        },
        select: { year: true, month: true },
    })
    return new Set(runs.map(r => `${r.year}-${String(r.month).padStart(2, "0")}`))
}


/**
 * The months one punch at this wall-clock time can change: its own date's,
 * and — on the first of a month — the month before, when the last day's shift,
 * with its late margin, reaches it. A night shift's check-out after midnight
 * belongs to the night it started (lib/attendance/engine.ts assignPunches),
 * so adding or withdrawing it changes a day of the month before; if that
 * month's payroll is approved, the punch must be refused rather than land
 * where no recompute will ever count it (review on #14).
 *
 * Read from the day already derived for the day before: a day in an approved
 * month is never rewritten, so its hours are the ones it was paid on.
 */
export async function punchMonths(tx: Prisma.TransactionClient, companyId: string, userId: string, local: string): Promise<string[]> {
    const date = local.slice(0, 10)
    const before = addDays(date, -1)
    const months = [date.slice(0, 7)]
    if (before.slice(0, 7) === months[0]) return months
    const day = await tx.attendanceDay.findUnique({
        where: { companyId_userId_date: { companyId, userId, date: new Date(`${before}T00:00:00Z`) } },
        select: { expectedEndMinutes: true },
    })
    const minutesAfterBefore = 1440 + Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))
    if (day?.expectedEndMinutes != null && minutesAfterBefore <= day.expectedEndMinutes + LATE_MARGIN_MINUTES) months.push(before.slice(0, 7))
    return months
}
