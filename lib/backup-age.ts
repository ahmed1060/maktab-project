/**
 * How old the newest backup is, and when that stops being acceptable.
 *
 * One definition, imported by both readers. It was about to be two: the System
 * Health card had its own constant and the payroll clear needed the same
 * question answered, and a threshold that exists twice is a threshold that
 * drifts — which is precisely the failure P6 spent a phase undoing elsewhere.
 */

/**
 * Older than this and the newest backup is stale.
 *
 * A nightly job, plus Vercel's cron window, plus a slow run still lands inside
 * a day and a bit.
 */
export const BACKUP_STALE_AFTER_HOURS = 30

/** Hours between a backup's timestamp and now. NaN for an unusable timestamp. */
export function backupAgeHours(modifiedTime: string | null | undefined, now: Date = new Date()): number {
    if (!modifiedTime) return NaN
    const at = new Date(modifiedTime).getTime()
    if (Number.isNaN(at)) return NaN
    return (now.getTime() - at) / (1000 * 60 * 60)
}

/** True when there is no usable backup, or the newest one is too old. */
export function isBackupStale(modifiedTime: string | null | undefined, now: Date = new Date()): boolean {
    const age = backupAgeHours(modifiedTime, now)
    return Number.isNaN(age) || age > BACKUP_STALE_AFTER_HOURS
}
