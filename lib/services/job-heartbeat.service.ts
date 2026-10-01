import { prisma } from "@/lib/prisma"

/**
 * The six scheduled jobs, named by the last segment of their own route so the
 * name survives a rename of anything else. This list is the register: a job
 * that stops firing has no way to report that itself, so the card can only
 * notice the silence of something it already expects to hear from.
 *
 * `every` is how often the schedule in vercel.json fires it, in hours. It is
 * what turns "last ran 40 hours ago" into "late" or "fine" — 40 hours is
 * alarming for a daily job and unremarkable for a monthly one.
 */
export const SCHEDULED_JOBS = [
    { job: "obligations", label: "Obligations", everyHours: 24 },
    { job: "check-expiry", label: "Note expiry", everyHours: 24 },
    { job: "check-subscriptions", label: "Subscriptions", everyHours: 24 },
    { job: "prune", label: "Prune logs", everyHours: 24 },
    { job: "employment", label: "Employment dates", everyHours: 24 },
    { job: "role-requests", label: "Role request reminders", everyHours: 24 },
    { job: "acting-roles", label: "Acting roles", everyHours: 24 },
    { job: "access-reviews", label: "Access reviews", everyHours: 24 },
    { job: "attendance", label: "Attendance days", everyHours: 24 },
    { job: "salary-init", label: "Salary records", everyHours: 24 * 31 },
    { job: "reset-day-off", label: "Leave reset", everyHours: 24 * 366 },
] as const

export type JobName = (typeof SCHEDULED_JOBS)[number]["job"]

/** How late a job may be before the card calls it overdue. */
export function isOverdue(everyHours: number, lastRunAt: Date | null, now = new Date()): boolean {
    if (!lastRunAt) return true
    // Half an interval of slack. Vercel's cron window is about an hour, so a
    // daily job legitimately drifts; a tighter margin would cry wolf nightly
    // and a looser one would take two days to notice a dead daily job.
    const graceMs = everyHours * 1.5 * 60 * 60 * 1000
    return now.getTime() - lastRunAt.getTime() > graceMs
}

/** The full error is in the audit log; this is the line a card can show. */
function summarise(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error)
    return message.slice(0, 300)
}

export class JobHeartbeatService {
    /**
     * Runs a scheduled job and records that it ran, whichever way it went.
     *
     * The recording is deliberately outside the caller's own try/catch and
     * never throws on its own: a heartbeat that could fail the job it watches
     * would be worse than no heartbeat, since it would turn a working job into
     * a broken one on a bad day for the database.
     */
    static async run<T>(job: JobName, work: () => Promise<T>): Promise<T> {
        const startedAt = new Date()
        try {
            const result = await work()
            await this.record(job, startedAt, null)
            return result
        } catch (error) {
            await this.record(job, startedAt, error)
            throw error
        }
    }

    private static async record(job: JobName, startedAt: Date, error: unknown | null): Promise<void> {
        const now = new Date()
        const lastDurationMs = now.getTime() - startedAt.getTime()

        try {
            if (error === null) {
                await prisma.jobHeartbeat.upsert({
                    where: { job },
                    create: { job, lastRunAt: now, lastSuccessAt: now, lastDurationMs, failureStreak: 0 },
                    update: {
                        lastRunAt: now,
                        lastSuccessAt: now,
                        lastDurationMs,
                        // Cleared rather than left behind: a success means the
                        // streak is over, and a stale error beside a fresh
                        // success reads as a job that is still broken.
                        failureStreak: 0,
                        lastError: null,
                    },
                })
                return
            }

            const lastError = summarise(error)
            await prisma.jobHeartbeat.upsert({
                where: { job },
                create: { job, lastRunAt: now, lastFailureAt: now, lastError, lastDurationMs, failureStreak: 1 },
                update: {
                    lastRunAt: now,
                    lastFailureAt: now,
                    lastError,
                    lastDurationMs,
                    failureStreak: { increment: 1 },
                },
            })
        } catch (heartbeatError) {
            // Swallowed on purpose — see run(). Logged so it is not invisible.
            console.error(`[JobHeartbeat] could not record ${job}:`, heartbeatError)
        }
    }

    /**
     * Every job in the register, whether or not it has ever run. A job with no
     * row has never fired once, which is the most important thing this can
     * say and the only thing a table of past runs could not.
     */
    static async list() {
        const rows = await prisma.jobHeartbeat.findMany()
        const byJob = new Map(rows.map(r => [r.job, r]))
        const now = new Date()

        return SCHEDULED_JOBS.map(({ job, label, everyHours }) => {
            const row = byJob.get(job) ?? null
            return {
                job,
                label,
                everyHours,
                lastRunAt: row?.lastRunAt ?? null,
                lastSuccessAt: row?.lastSuccessAt ?? null,
                lastFailureAt: row?.lastFailureAt ?? null,
                lastError: row?.lastError ?? null,
                failureStreak: row?.failureStreak ?? 0,
                neverRun: row === null,
                overdue: isOverdue(everyHours, row?.lastRunAt ?? null, now),
            }
        })
    }
}
