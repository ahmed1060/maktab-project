import { Prisma } from "@prisma/client"

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

