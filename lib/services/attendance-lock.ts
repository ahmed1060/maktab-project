import { Prisma } from "@prisma/client"
import { addDays } from "@/lib/attendance/calendar"
import { EARLY_MARGIN_MINUTES, LATE_MARGIN_MINUTES } from "@/lib/attendance/engine"

/**
 * The company-month lock (ATTENDANCE_PLAN.md §12.1). Approving a month's
 * payroll, and every write to that month's attendance — a punch imported,
 * added or withdrawn, a number mapped — take the same transaction-scoped
 * Postgres advisory lock for the company and month before writing. So a punch
 * either lands before the approval or is refused after it; it can never slip
 * in between the approval's check and its commit.
 */

const lockKey = (companyId: string, month: string) => `attendance-month:${companyId}:${month}`

/**
 * For a transaction that may wait on these locks: an import holds them for
 * as long as its own minute allows, and Prisma's five seconds left any other
 * writer waiting behind it to fail instead of going next (review on #12).
 */
export const LOCK_WAIT = { timeout: 90_000 }

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
 * and the month the shift it belongs to falls in, where that is another. A
 * night shift's check-out after midnight on the 1st belongs to the night
 * before (lib/attendance/engine.ts assignPunches); an early arrival late on a
 * month's last day, to a shift starting just after midnight on the 1st
 * (review on #14). Adding or withdrawing it changes that month's day; if the
 * month's payroll is approved, the punch must be refused rather than land
 * where no recompute will ever count it (review on #14).
 *
 * Which shift, as the engine decides it: of the shifts whose window (an
 * early and a late margin) holds the punch, the nearest, the earlier day on
 * a tie. The day before is read from its derived day, whose hours, in an
 * approved month, are the ones it was paid on; with none derived, from the
 * calendar, as the engine reads it (review on #14). The day itself and the
 * day after, from the calendar: a stored day may be stale (review on #49).
 */
export async function punchMonths(tx: Prisma.TransactionClient, companyId: string, userId: string, local: string): Promise<string[]> {
    return (await punchMonthsOf(tx, companyId, [{ userId, local }]))[0]
}

type Shift = { start: number; end: number }

/**
 * punchMonths for many punches, with one read of the days before and one of
 * the calendar: what a file, a withdrawal or a number mapped brings to the
 * month locks, a terminal agent's batch, and a phone approved with what it
 * held (reviews on #13, #22 and #49). A punch with nobody yet is its own
 * date's only; it reaches another month once it is somebody's. Only punches
 * on a month's first or last day can, so only theirs are read.
 */
export async function punchMonthsOf(tx: Prisma.TransactionClient, companyId: string, punches: readonly { userId: string | null; local: string }[]): Promise<string[][]> {
    const monthOf = (date: string) => date.slice(0, 7)
    const onEdge = (date: string) => monthOf(addDays(date, -1)) !== monthOf(date) || monthOf(addDays(date, 1)) !== monthOf(date)
    const edge = punches.filter(p => p.userId && onEdge(p.local.slice(0, 10)))
    if (edge.length === 0) return punches.map(p => [monthOf(p.local)])
    const users = [...new Set(edge.map(p => p.userId!))]
    const firsts = edge.filter(p => monthOf(addDays(p.local.slice(0, 10), -1)) !== monthOf(p.local))
    const nights = firsts.length === 0 ? [] : await tx.attendanceDay.findMany({
        where: { companyId, userId: { in: users }, date: { in: [...new Set(firsts.map(p => addDays(p.local.slice(0, 10), -1)))].map(d => new Date(`${d}T00:00:00Z`)) } },
        select: { userId: true, date: true, expectedStartMinutes: true, expectedEndMinutes: true },
    })
    const stored = new Map(nights.map(n => [`${n.userId}:${n.date.toISOString().slice(0, 10)}`, n]))
    // The calendar for each edge punch's day and the days either side, through the writer's own transaction: on
    // another connection it could wait for good on a pool the writers' transactions hold (review on #49).
    const dates = [...new Set(edge.flatMap(p => { const d = p.local.slice(0, 10); return [addDays(d, -1), d, addDays(d, 1)] }))]
    const { plans } = await (await import("./attendance-engine.service")).AttendanceEngineService.plansFor(companyId, users, dates, tx)
    const planned = (userId: string, date: string): Shift | null => {
        const p = plans.get(userId)?.get(date)
        return p?.kind === "WORK" ? { start: p.hours.startMinutes, end: p.hours.endMinutes } : null
    }
    const before = (userId: string, date: string): Shift | null => {
        const day = stored.get(`${userId}:${date}`)
        if (!day) return planned(userId, date)
        return day.expectedStartMinutes != null && day.expectedEndMinutes != null ? { start: day.expectedStartMinutes, end: day.expectedEndMinutes } : null
    }
    return punches.map(({ userId, local }) => {
        const date = local.slice(0, 10)
        const months = [monthOf(date)]
        if (!userId || !onEdge(date)) return months
        // In seconds, as the engine compares them: to the minute, a punch half a minute nearer the next day's shift
        // tied with the day's own, went to the earlier, and the next month's lock was left out (Codex review on #49).
        const t = Number(local.slice(11, 13)) * 3600 + Number(local.slice(14, 16)) * 60 + Number(local.slice(17, 19) || 0)
        // Each from the punch's own midnight, in date order: a tie goes to the earlier, as in the engine.
        const nearest = (prior: Shift | null) => {
            const shifts: { date: string; shift: Shift | null; offset: number }[] = [
                { date: addDays(date, -1), shift: prior, offset: -1440 },
                { date, shift: planned(userId, date), offset: 0 },
                { date: addDays(date, 1), shift: planned(userId, addDays(date, 1)), offset: 1440 },
            ]
            let best: { date: string; distance: number } | null = null
            for (const { date: day, shift, offset } of shifts) {
                if (!shift) continue
                const start = (shift.start + offset) * 60, end = (shift.end + offset) * 60
                if (t < start - EARLY_MARGIN_MINUTES * 60 || t > end + LATE_MARGIN_MINUTES * 60) continue
                const distance = t < start ? start - t : t > end ? t - end : 0
                if (!best || distance < best.distance) best = { date: day, distance }
            }
            return best?.date ?? null
        }
        // The night before as stored, and as the calendar has it now: a derived day a failed rebuild left behind
        // can disagree with the calendar an approval rebuilds from, and either may be the one that counts (review
        // on #49). Both months, when they differ: a lock too many is a wait; one too few, a punch an approved
        // month never counts.
        for (const prior of [before(userId, addDays(date, -1)), planned(userId, addDays(date, -1))]) {
            const day = nearest(prior)
            if (day && !months.includes(monthOf(day))) months.push(monthOf(day))
        }
        return months
    })
}
